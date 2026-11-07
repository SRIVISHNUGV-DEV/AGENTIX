import { ethers } from "ethers";
import { getProvider, getSigner } from "../core/provider";
import { getProxyGuard } from "../core/proxy-guard";
import { loadConfig } from "../core/config";
import { runExecute, runQuery, runSingle } from "../core/database";
import { getEventBus } from "../../packages/core/eventbus";
import { generateId } from "../../packages/shared/utils";

const FACTORY_ABI = [
  "function createWallet(address owner) returns (address)",
  "function isAgentWallet(address) view returns (bool)",
  "function agentWallets(address) view returns (bool)",
  "function walletCount() view returns (uint256)",
];

const WALLET_ABI = [
  "function owner() view returns (address)",
  "function sessionManager() view returns (address)",
  "function entryPoint() view returns (address)",
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] data)",
  "function addDeposit() payable",
  "function withdrawDepositTo(address recipient, uint256 amount)",
  "function getDeposit() view returns (uint256)",
  "function checkBalance() view returns (uint256)",
  "function changeOwner(address newOwner)",
];

const SESSION_ABI = [
  "function createLightweightSession(bytes32 sessionId, address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint64 expiry, address[] allowedTargets, bytes ownerSignature)",
  "function validateLightweightSession(bytes32 sessionId, address signer, uint256 value, address target, bytes data) view returns (bool)",
  "function revokeLightweightSession(bytes32 sessionId, address wallet)",
  "function getLightSession(bytes32 sessionId) view returns (address, address, uint256, uint256, uint256, uint256, uint64, bool)",
  "function getSessionType(bytes32 sessionId) view returns (uint8)",
  "function walletSessions(address) view returns (bytes32[])",
];

const DELEGATION_ABI = [
  "function proposeDelegationRoot(address delegator, bytes32 scopeHash, bytes32 newRoot, uint64 expiresAt)",
  "function acceptDelegationRoot(address delegator, bytes32 scopeHash)",
  "function cancelDelegationRoot(address delegator, bytes32 scopeHash)",
  "function revokeDelegation(bytes32 delegationLeafHash, address delegator)",
  "function verifyDelegation(bytes32 delegationLeaf, bytes32[] merkleProof, address delegator, bytes32 scopeHash, uint64 expiresAt, uint8 maxDepth) view returns (bool)",
  "function getDelegationRoot(address delegator, bytes32 scopeHash) view returns (bytes32 root, uint64 expiresAt, uint64 createdAt)",
  "function isRevoked(address delegator, bytes32 leafHash) view returns (bool)",
  "function registerScope(string action)",
];

// ── Wallet ─────────────────────────────────────────────────────────────

/**
 * Deploy an AgentWallet via the factory and record it locally (fast path).
 * The quick path skips the tools/wallet.ts harness checks and talks to the
 * factory ABI directly; the wallet address comes from the WalletCreated event.
 * If no event is parsed it falls back to a walletCount-based derivation that
 * calls getAddress — which is NOT in FACTORY_ABI — so a missing event makes
 * the returned address unreliable; treat it as suspect.
 * @param ownerAddress - Defaults to the runtime signer's address when omitted.
 * @returns {success, walletAddress, owner, txHash, entryPoint}; throws (not success:false) when the factory call, receipt wait or DB insert fails.
 * @throws Throws on factory/receipt/DB failure; also throws from the event-less fallback path.
 * Maps to: contract AgentWalletFactory.createWallet; event WalletCreated.
 * Side effects: on-chain deployment (gas) + local DB insert + WalletCreated event-bus emit.
 * Security: the runtime signer pays deployment gas and the owner becomes the wallet's owner — verify the owner address before calling.
 */
export async function quickCreateWallet(ownerAddress?: string): Promise<any> {
  const config = loadConfig();
  const guard = getProxyGuard();
  const signer = getSigner();
  const owner = ownerAddress || signer.address;

  const factoryAddr = guard.getProxyAddress("agentWalletFactory");
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, signer);

  const tx = await factory.createWallet(owner);
  const receipt = await tx.wait();

  const event = receipt.logs?.find((l: any) => {
    try { return factory.interface.parseLog(l)?.name === "WalletCreated"; } catch { return false; }
  });

  let walletAddress = "";
  if (event) {
    const parsed = factory.interface.parseLog(event);
    walletAddress = parsed?.args?.wallet || "";
  } else {
    const count = await factory.walletCount();
    const salt = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256"], [owner, config.chainId, count - 1]
    );
    walletAddress = await (factory as any).getAddress(salt);
  }

  runExecute(
    "INSERT OR IGNORE INTO wallets (wallet_address, owner_address, entry_point, created_at) VALUES (?, ?, ?, ?)",
    walletAddress, owner, config.contracts.entryPoint, Math.floor(Date.now() / 1000)
  );

  getEventBus().emit({ type: "WalletCreated", data: { walletAddress, ownerAddress: owner } });

  return {
    success: true,
    walletAddress,
    owner,
    txHash: receipt.hash,
    entryPoint: config.contracts.entryPoint,
  };
}

