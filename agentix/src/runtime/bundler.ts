import { ethers } from "ethers";
import { getProvider, getSigner } from "../core/provider";
import { loadConfig } from "../core/config";
import { logger } from "../core/logger";

// ── EntryPoint v0.7 ABI ────────────────────────────────────────
const ENTRY_POINT_ABI = [
  "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] calldata ops, address payable beneficiary) external",
  "function getNonce(address sender, uint192 key) external view returns (uint256 nonce)",
  "function balanceOf(address account) external view returns (uint256)",
  "function depositTo(address account) external payable",
  "function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) calldata userOp) external view returns (bytes32)",
  "function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])",
  // Events used to detect the REAL outcome of a UserOp. handleOps mining does NOT
  // mean the op succeeded — EntryPoint catches inner reverts and still mines.
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
];

// ── EIP-712 Constants ──────────────────────────────────────────
const PACKED_USEROP_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes("PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)")
);

const DOMAIN_NAME_HASH = ethers.keccak256(ethers.toUtf8Bytes("ERC4337"));
const DOMAIN_VERSION_HASH = ethers.keccak256(ethers.toUtf8Bytes("1"));

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
  /** The on-chain revert reason when the UserOp executed but its inner call reverted. */
  revertReason?: string;
}

// ── Domain Separator Cache ──────────────────────────────────────
let _domainSeparator: string | null = null;

async function getDomainSeparator(): Promise<string> {
  if (_domainSeparator) return _domainSeparator;
  const config = loadConfig();
  const provider = getProvider();
  const ep = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);

  const [, name, version, chainId, verifyingContract] = await ep.eip712Domain();
  _domainSeparator = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        ethers.keccak256(ethers.toUtf8Bytes(name)),
        ethers.keccak256(ethers.toUtf8Bytes(version)),
        chainId,
        verifyingContract,
      ]
    )
  );
  logger.info("bundler", `Domain separator: ${_domainSeparator}`);
  return _domainSeparator;
}

// ── EIP-712 UserOp Hash ────────────────────────────────────────

/**
 * Computes the EIP-712 userOpHash matching the EntryPoint's getUserOpHash().
 *
 * Structure:
 *   structHash = keccak256(abi.encode(
 *     PACKED_USEROP_TYPEHASH, sender, nonce,
 *     keccak256(initCode), keccak256(callData),
 *     accountGasLimits, preVerificationGas, gasFees,
 *     keccak256(paymasterAndData)
 *   ))
 *   userOpHash = keccak256("\x19\x01" || domainSeparator || structHash)
 */
export async function computeUserOpHash(op: PackedUserOp): Promise<string> {
  const domainSep = await getDomainSeparator();

  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        PACKED_USEROP_TYPEHASH,
        op.sender,
        op.nonce,
        ethers.keccak256(op.initCode === "0x" ? new Uint8Array(0) : ethers.getBytes(op.initCode)),
        ethers.keccak256(op.callData),
        op.accountGasLimits,
        op.preVerificationGas,
        op.gasFees,
        ethers.keccak256(op.paymasterAndData === "0x" ? new Uint8Array(0) : ethers.getBytes(op.paymasterAndData)),
      ]
    )
  );

  return ethers.keccak256(
    ethers.concat(["0x1901", domainSep, structHash])
  );
}

// ── Bundle Submission ───────────────────────────────────────────

/**
 * Submits a UserOperation through the EntryPoint.
 * The bundler (owner EOA) pays for handleOps gas.
 */
