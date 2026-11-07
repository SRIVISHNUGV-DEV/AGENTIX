import { ethers } from "ethers";
import { getProvider, getSigner, callWithFallback } from "../core/provider";
import { getAbiByName, getContract, getReadonlyContract } from "../contracts";
import { getProxyGuard } from "../core/proxy-guard";
import { loadConfig } from "../core/config";
import { logger } from "../core/logger";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Builds a provider for the configured fallback RPC, or null when none is configured.
 * A fresh provider is created per call — there is no pooling, so high-frequency reads pay a construction cost each time.
 * @returns The fallback provider, or null when rpcFallbackUrl is unset.
 * Maps to: internal — every adapter read/write that uses callWithFallback.
 */
function _getFallbackProvider(): ethers.JsonRpcProvider | null {
  const config = loadConfig();
  if (!config.rpcFallbackUrl) return null;
  return new ethers.JsonRpcProvider(config.rpcFallbackUrl, config.chainId);
}

/**
 * Retries a fallible operation up to 3 times with linear backoff (1s, 2s) before rethrowing.
 * Only for idempotent reads and proposal sends — retrying a non-idempotent send can submit twice, so writes that already broadcast must not go through here.
 * @param label - Name used in the retry warning log.
 * @returns Whatever the operation returns on the first success.
 * @throws The last attempt's error when all 3 attempts fail; the final `throw new Error("unreachable")` is only for the type-checker (the loop always returns or throws).
 * Maps to: internal — every adapter send* and readOracleState.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt === MAX_RETRIES) throw e;
      logger.warn("blockchain", `${label} attempt ${attempt} failed: ${e.message}, retrying...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("unreachable");
}

// ── Read Operations ───────────────────────────────────────────────

export interface OracleState {
  activeRoot: string;
  revokedRoot: string;
  paused: boolean;
  blockNumber: number;
  blockTimestamp: number;
  chainId: string;
}

/**
 * Reads the credential registry's live oracle state (active/revoked roots, paused flag, latest block).
 * Retried (up to 3x) and fallen back to the secondary RPC; a single root read failing does not fail the whole call (it degrades to the zero root / false).
 * @returns The oracle state, including the chain id as a decimal string.
 * @throws When both RPCs fail (or no fallback is configured and the primary fails).
 * Maps to: contract CredentialRegistry.activeRoot / revokedSecretRoot / paused; REST GET /oracle (runtime server).
 */
export async function readOracleState(): Promise<OracleState> {
  return withRetry(async () => {
    return callWithFallback(
      async () => _readOracleStateFrom(getProvider()),
      async () => {
        const fb = _getFallbackProvider();
        if (!fb) throw new Error("No fallback RPC configured");
        return _readOracleStateFrom(fb);
      }
    );
  }, "readOracleState");
}

/**
 * Reads the oracle state from one specific provider (no fallback, no retry — the caller owns that).
 * Each root/pause read has its own catch, so one failing view degrades to a zero value instead of failing the whole snapshot; a degraded zero root is indistinguishable from a genuinely zero root, so callers must not treat "root is zero" as proof of anything.
 * @returns The oracle state from this provider.
 * @throws When the block number, block, or network query itself fails.
 * Maps to: internal — readOracleState (primary and fallback branches).
 */
async function _readOracleStateFrom(provider: ethers.JsonRpcProvider): Promise<OracleState> {
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

  const credReg = getReadonlyContract("CredentialRegistry");
  const [activeRoot, revokedRoot, paused] = await Promise.all([
    credReg.activeRoot().catch(() => "0x" + "0".repeat(64)),
    credReg.revokedSecretRoot().catch(() => "0x" + "0".repeat(64)),
    credReg.paused().catch(() => false),
  ]);

  return {
    activeRoot,
    revokedRoot,
    paused,
    blockNumber,
    blockTimestamp: Number(timestamp),
    chainId: (await provider.getNetwork()).chainId.toString(),
  };
}