/**
 * One wallet by address, from the local DB (no on-chain read).
 * @param walletAddress - Exact address stored by quickCreateWallet.
 * @returns The raw DB row with success:true, or {success:false, error:"Wallet not found in local DB"}.
 * @throws Throws if the DB cannot be read.
 * Maps to: MCP tool agentix_wallet_list (single-row read behind the list/get path).
 * Side effects: read-only DB query.
 */
export function quickGetWallet(walletAddress: string): any {
  const wallet = runSingle<any>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress);
  if (!wallet) return { success: false, error: "Wallet not found in local DB" };
  return { success: true, ...wallet };
}

/**
 * All locally recorded wallets, newest first.
 * @returns Raw DB rows (empty array when none); throws on DB failure.
 * Maps to: MCP tool agentix_wallet_list.
 * Side effects: read-only DB query.
 */
export function quickListWallets(): any[] {
  return runQuery("SELECT * FROM wallets ORDER BY created_at DESC") || [];
}

// ── Lightweight Sessions ───────────────────────────────────────────────

/**
 * Create a lightweight session on-chain (fast path, owner-signed, no ZK proof).
 * The owner signature covers (chainId, sessionManager, wallet, sessionId,
 * sessionKey, dailySpendLimit, dailyTxLimit, expiry); token selectors are
 * DENIED on-chain unless their token contracts are in allowedTargets — an empty
 * allowlist still allows non-token targets but denies every token move.
 * @param walletAddress - Wallet the session is bound to; @param sessionKey - Agent address allowed to act under the session.
 * @param dailySpendLimit - Wei as a decimal string; @param dailyTxLimit - Max tx per day; @param expirySeconds - Lifetime from now, in seconds.
 * @param allowedTargets - Token contracts this session may pay with; default [] (no token moves).
 * @returns {success, sessionId, walletAddress, sessionKey, limits, expiry, txHash}; throws on contract/DB failure.
 * @throws Throws on owner lookup, signing, contract or DB failure.
 * Maps to: contract SessionManager.createLightweightSession; event SessionCreated.
 * Side effects: on-chain transaction (gas) + local DB insert + SessionCreated event-bus emit.
 * Security: the session key is the agent's address — anyone holding that key can spend up to the limits until expiry or revocation.
 */
export async function quickCreateSession(
  walletAddress: string,
  sessionKey: string,
  dailySpendLimit: string,
  dailyTxLimit: number,
  expirySeconds: number,
  // C-1 rule: token selectors are DENIED on-chain unless the token
  // contract is in the session's allowlist. Pass token contracts this
  // session must pay with here; an empty allowlist still allows
  // non-token targets but denies every token move.
  allowedTargets: string[] = []
): Promise<any> {
  const config = loadConfig();
  const guard = getProxyGuard();
  const signer = getSigner();

  const sessionMgrAddr = guard.getProxyAddress("sessionManager");
  const sessionMgr = new ethers.Contract(sessionMgrAddr, SESSION_ABI, signer);

  const sessionId = ethers.solidityPackedKeccak256(
    ["address", "uint256", "string"], [walletAddress, Date.now(), generateId()]
  );

  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;

  const messageHash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
    [config.chainId, sessionMgrAddr, walletAddress, sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry]
  );

  const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);
  const ownerAddress = await wallet.owner();

  const ownerSigner = getSigner();
  const signature = await ownerSigner.signMessage(ethers.getBytes(messageHash));

  const tx = await sessionMgr.createLightweightSession(
    sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry, allowedTargets, signature
  );
  const receipt = await tx.wait();

  runExecute(
    "INSERT INTO sessions (session_id, wallet_address, session_key, session_type, daily_spend_limit, daily_tx_limit, expiry, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
    sessionId, walletAddress, sessionKey, dailySpendLimit, dailyTxLimit, expiry, Math.floor(Date.now() / 1000)
  );

  getEventBus().emit({ type: "SessionCreated", data: { sessionId, walletAddress } });

  return {
    success: true,
    sessionId,
    walletAddress,
    sessionKey,
    dailySpendLimit,
    dailyTxLimit,
    expiry,
    txHash: receipt.hash,
  };
}

