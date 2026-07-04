import { ethers } from "ethers";
import { getProvider, getSigner } from "../core/provider";
import { loadConfig } from "../core/config";
import { logger } from "../core/logger";

// ── Minimal EntryPoint v0.7 ABI ──────────────────────────────────
const ENTRY_POINT_ABI = [
  "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] calldata ops, address payable beneficiary) external",
  "function simulateValidation(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) calldata userOp) external",
  "function getNonce(address sender, uint192 key) external view returns (uint256 nonce)",
  "function balanceOf(address account) external view returns (uint256)",
  "function depositTo(address account) external payable",
];

export interface PackedUserOp {
  sender: string;
  nonce: number | string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: number | string;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

export interface BundlerResult {
  success: boolean;
  userOpHash?: string;
  txHash?: string;
  error?: string;
}

/**
 * Submits a UserOperation through the local bundler.
 *
 * 1. Simulates via simulateValidation (static call)
 * 2. Submits via handleOps (real tx)
 * 3. Gas is paid from the wallet's EntryPoint deposit
 *
 * @param userOp - The packed UserOperation to relay
 * @returns The result with txHash on success
 */
export async function bundleUserOp(userOp: PackedUserOp): Promise<BundlerResult> {
  const config = loadConfig();
  const provider = getProvider();
  const signer = getSigner();
  const entryPointAddr = config.contracts.entryPoint;

  const ep = new ethers.Contract(entryPointAddr, ENTRY_POINT_ABI, provider);

  // 1. Get current nonce from EntryPoint
  try {
    const nonce = await ep.getNonce(userOp.sender, 0);
    logger.info("bundler", `Nonce for ${userOp.sender.slice(0, 10)}: ${nonce}`);
  } catch { /* best-effort */ }

  // 2. Simulate
  try {
    await ep.simulateValidation.staticCall(userOp);
    logger.info("bundler", "Simulation passed");
  } catch (e: any) {
    logger.warn("bundler", `Simulation failed: ${e.message}`);
    return { success: false, error: `Simulation failed: ${e.message}` };
  }

  // 3. Submit via handleOps
  try {
    const epSigner = new ethers.Contract(entryPointAddr, ENTRY_POINT_ABI, signer);
    const beneficiary = await signer.getAddress();
    const tx = await epSigner.handleOps([userOp], beneficiary, {
      gasLimit: 500_000,
    });
    const receipt = await tx.wait();
    const txHash = receipt?.hash || tx.hash;

    logger.info("bundler", `UserOp submitted: ${txHash}`);

    // Compute userOpHash (keccak256 of the packed userOp)
    const userOpHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
        [
          userOp.sender, userOp.nonce,
          ethers.keccak256(userOp.initCode),
          ethers.keccak256(userOp.callData),
          userOp.accountGasLimits,
          userOp.preVerificationGas,
          userOp.gasFees,
          ethers.keccak256(userOp.paymasterAndData),
          ethers.keccak256(userOp.signature),
        ]
      )
    );

    return { success: true, userOpHash, txHash };
  } catch (e: any) {
    logger.error("bundler", `handleOps failed: ${e.message}`);
    return { success: false, error: `handleOps failed: ${e.message}` };
  }
}

/**
 * Creates a UserOperation for session-based execution via an AgentWallet.
 * The agent signs the userOpHash with its session key.
 * Signature format: abi.encode(sessionId, eoaSignature) where eoaSignature
 * is the session key's EIP-191 signature of the userOpHash.
 */
export function buildSessionUserOp(
  walletAddress: string,
  callData: string,
  sessionId: string,
  agentPrivateKey: string,
): PackedUserOp {
  const agentWallet = new ethers.Wallet(agentPrivateKey);

  // Build userOp fields (signature placeholder)
  const userOp: PackedUserOp = {
    sender: walletAddress,
    nonce: 0,
    initCode: "0x",
    callData,
    accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [0, 0]),
    preVerificationGas: 50000,
    gasFees: ethers.solidityPacked(["uint128", "uint128"], [0, 0]),
    paymasterAndData: "0x",
    signature: "0x",
  };

  // Compute userOpHash: keccak256(abi.encode(userOp fields sans signature))
  const userOpHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        userOp.sender, userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
        ethers.keccak256(userOp.paymasterAndData),
      ]
    )
  );

  // Agent signs EIP-191: sign(keccak256("\x19Ethereum Signed Message:\n32" + userOpHash))
  const agentSignature = agentWallet.signingKey.sign(
    ethers.hashMessage(ethers.getBytes(userOpHash))
  ).serialized;

  // Encode as abi.encode(sessionId, signature)
  const sessionIdBytes = ethers.zeroPadValue(sessionId, 32);
  userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes"],
    [sessionIdBytes, agentSignature]
  );

  return userOp;
}

/**
 * Creates a UserOperation for owner-direct execution.
 * The wallet owner signs the userOpHash with a 65-byte EIP-191 signature.
 * The contract recovers signer and checks `signer == owner` — no session limits.
 */
export function buildOwnerUserOp(
  walletAddress: string,
  callData: string,
  ownerPrivateKey: string,
): PackedUserOp {
  const ownerWallet = new ethers.Wallet(ownerPrivateKey);

  const userOp: PackedUserOp = {
    sender: walletAddress,
    nonce: 0,
    initCode: "0x",
    callData,
    accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [0, 0]),
    preVerificationGas: 50000,
    gasFees: ethers.solidityPacked(["uint128", "uint128"], [0, 0]),
    paymasterAndData: "0x",
    signature: "0x",
  };

  const userOpHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        userOp.sender, userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
        ethers.keccak256(userOp.paymasterAndData),
      ]
    )
  );

  // 65-byte EIP-191 signature — contract's _validateSignature recovers signer, checks == owner
  userOp.signature = ownerWallet.signingKey.sign(
    ethers.hashMessage(ethers.getBytes(userOpHash))
  ).serialized;

  return userOp;
}