/**
 * Reads a wallet's owner with a raw eth_call (hand-encoded owner() calldata, decoded by hand).
 * The raw-call path avoids constructing a contract instance per wallet — the address being read is a parameter, not the configured AgentWallet address.
 * @returns The owner address.
 * @throws When either RPC fails, or when the target is not a contract exposing owner() (decode failure).
 * Maps to: contract AgentWallet.owner; internal — ownership checks before owner-gated operations.
 */
export async function readWalletOwner(walletAddress: string): Promise<string> {
  const iface = new ethers.Interface(["function owner() view returns (address)"]);
  const calldata = iface.encodeFunctionData("owner");
  return callWithFallback(
    async () => {
      const result = await getProvider().call({ to: walletAddress, data: calldata });
      return iface.decodeFunctionResult("owner", result)[0] as string;
    },
    async () => {
      const fb = _getFallbackProvider();
      if (!fb) throw new Error("No fallback RPC configured");
      const result = await fb.call({ to: walletAddress, data: calldata });
      return iface.decodeFunctionResult("owner", result)[0] as string;
    }
  );
}

/**
 * Reads a wallet's EntryPoint deposit (balanceOf on the configured EntryPoint) with fallback RPC.
 * This is the bundler gas balance — distinct from the wallet's own ETH balance (see readWalletBalance).
 * @returns The deposit in wei; 0n when nothing is deposited.
 * @throws When both RPCs fail, or when the EntryPoint address is misconfigured (decode failure).
 * Maps to: contract IEntryPoint.balanceOf; REST wallet balance paths.
 */
export async function readEntryPointDeposit(walletAddress: string): Promise<bigint> {
  const config = loadConfig();
  const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
  const calldata = iface.encodeFunctionData("balanceOf", [walletAddress]);
  return callWithFallback(
    async () => {
      const result = await getProvider().call({ to: config.contracts.entryPoint, data: calldata });
      return BigInt(iface.decodeFunctionResult("balanceOf", result)[0].toString());
    },
    async () => {
      const fb = _getFallbackProvider();
      if (!fb) throw new Error("No fallback RPC configured");
      const result = await fb.call({ to: config.contracts.entryPoint, data: calldata });
      return BigInt(iface.decodeFunctionResult("balanceOf", result)[0].toString());
    }
  );
}

/**
 * Reads a wallet's native ETH balance with fallback RPC.
 * @returns The balance in wei; 0n for an unfunded wallet.
 * @throws When both RPCs fail.
 * Maps to: internal — REST wallet balance paths; MCP tool agentix_wallet_balance.
 */
export async function readWalletBalance(walletAddress: string): Promise<bigint> {
  return callWithFallback(
    async () => getProvider().getBalance(walletAddress),
    async () => {
      const fb = _getFallbackProvider();
      if (!fb) throw new Error("No fallback RPC configured");
      return fb.getBalance(walletAddress);
    }
  );
}

// ── Encode Operations (calldata preparation, no chain write) ──────

export interface EncodedTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

/**
 * Encodes (but does not send) an AgentWalletFactory.createWallet call with a fresh random salt.
 * The caller signs and broadcasts the returned tx; the salt is returned so the caller can predict/verify the CREATE2 address.
 * @returns The unsigned tx (to = factory proxy, value 0) plus the random salt.
 * @throws When the factory ABI or proxy address is misconfigured.
 * Maps to: contract AgentWalletFactory.createWallet(address,bytes32); REST POST /wallets (runtime server).
 */
export function encodeCreateWallet(ownerAddress: string): EncodedTx & { salt: string } {
  const config = loadConfig();
  const guard = getProxyGuard();
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const abi = getAbiByName("AgentWalletFactory");
  const iface = new ethers.Interface(abi);
  const calldata = iface.encodeFunctionData("createWallet(address,bytes32)", [ownerAddress, salt]);
  return {
    to: guard.getProxyAddress("AgentWalletFactory"),
    data: calldata,
    value: "0x0",
    chainId: config.chainId,
    salt,
  };
}