export async function bundleUserOp(userOp: PackedUserOp): Promise<BundlerResult> {
  const config = loadConfig();
  const provider = getProvider();
  const signer = getSigner();
  const entryPointAddr = config.contracts.entryPoint;

  const ep = new ethers.Contract(entryPointAddr, ENTRY_POINT_ABI, provider);
  const epSigner = new ethers.Contract(entryPointAddr, ENTRY_POINT_ABI, signer);

  // 1. Verify the userOpHash against the EntryPoint. Do NOT re-fetch/overwrite the
  //    nonce here: the signature was computed over the nonce set in buildSessionUserOp.
  //    Overwriting the nonce after signing would silently invalidate the signature.
  let userOpHash: string;
  try {
    const computedHash = await computeUserOpHash(userOp);
    const epHash = await ep.getUserOpHash(userOp);
    if (computedHash !== epHash) {
      logger.warn("bundler", `Hash mismatch: computed ${computedHash} vs EP ${epHash}`);
      return { success: false, error: "UserOp hash mismatch" };
    }
    userOpHash = computedHash; // reuse below — no redundant post-mine RPC
    logger.info("bundler", "UserOp hash verified");
  } catch (e: any) {
    logger.warn("bundler", `Hash verification failed: ${e.message}`);
    userOpHash = await computeUserOpHash(userOp);
  }

  // 2. Deposit guard. A depositless wallet's op reverts inside handleOps and the
  //    relay EOA eats the gas. Refuse up-front so we never burn gas on a dead op.
  try {
    const deposit: bigint = await ep.balanceOf(userOp.sender);
    if (deposit === 0n) {
      return {
        success: false,
        userOpHash,
        error: "Wallet has zero EntryPoint deposit — fund gas (addDeposit) before submitting UserOps.",
      };
    }
  } catch (e: any) {
    logger.warn("bundler", `Deposit check failed (continuing): ${e.message}`);
  }

  // 3. Submit via handleOps and decode the REAL result from EntryPoint events.
  try {
    const beneficiary = await signer.getAddress();
    const tx = await epSigner.handleOps([userOp], beneficiary, { gasLimit: 500_000 });
    const receipt = await tx.wait();
    const txHash = receipt?.hash || tx.hash;

    // handleOps mining != op success. EntryPoint catches inner reverts and still
    // mines, emitting UserOperationEvent{success:false} + UserOperationRevertReason.
    // Parse the logs for THIS op's outcome instead of blindly returning success.
    const iface = new ethers.Interface(ENTRY_POINT_ABI);
    let opSucceeded: boolean | null = null;
    let revertReason: string | undefined;

    for (const log of receipt?.logs || []) {
      let parsed;
      try {
        parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (parsed.name === "UserOperationEvent" && parsed.args.userOpHash === userOpHash) {
        opSucceeded = parsed.args.success;
      } else if (parsed.name === "UserOperationRevertReason" && parsed.args.userOpHash === userOpHash) {
        const raw: string = parsed.args.revertReason;
        revertReason = decodeRevertReason(raw);
      }
    }

    if (opSucceeded === false) {
      logger.warn("bundler", `UserOp executed but reverted: ${txHash} — ${revertReason || "unknown reason"}`);
      return { success: false, userOpHash, txHash, error: `UserOp reverted: ${revertReason || "unknown reason"}`, revertReason };
    }
    if (opSucceeded === null && receipt?.status === 0) {
      return { success: false, userOpHash, txHash, error: "handleOps transaction reverted" };
    }

    logger.info("bundler", `UserOp submitted: ${txHash} (success=${opSucceeded ?? "unconfirmed"})`);
    return { success: true, userOpHash, txHash };
  } catch (e: any) {
    logger.error("bundler", `handleOps failed: ${e.message}`);
    return { success: false, userOpHash, error: `handleOps failed: ${e.message}` };
  }
}

/** Decode a Solidity Error(string) revert payload; fall back to the raw hex. */
export function decodeRevertReason(raw: string): string {
  if (!raw || raw === "0x") return "no reason";
  try {
    // Error(string) selector 0x08c379a0
    if (raw.startsWith("0x08c379a0")) {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + raw.slice(10));
      return reason;
    }
  } catch { /* fall through */ }
  return raw;
}

// ── UserOp Builders ─────────────────────────────────────────────

/**
 * Creates a UserOp for session-based execution.
 * The agent signs the userOpHash with its session key.
 * Signature format: abi.encode(sessionId, eoaSignature)
 */
export async function buildSessionUserOp(
  walletAddress: string,
  callData: string,
  sessionId: string,
  agentPrivateKey: string,
): Promise<PackedUserOp> {
  const agentWallet = new ethers.Wallet(agentPrivateKey);

  // Fetch the live EntryPoint nonce. Hardcoding 0 caused every op after the first
  // to be rejected as a stale/duplicate nonce; concurrent ops would also collide.
  const liveNonce = await getNonce(walletAddress);

  const userOp: PackedUserOp = {
    sender: walletAddress,
    nonce: liveNonce,
    initCode: "0x",
    callData,
    accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [200_000, 100_000]),
    preVerificationGas: 50000,
    gasFees: ethers.solidityPacked(["uint128", "uint128"], [
      ethers.parseUnits("1", "gwei"),
      ethers.parseUnits("10", "gwei"),
    ]),
    paymasterAndData: "0x",
    signature: "0x",
  };

  const userOpHash = await computeUserOpHash(userOp);

  // Agent signs with EIP-191
  const agentSignature = agentWallet.signingKey.sign(
    ethers.hashMessage(ethers.getBytes(userOpHash))
  ).serialized;

  userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes"],
    [ethers.zeroPadValue(sessionId, 32), agentSignature]
  );

  return userOp;
}

/**
 * Creates a UserOp for owner-direct execution.
 * The owner signs the userOpHash with a 65-byte EIP-191 signature.
 * No session limits — direct wallet control.
 */
export async function buildOwnerUserOp(
  walletAddress: string,
  callData: string,
  ownerPrivateKey: string,
): Promise<PackedUserOp> {
  const ownerWallet = new ethers.Wallet(ownerPrivateKey);

  const liveNonce = await getNonce(walletAddress);

  const userOp: PackedUserOp = {
    sender: walletAddress,
    nonce: liveNonce,
    initCode: "0x",
    callData,
    accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [200_000, 100_000]),
    preVerificationGas: 50000,
    gasFees: ethers.solidityPacked(["uint128", "uint128"], [
      ethers.parseUnits("1", "gwei"),
      ethers.parseUnits("10", "gwei"),
    ]),
    paymasterAndData: "0x",
    signature: "0x",
  };

  const userOpHash = await computeUserOpHash(userOp);

  // 65-byte EIP-191 signature
  userOp.signature = ownerWallet.signingKey.sign(
    ethers.hashMessage(ethers.getBytes(userOpHash))
  ).serialized;

  return userOp;
}

/**
 * Get the current nonce for a wallet from the EntryPoint.
 */
export async function getNonce(walletAddress: string): Promise<number> {
  const config = loadConfig();
  const provider = getProvider();
  const ep = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);
  const nonce = await ep.getNonce(walletAddress, 0);
  return Number(nonce);
}

/**
 * Get the EntryPoint deposit balance for a wallet.
 */
export async function getEntryPointDeposit(walletAddress: string): Promise<string> {
  const config = loadConfig();
  const provider = getProvider();
  const ep = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);
  const deposit = await ep.balanceOf(walletAddress);
  return ethers.formatEther(deposit);
}