/**
 * On-chain check: is this session valid for this signer, value, target and calldata.
 * Target is required — the 5-arg validator denies zero/protocol targets and token
 * selectors on non-allowlisted targets, so a target-less check would answer a
 * different question; no dummy target is passed.
 * @param sessionId - Session to check; @param signer - Session-key address; @param value - Wei as a decimal string.
 * @param target - Contract address the session would call (required); @param data - Calldata, defaults to "0x".
 * @returns {success, valid} (valid:false + error when target is missing); a reverted validation returns success:false, not valid:false.
 * @throws Never throws: contract failures are returned as success:false.
 * Maps to: MCP tool agentix_session_validate.
 * Side effects: read-only contract call.
 */
export async function quickValidateSession(
  sessionId: string, signer: string, value: string,
  // Target is required: the 5-arg validator denies zero/protocol targets
  // and token selectors on non-allowlisted targets, so a target-less
  // check would answer a different question. No dummy target is passed.
  target?: string, data: string = "0x"
): Promise<any> {
  const guard = getProxyGuard();
  const provider = getProvider();
  const sessionMgr = new ethers.Contract(guard.getProxyAddress("sessionManager"), SESSION_ABI, provider);

  if (!target) {
    return { success: false, valid: false, error: "target is required: pass the contract address the session would call, and data (default 0x) for its calldata" };
  }

  try {
    const valid = await sessionMgr.validateLightweightSession(sessionId, signer, value, target, data);
    return { success: true, valid };
  } catch (e: any) {
    return { success: false, valid: false, error: e.reason || e.message };
  }
}

/**
 * Revoke a lightweight session on-chain and mark it revoked locally.
 * Revocation is immediate on-chain — the session key stops working as soon as
 * the tx confirms, regardless of remaining limits or expiry.
 * @param sessionId - Session to revoke; @param walletAddress - Wallet the session belongs to.
 * @returns {success, sessionId, txHash}; throws on contract/DB failure.
 * @throws Throws on contract or DB failure.
 * Maps to: contract SessionManager.revokeLightweightSession; event SessionRevoked.
 * Side effects: on-chain transaction (gas) + local DB update + SessionRevoked event-bus emit.
 */
export async function quickRevokeSession(sessionId: string, walletAddress: string): Promise<any> {
  const guard = getProxyGuard();
  const signer = getSigner();
  const sessionMgr = new ethers.Contract(guard.getProxyAddress("sessionManager"), SESSION_ABI, signer);

  const tx = await sessionMgr.revokeLightweightSession(sessionId, walletAddress);
  const receipt = await tx.wait();

  runExecute("UPDATE sessions SET revoked = 1, revoked_at = ? WHERE session_id = ?", Math.floor(Date.now() / 1000), sessionId);
  getEventBus().emit({ type: "SessionRevoked", data: { sessionId } });

  return { success: true, sessionId, txHash: receipt.hash };
}

/**
 * All locally recorded sessions for one wallet, newest first.
 * @param walletAddress - Wallet whose sessions to list; unknown wallets yield an empty list.
 * @returns Raw DB rows (empty array when none); throws on DB failure.
 * Maps to: MCP tool agentix_session_list (wallet filter).
 * Side effects: read-only DB query.
 */
export function quickListSessions(walletAddress: string): any[] {
  return runQuery("SELECT * FROM sessions WHERE wallet_address = ? ORDER BY created_at DESC", walletAddress) || [];
}

// ── Whitelist ──────────────────────────────────────────────────────────
// AgentWallet has NO whitelist feature: neither setWhiteListedSelector
// nor setWhiteListedParty exists on the contract (verified against the
// fresh ABI), and the contract test suite's whitelist tests were deleted
// for exactly that reason. This helper therefore fails explicitly instead
// of calling a nonexistent function and surfacing a confusing revert.
// Authorization is handled by SessionManager (session allowlists).
/**
 * Always fails: AgentWallet has NO whitelist feature.
 * Neither setWhiteListedSelector nor setWhiteListedParty exists on the contract
 * (verified against the fresh ABI), so this returns an explicit error instead of
 * sending a call that would revert confusingly. Authorization lives in
 * SessionManager session allowlists.
 * @param walletAddress - Wallet (echoed in the error); @param target - Intended whitelisted address (echoed); @param selector - Intended function selector (echoed).
 * @returns Always {success:false, error} explaining the missing feature and pointing at setSessionTargets / allowedTargets.
 * @throws Never throws.
 * Maps to: internal — SessionManager session allowlists (setSessionTargets / allowedTargets at creation).
 * Side effects: none — no contract call is made.
 */