/**
 * Encodes (but does not send) a wallet.execute call: the wallet calls `target` with `valueWei` ETH and `calldata`.
 * The value here is a decimal ETH string (parsed with parseEther) — an empty value defaults to 0, and a malformed string throws before anything is encoded.
 * @param valueWei - Decimal ETH string (not wei, despite the name); @param calldata - Hex calldata, '0x' when empty.
 * @returns The unsigned tx to the wallet address, value 0 (the ETH moves inside the wallet call, not with this tx).
 * @throws When the ETH string fails to parse or the wallet ABI is misconfigured.
 * Maps to: contract AgentWallet.execute; REST wallet-execute paths.
 * Security: target and calldata are fully caller-controlled — encode only what the wallet's session/policy allows.
 */
export function encodeWalletExecute(walletAddress: string, target: string, valueWei: string, calldata: string): EncodedTx {
  const config = loadConfig();
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("execute", [target, ethers.parseEther(valueWei || "0"), calldata || "0x"]);
  return {
    to: walletAddress,
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

/**
 * Encodes a per-wallet selector whitelist update — except it always throws, because there is no per-wallet whitelist.
 * AgentWallet v1 delegates all authorization to SessionManager; this stub exists only so old callers fail loudly instead of silently doing nothing. Do not "fix" it by adding a whitelist — the no-whitelist decision is deliberate (see the cancelled selector-whitelist build).
 * @throws Always: "AgentWallet does not support per-wallet whitelisting. Authorization is handled by SessionManager."
 * Maps to: policy rule — SessionManager session allowlists (setSessionTargets), not a wallet whitelist.
 */
export function encodeWhitelistSelector(walletAddress: string, target: string, selector: string, allowed: boolean): EncodedTx {
  // AgentWallet v1 delegates all authorization to SessionManager.
  // There is no per-wallet whitelist — this is a no-op kept for API compatibility.
  throw new Error("AgentWallet does not support per-wallet whitelisting. Authorization is handled by SessionManager.");
}

/**
 * Encodes (but does not send) a wallet.addDeposit call carrying ETH as msg.value.
 * The deposit funds the wallet's EntryPoint balance for bundler gas.
 * @param amountEth - Decimal ETH string; a malformed string throws before encoding.
 * @returns The unsigned tx to the wallet, value = the deposit in wei.
 * @throws When the ETH string fails to parse.
 * Maps to: contract AgentWallet.addDeposit; REST deposit paths.
 * Side effects: none here — the ETH moves only when the caller broadcasts and it mines.
 */
export function encodeWalletDeposit(walletAddress: string, amountEth: string): EncodedTx {
  const config = loadConfig();
  const valueWei = ethers.parseEther(amountEth);
  const abi = getAbiByName("AgentWallet");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("addDeposit");
  return {
    to: walletAddress,
    data,
    value: ethers.toBeHex(valueWei),
    chainId: config.chainId,
  };
}

/**
 * Encodes (but does not send) an EntryPoint.depositTo call for a wallet.
 * An empty amount defaults to 0.01 ETH — callers passing '' get a real deposit, not a zero one.
 * @param amountEth - Decimal ETH string (default 0.01 when empty).
 * @returns The unsigned tx to the EntryPoint, value = the deposit in wei.
 * @throws When the ETH string fails to parse.
 * Maps to: contract IEntryPoint.depositTo; REST deposit paths.
 */
export function encodeEntryPointDeposit(walletAddress: string, amountEth: string): EncodedTx {
  const config = loadConfig();
  const valueWei = ethers.parseEther(amountEth || "0.01");
  const abi = getAbiByName("IEntryPoint");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("depositTo", [walletAddress]);
  return {
    to: config.contracts.entryPoint,
    data,
    value: ethers.toBeHex(valueWei),
    chainId: config.chainId,
  };
}

/**
 * Encodes a credential-root PROPOSAL. This does NOT update the root: the proposal becomes effective only after the contract's 2-day timelock AND an acceptActiveRoot() call. Callers must never describe this as a root update — see encodeRootAccept() for the completing step.
 * @param root - Non-zero bytes32 Merkle root of the new active credential set.
 * @returns The unsigned tx (to = registry proxy, value 0) for the owner to sign and broadcast.
 * @throws When the registry ABI or proxy address is misconfigured.
 * Maps to: contract CredentialRegistry.proposeActiveRoot; CLI 'agentix cred' propose.
 * Security: registry-owner only; a wrong root locks out credentials until corrected through the same timelock.
 */
export function encodeRootProposal(root: string): EncodedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const abi = getAbiByName("CredentialRegistry");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("proposeActiveRoot", [root]);
  return {
    to: guard.getProxyAddress("CredentialRegistry"),
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

/**
 * Encodes the accept step for a pending credential-root proposal (reverts before the 2-day timelock).
 * This is the step that actually changes the live root; encoding it does not execute it.
 * @returns The unsigned tx (to = registry proxy, value 0).
 * Maps to: contract CredentialRegistry.acceptActiveRoot; CLI 'agentix cred' accept; event ActiveRootUpdated.
 * Security: registry-owner only.
 */
export function encodeRootAccept(): EncodedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const abi = getAbiByName("CredentialRegistry");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("acceptActiveRoot", []);
  return {
    to: guard.getProxyAddress("CredentialRegistry"),
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

/**
 * Encodes the cancel step for a pending credential-root proposal.
 * Cancelling leaves the live root unchanged and frees the slot for a new proposal.
 * @returns The unsigned tx (to = registry proxy, value 0).
 * Maps to: contract CredentialRegistry.cancelActiveRoot.
 * Security: registry-owner only.
 */
export function encodeRootCancel(): EncodedTx {
  const config = loadConfig();
  const guard = getProxyGuard();
  const abi = getAbiByName("CredentialRegistry");
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData("cancelActiveRoot", []);
  return {
    to: guard.getProxyAddress("CredentialRegistry"),
    data,
    value: "0x0",
    chainId: config.chainId,
  };
}

export interface LightweightSessionParams {
  walletAddress: string;
  sessionKey: string;
  dailySpendLimitEth: string;
  dailyTxLimit: number;
  expiryDays: number;
  ownerSignature: string;
  sessionId?: string;
  expiry?: number;
  allowedTargets?: string[];
}

export interface EncodedLightweightSession extends EncodedTx {
  sessionId: string;
  expiry: number;
  sessionMgrSelector: string;
  sessionManagerAddress: string;
}

/**
 * Encodes a lightweight session creation, wrapped in wallet.execute (the contract requires msg.sender == wallet).
 * The session id and expiry are taken from params when supplied (the prepare step's values), otherwise generated fresh (random id, now + expiryDays).
 * @param params - Wallet, session key, dailySpendLimitEth (decimal ETH, default '0.1'), dailyTxLimit, expiryDays, ownerSignature, optional sessionId/expiry/allowedTargets.
 * @returns The unsigned wallet.execute tx plus sessionId, expiry, the session-manager selector, and its address.
 * @throws When an ETH string fails to parse or an ABI is misconfigured.
 * Maps to: contract SessionManager.createLightweightSession (via AgentWallet.execute); REST session-create paths.
 */
export function encodeLightweightSession(params: LightweightSessionParams): EncodedLightweightSession {
  const config = loadConfig();
  const guard = getProxyGuard();
  // Use provided sessionId/expiry from prepare step, or generate fresh ones
  const sessionId = params.sessionId || ethers.hexlify(ethers.randomBytes(32));
  const expiry = params.expiry || Math.floor(Date.now() / 1000) + params.expiryDays * 86400;
  const dailySpendLimit = ethers.parseEther(params.dailySpendLimitEth || "0.1");

  const smAbi = getAbiByName("SessionManager");
  const smIface = new ethers.Interface(smAbi);
  // createLightweightSession(bytes32 sessionId, address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry, address[] allowedTargets, bytes ownerSignature)
  const sessionCalldata = smIface.encodeFunctionData("createLightweightSession", [
    sessionId,
    params.sessionKey,
    dailySpendLimit,
    params.dailyTxLimit,
    expiry,
    params.allowedTargets || [],
    params.ownerSignature || "0x",
  ]);

  const walletAbi = getAbiByName("AgentWallet");
  const walletIface = new ethers.Interface(walletAbi);
  const executeCalldata = walletIface.encodeFunctionData("execute", [
    config.contracts.sessionManager,
    0,
    sessionCalldata,
  ]);

  return {
    to: params.walletAddress,
    data: executeCalldata,
    value: "0x0",
    chainId: config.chainId,
    sessionId,
    expiry,
    sessionMgrSelector: smIface.getFunction("createLightweightSession")!.selector,
    sessionManagerAddress: config.contracts.sessionManager,
  };
}

// ── Standard (ZK proof-gated) session encoding ────────────────────

export interface StandardSessionParams {
  walletAddress: string;
  sessionKey: string;
  /** Cumulative max value (wei) this session may spend. Must equal publicSignals[2]. */
  maxValue: string;
  /** Session expiry (unix seconds). Must equal publicSignals[3]. */
  expiry: number;
  /** Groth16 proof calldata + 7 public signals from generateProof(). */
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    publicSignals: string[];
  };
  sessionId?: string;
}

export interface EncodedStandardSession extends EncodedTx {
  sessionId: string;
  expiry: number;
  sessionMgrSelector: string;
  sessionManagerAddress: string;
}

/**
 * Encodes a ZK-proof-gated "standard" session.
 * This is the privacy USP path: the agent's credential proof authorizes the session. NO owner signature is used — the on-chain Groth16 verifier + nullifier are the entire trust basis. The org's policy (budget, expiry, membership, non-revocation) is proven in zero-knowledge; none of it is revealed on-chain.
 * Contract requires msg.sender == wallet, so we wrap createSession() in wallet.execute(sessionManager, 0, createSessionCalldata) — same envelope as lightweight sessions, but the proof replaces the ECDSA owner signature.
 * SessionManager.createSession(bytes32 sessionId, address wallet, address sessionKey, uint128 maxValue, uint64 expiry, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[7] publicSignals)
 * @param params - Wallet, session key, maxValue (wei string, must equal publicSignals[2]), expiry (Unix seconds, must equal publicSignals[3]), the Groth16 proof, optional sessionId.
 * @returns The unsigned wallet.execute tx plus sessionId, expiry, the session-manager selector, and its address.
 * @throws When the proof does not carry exactly 7 public signals, or an ABI is misconfigured.
 * Maps to: contract SessionManager.createSession (via AgentWallet.execute); REST session-create paths; event SessionCreated.
 * Security: the proof is the entire authorization — never submit a proof generated for another wallet or credential.
 */
export function encodeStandardSession(params: StandardSessionParams): EncodedStandardSession {
  const config = loadConfig();
  const sessionId = params.sessionId || ethers.hexlify(ethers.randomBytes(32));
  const { a, b, c, publicSignals } = params.proof;

  if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
    throw new Error(`createSession requires exactly 7 public signals, got ${publicSignals?.length ?? 0}`);
  }

  const smAbi = getAbiByName("SessionManager");
  const smIface = new ethers.Interface(smAbi);
  const sessionCalldata = smIface.encodeFunctionData("createSession", [
    sessionId,
    params.walletAddress,
    params.sessionKey,
    params.maxValue,
    params.expiry,
    a,
    b,
    c,
    publicSignals,
  ]);

  const walletAbi = getAbiByName("AgentWallet");
  const walletIface = new ethers.Interface(walletAbi);
  const executeCalldata = walletIface.encodeFunctionData("execute", [
    config.contracts.sessionManager,
    0,
    sessionCalldata,
  ]);

  return {
    to: params.walletAddress,
    data: executeCalldata,
    value: "0x0",
    chainId: config.chainId,
    sessionId,
    expiry: params.expiry,
    sessionMgrSelector: smIface.getFunction("createSession")!.selector,
    sessionManagerAddress: config.contracts.sessionManager,
  };
}

/**
 * Encodes a wallet.execute() wrapping SessionManager.setSessionTargets().
 * WHY THIS EXISTS (C-1 runtime half): standard sessions have no allowlist parameter at creation, and token selectors (ERC-20 transfer/approve/transferFrom, ERC-721 transferFrom/safeTransferFrom) are DENIED on-chain unless the token contract is in the session's allowlist — an empty allowlist denies token moves. So a standard session intended for token payments MUST send this transaction (from the wallet owner) after the session creation confirms, before any token payment is attempted. This returns an EncodedTx for the owner to sign/relay; it sends nothing itself. The sessionId here must be the session created by the corresponding encodeStandardSession() call.
 * @returns The unsigned wallet.execute tx (value 0).
 * Maps to: contract SessionManager.setSessionTargets (via AgentWallet.execute); REST session-create paths.
 */
export function encodeSetSessionTargets(
  walletAddress: string,
  sessionId: string,
  targets: string[]
): EncodedTx {
  const config = loadConfig();
  const smAbi = getAbiByName("SessionManager");
  const smIface = new ethers.Interface(smAbi);
  const sessionCalldata = smIface.encodeFunctionData("setSessionTargets", [
    sessionId,
    targets,
  ]);

  const walletAbi = getAbiByName("AgentWallet");
  const walletIface = new ethers.Interface(walletAbi);
  const executeCalldata = walletIface.encodeFunctionData("execute", [
    config.contracts.sessionManager,
    0,
    sessionCalldata,
  ]);

  return {
    to: walletAddress,
    data: executeCalldata,
    value: "0x0",
    chainId: config.chainId,
  };
}

// ── Write Operations (on-chain transactions) ──────────────────────

/**
 * Proposes a credential-root update. Returns the proposal tx — the root itself does NOT change until the 2-day timelock passes AND sendRootAccept() succeeds. Callers must report "proposed", never "updated".
 * @returns { txHash, blockNumber } of the mined proposal transaction.
 * @throws When the signer is not the registry owner, or the RPC fails after retries.
 * Maps to: contract CredentialRegistry.proposeActiveRoot; CLI 'agentix cred' propose; REST root-proposal route.
 * Side effects: submits an on-chain transaction (gas); retried up to 3x on failure.
 * Security: registry-owner only.
 */
export async function sendRootProposal(root: string): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.proposeActiveRoot(root);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRootProposal");
}

/**
 * Completes a pending credential-root proposal after the 2-day timelock. Reverts before the delay (TimelockNotReady).
 * This is the step that actually changes the live root.
 * @returns { txHash, blockNumber } of the mined accept transaction.
 * @throws TimelockNotReady when the delay has not elapsed; revert when no proposal is pending; RPC errors after retries.
 * Maps to: contract CredentialRegistry.acceptActiveRoot; CLI 'agentix cred' accept; event ActiveRootUpdated.
 * Side effects: submits an on-chain transaction (gas); retried up to 3x on failure.
 * Security: registry-owner only.
 */
export async function sendRootAccept(): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.acceptActiveRoot();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRootAccept");
}

