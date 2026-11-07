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

/**
 * Returns the EntryPoint's EIP-712 domain separator, fetching it once and caching it thereafter.
 * Every userOpHash depends on this value, so recomputing it per op would add a needless RPC
 * round-trip to each submission; the separator is fixed for a given EntryPoint + chain.
 * @returns The 32-byte domain separator as a hex string.
 * @throws On RPC/config failure (eip712Domain call) — the first caller's hash computation fails with it.
 * Maps to: internal — computeUserOpHash (its only caller).
 * Side effects: caches the separator in module state for the process lifetime; never invalidated,
 *   so a chain/EntryPoint change requires a process restart.
 */
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
 * Computes the EIP-712 userOpHash for a packed op, matching EntryPoint.getUserOpHash().
 * The hash is what the agent/owner actually signs, so it must byte-match the EntryPoint's
 * computation — any drift makes every signature invalid. Struct hash is keccak256 over the
 * PackedUserOperation typehash with initCode/callData/paymasterAndData hashed, then
 * keccak256("\x19\x01" || domainSeparator || structHash).
 * @returns The userOpHash as a hex string.
 * @throws On a domain-separator fetch failure or malformed op fields (bad hex/addresses).
 * Maps to: contract EntryPoint.getUserOpHash; internal — buildSessionUserOp, buildOwnerUserOp, bundleUserOp.
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
 * Submits a signed UserOp through the EntryPoint and reports its REAL on-chain outcome.
 * The bundler (owner EOA) pays handleOps gas. Mining does not mean success — the EntryPoint
 * catches inner reverts and still mines — so the result is decoded from UserOperationEvent /
 * UserOperationRevertReason logs for this op's hash, never from receipt status alone.
 * @param userOp must already be signed over the nonce it carries; the nonce is deliberately
 *   NOT re-fetched here — overwriting it after signing would silently invalidate the signature.
 * @returns { success, userOpHash, txHash } on success; { success: false, error, revertReason? }
 *   when the hash mismatches, the wallet has zero deposit, the op reverted, or handleOps failed.
 * @throws If the fallback hash recomputation (after a verification failure) itself throws — that
 *   path is outside the handleOps try/catch, so callers must handle it.
 * Maps to: contract EntryPoint.handleOps; REST POST /api/bundler/send.
 * Side effects: spends bundler ETH on gas; a zero-deposit wallet is refused up front so no gas is burned.
 * Security note: no policy/session/risk check here — the caller (REST handler) must gate via
 *   assessBundlerOp before calling this.
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

/**
 * Decodes a Solidity Error(string) revert payload into a human-readable reason.
 * Lets the relay report why an op reverted instead of surfacing opaque hex to the operator.
 * @param raw the revertReason bytes from the UserOperationRevertReason event; "" or "0x" means no reason was given.
 * @returns The decoded string for an Error(string) payload (selector 0x08c379a0), "no reason" for
 *   empty input, or the raw hex unchanged for any other/custom-error payload.
 * @throws Never — decode failures fall through to returning the raw hex.
 * Maps to: internal — bundleUserOp (its only caller, for the revertReason field).
 */
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
 * Builds a session-scoped UserOp whose signature the agent produces with its session key.
 * The agent never holds the owner key: the op is signed with the session key and the signature
 * is abi.encode(sessionId, eoaSignature), so the wallet contract can enforce the session's
 * on-chain limits (spend, expiry, targets) at execution time.
 * @param walletAddress the AgentWallet sender; the live EntryPoint nonce is fetched for it.
 * @param callData the wallet.execute(...) calldata to run; already encoded by the caller.
 * @param sessionId 32-byte session id, zero-padded into the signature payload.
 * @param agentPrivateKey the session key — used only to sign this op's hash, never stored.
 * @returns A PackedUserOp with fixed gas limits (200k verification / 100k call, 50k pre-verification,
 *   1/10 gwei fees) and the session signature filled in; initCode and paymasterAndData are "0x".
 * @throws On nonce/hash RPC failure or an invalid agent private key.
 * Maps to: contract SessionManager.createSession (session being exercised) and EntryPoint.handleOps;
 *   REST POST /api/bundler/send builds the op it relays.
 * Security note: the session key signs here in memory — callers must not log or persist it.
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
 * Builds an owner-direct UserOp signed with the owner's key (65-byte EIP-191 signature).
 * The escape hatch around sessions: no session limits apply, because the owner is acting
 * directly on their own wallet — use it only for owner-initiated ops, never for agent work.
 * @param walletAddress the AgentWallet sender; the live EntryPoint nonce is fetched for it.
 * @param callData the wallet.execute(...) calldata to run; already encoded by the caller.
 * @param ownerPrivateKey the owner's key — used only to sign this op's hash, never stored.
 * @returns A PackedUserOp with the same fixed gas limits as buildSessionUserOp and a plain
 *   65-byte signature (no sessionId wrapper).
 * @throws On nonce/hash RPC failure or an invalid owner private key.
 * Maps to: contract AgentWallet.execute (owner path) and EntryPoint.handleOps.
 * Security note: bypasses all session limits by design — never call with an agent-held key,
 *   and never log or persist the owner key.
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
 * Returns the wallet's current EntryPoint nonce (key 0).
 * Builders fetch the live nonce instead of hardcoding 0, so the second op for a wallet is not
 * rejected as a stale/duplicate nonce.
 * @returns The nonce as a number; 0 for a wallet that has never submitted an op.
 * @throws On RPC/config failure.
 * Maps to: contract EntryPoint.getNonce; internal — buildSessionUserOp and buildOwnerUserOp.
 * Side effects: none — read-only view call. Note: concurrent builders can read the same nonce
 *   and collide; callers must serialize ops per wallet or handle the rejection.
 */
export async function getNonce(walletAddress: string): Promise<number> {
  const config = loadConfig();
  const provider = getProvider();
  const ep = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);
  const nonce = await ep.getNonce(walletAddress, 0);
  return Number(nonce);
}

/**
 * Returns a wallet's EntryPoint deposit balance as an ETH string.
 * The deposit is what prefunds the wallet's ops — a zero balance means any submitted op
 * reverts inside handleOps, so submitters check this before spending relay gas.
 * @returns Deposit in ETH (e.g. "0.5"); "0" when the wallet has never deposited.
 * @throws On RPC/config failure.
 * Maps to: contract EntryPoint.balanceOf; REST bundler status / deposit views.
 * Side effects: none — read-only view call.
 */
export async function getEntryPointDeposit(walletAddress: string): Promise<string> {
  const config = loadConfig();
  const provider = getProvider();
  const ep = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);
  const deposit = await ep.balanceOf(walletAddress);
  return ethers.formatEther(deposit);
}