export async function quickWhitelist(walletAddress: string, target: string, selector: string): Promise<any> {
  return {
    success: false,
    walletAddress,
    target,
    selector,
    error: "AgentWallet does not support whitelisting: no setWhiteListedSelector function exists on the contract. Authorization is handled by SessionManager session allowlists (setSessionTargets / allowedTargets at creation).",
  };
}

// ── Execute ────────────────────────────────────────────────────────────

/**
 * Execute one call through the wallet as its owner (fast path, no session limits).
 * The owner signature path — this bypasses session spend/tx limits entirely, so
 * it is the owner's direct execution, not an agent action under a session.
 * @param walletAddress - Wallet to execute from; @param target - Call destination; @param value - ETH as a decimal string ("0" allowed); @param data - Calldata, "0x" for a plain transfer.
 * @returns {success, txHash, target, value}; throws on contract failure.
 * @throws Throws on contract failure (including a revert from the target call).
 * Maps to: contract AgentWallet.execute; event ActionExecuted.
 * Side effects: on-chain transaction (gas + value transferred) + ActionExecuted event-bus emit.
 * Security: value transfer with the owner's authority — the target and data are executed exactly as passed, with no policy check in this path.
 */
export async function quickExecute(walletAddress: string, target: string, value: string, data: string): Promise<any> {
  const guard = getProxyGuard();
  const signer = getSigner();
  const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);

  const tx = await wallet.execute(target, ethers.parseEther(value || "0"), data || "0x");
  const receipt = await tx.wait();

  getEventBus().emit({ type: "ActionExecuted", data: { action: "execute", success: true } });

  return { success: true, txHash: receipt.hash, target, value };
}

// ── Delegation ─────────────────────────────────────────────────────────

/**
 * Propose a delegation root on-chain (fast path, no org) and store the row as inactive.
 * Same timelock rule as tools/delegation.ts: this PROPOSES only — the delegation
 * becomes effective after the 2-day timelock AND an acceptDelegationRoot() call,
 * and the result says "proposed", never "created".
 * @param delegatorAddress - Address granting the scope; @param delegateeAddress - Address receiving it; @param scope - Free-form scope string, hashed on-chain.
 * @param expirySeconds - Lifetime from now, in seconds.
 * @returns {success, status:"proposed", message, scopeHash, leaf, expiry, txHash}; throws on contract/DB failure.
 * @throws Throws on contract or DB failure.
 * Maps to: contract DelegationManager.proposeDelegationRoot; event DelegationCreated.
 * Side effects: on-chain transaction (gas) + local DB insert (active=0, empty organization_id) + DelegationCreated event-bus emit.
 */
export async function quickCreateDelegation(
  delegatorAddress: string,
  delegateeAddress: string,
  scope: string,
  expirySeconds: number
): Promise<any> {
  const guard = getProxyGuard();
  const signer = getSigner();
  const delegationMgr = new ethers.Contract(guard.getProxyAddress("delegationManager"), DELEGATION_ABI, signer);

  const scopeHash = ethers.solidityPackedKeccak256(["string"], [scope]);
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;

  const leaf = ethers.solidityPackedKeccak256(
    ["address", "address", "bytes32", "uint64"],
    [delegatorAddress, delegateeAddress, scopeHash, expiry]
  );

  const zeroProof: string[] = [];
  // PROPOSE, not update: since the C-5 timelock fix, a delegation root
  // changes only after the 2-day timelock AND an acceptDelegationRoot()
  // call. This function reports "proposed" and leaves the delegation
  // inactive until accepted — never "created" as active.
  const tx = await delegationMgr.proposeDelegationRoot(delegatorAddress, scopeHash, leaf, expiry);
  const receipt = await tx.wait();

  const delegationId = `del_${generateId()}`;
  runExecute(
    "INSERT OR REPLACE INTO delegations (delegation_id, organization_id, delegator, delegatee, scope, max_value, expiry, active, created_at) VALUES (?, '', ?, ?, ?, '0', ?, 0, ?)",
    delegationId, delegatorAddress, delegateeAddress, scope, expiry, Math.floor(Date.now() / 1000)
  );

  getEventBus().emit({ type: "DelegationCreated", data: { delegationId } });

  return {
    success: true,
    status: "proposed",
    message: "Delegation root proposed on-chain. It becomes effective only after the 2-day timelock AND an acceptDelegationRoot(delegator, scopeHash) call.",
    delegator: delegatorAddress,
    delegatee: delegateeAddress,
    scope,
    scopeHash,
    leaf,
    expiry,
    txHash: receipt.hash,
  };
}