/**
 * Cancels a pending credential-root proposal.
 * After cancel the live root is unchanged and a new proposal can be made.
 * @returns { txHash, blockNumber } of the mined cancel transaction.
 * @throws Revert when no proposal is pending; RPC errors after retries.
 * Maps to: contract CredentialRegistry.cancelActiveRoot; CLI 'agentix cred' cancel.
 * Side effects: submits an on-chain transaction (gas); retried up to 3x on failure.
 * Security: registry-owner only.
 */
export async function sendRootCancel(): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.cancelActiveRoot();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRootCancel");
}

/**
 * Completes a pending revoked-secret-root proposal after the 2-day timelock.
 * This is the step that actually changes the live revoked root.
 * @returns { txHash, blockNumber } of the mined accept transaction.
 * @throws TimelockNotReady when the delay has not elapsed; revert when no proposal is pending; RPC errors after retries.
 * Maps to: contract CredentialRegistry.acceptRevokedSecretRoot; event RevokedSecretRootUpdated.
 * Side effects: submits an on-chain transaction (gas); retried up to 3x on failure.
 * Security: registry-owner only.
 */
export async function sendRevokedRootAccept(): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.acceptRevokedSecretRoot();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRevokedRootAccept");
}

/**
 * Cancels a pending revoked-secret-root proposal.
 * After cancel the live revoked root is unchanged and a new proposal can be made.
 * @returns { txHash, blockNumber } of the mined cancel transaction.
 * @throws Revert when no proposal is pending; RPC errors after retries.
 * Maps to: contract CredentialRegistry.cancelRevokedSecretRoot.
 * Side effects: submits an on-chain transaction (gas); retried up to 3x on failure.
 * Security: registry-owner only.
 */