/**
 * On-chain check: does this delegation leaf verify under an empty (single-leaf) Merkle proof.
 * Verifies a single-leaf tree (root == leaf), which is the shape
 * quickCreateDelegation publishes — a delegation inside a larger tree needs a real proof and will not verify here.
 * @param delegationLeaf - Leaf hash to verify; @param delegatorAddress - Delegator the leaf commits to; @param scope - Scope string, hashed on-chain; @param expiry - Unix timestamp (seconds) the leaf commits to.
 * @returns {success, valid}; a reverted verification returns success:false, not valid:false.
 * @throws Never throws: contract failures are returned as success:false.
 * Maps to: MCP tool agentix_delegation_verify.
 * Side effects: read-only contract call.
 */
export async function quickVerifyDelegation(
  delegationLeaf: string,
  delegatorAddress: string,
  scope: string,
  expiry: number
): Promise<any> {
  const guard = getProxyGuard();
  const provider = getProvider();
  const delegationMgr = new ethers.Contract(guard.getProxyAddress("delegationManager"), DELEGATION_ABI, provider);

  const scopeHash = ethers.solidityPackedKeccak256(["string"], [scope]);

  try {
    const valid = await delegationMgr.verifyDelegation(
      delegationLeaf, [], delegatorAddress, scopeHash, expiry, 1
    );
    return { success: true, valid };
  } catch (e: any) {
    return { success: false, error: e.reason || e.message };
  }
}

// ── Balance / Deposit ──────────────────────────────────────────────────

/**
 * Fund a wallet's EntryPoint deposit (gas for sponsored UserOps).
 * Sends ETH with the call — the amount is value, not a parameter to the contract
 * — and the deposit is what the bundler draws on for the wallet's UserOps.
 * @param walletAddress - Wallet to fund; @param amount - ETH as a decimal string.
 * @returns {success, amount, txHash}; throws on contract failure.
 * @throws Throws on contract failure.
 * Maps to: contract AgentWallet.addDeposit.
 * Side effects: on-chain transaction moving `amount` ETH into the EntryPoint deposit.
 * Security: value transfer — verify the wallet address; a deposit to the wrong wallet is only recoverable via withdrawGas by that wallet's owner.
 */
export async function quickDeposit(walletAddress: string, amount: string): Promise<any> {
  const guard = getProxyGuard();
  const signer = getSigner();
  const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);

  const tx = await wallet.addDeposit({ value: ethers.parseEther(amount) });
  const receipt = await tx.wait();

  return { success: true, amount, txHash: receipt.hash };
}

/**
 * A wallet's ETH balance and EntryPoint deposit, read on-chain.
 * Two different numbers: the wallet's own ETH (spendable via execute) and its
 * EntryPoint deposit (gas for UserOps) — do not confuse them.
 * @param walletAddress - Wallet to query.
 * @returns {success, walletAddress, ethBalance, entryPointDeposit} as ETH decimal strings; throws on RPC/contract failure.
 * @throws Throws on RPC or contract failure.
 * Maps to: MCP tool agentix_wallet_balance.
 * Side effects: read-only RPC + contract calls (parallel).
 */
export async function quickBalance(walletAddress: string): Promise<any> {
  const guard = getProxyGuard();
  const provider = getProvider();
  const wallet = new ethers.Contract(walletAddress, WALLET_ABI, provider);

  const [ethBalance, depositBalance] = await Promise.all([
    provider.getBalance(walletAddress),
    wallet.getDeposit(),
  ]);

  return {
    success: true,
    walletAddress,
    ethBalance: ethers.formatEther(ethBalance),
    entryPointDeposit: ethers.formatEther(depositBalance),
  };
}