export async function sendRevokedRootCancel(): Promise<{ txHash: string; blockNumber: number }> {
  return withRetry(async () => {
    const credReg = getContract("CredentialRegistry", true);
    const tx = await credReg.cancelRevokedSecretRoot();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }, "sendRevokedRootCancel");
}

/**
 * Reports whether an address is a registered credential issuer.
 * Only issuers can anchor credentials; the check gates the owner-only root flows in the CLI and REST layers.
 * @returns True when the address is a registered issuer, false otherwise.
 * @throws When the RPC call fails (no fallback here — a single provider read).
 * Maps to: contract CredentialRegistry.issuers; CLI 'agentix cred' and REST root routes (authorization gate).
 */
export async function isIssuer(address: string): Promise<boolean> {
  const credReg = getReadonlyContract("CredentialRegistry");
  return credReg.issuers(address) as Promise<boolean>;
}

/**
 * Returns the configured signer's address from the core provider module.
 * Unlike the SDK registry's sync stub (which returns the literal '0x'), this one returns the real address — the core provider holds the signer synchronously.
 * @returns The signer address.
 * @throws When no signer is configured in the core provider.
 * Maps to: internal — CLI 'agentix cred' and REST root routes (issuer checks).
 */
export function getSignerAddress(): string {
  return getSigner().address;
}

// ── Event Parsing ─────────────────────────────────────────────────

/**
 * Extracts a newly-created wallet address from transaction logs (WalletCreated topic, else any factory log's first topic).
 * The first pass matches the WalletCreated signature hash exactly; the fallback trusts any log from the factory address with 2+ topics, which can misattribute when the factory emits other events — treat a fallback result as a guess, not proof.
 * @param logs - Receipt logs (ethers Log objects with topics/address); @param factoryAddress - The factory contract address for the fallback pass.
 * @returns The wallet address, or null when no log matches.
 * Maps to: internal — wallet creation flows (a same-named helper also exists in core/tx-builder.ts).
 */
export function extractWalletAddressFromLogs(logs: any[], factoryAddress: string): string | null {
  const walletCreatedTopic = ethers.id("WalletCreated(address,address,bytes32,address)");
  for (const log of logs) {
    if (log.topics?.[0] === walletCreatedTopic) {
      return "0x" + log.topics[1].slice(26);
    }
  }
  for (const log of logs) {
    if (log.address?.toLowerCase() === factoryAddress.toLowerCase() && log.topics?.length >= 2) {
      return "0x" + log.topics[1].slice(26);
    }
  }
  return null;
}
