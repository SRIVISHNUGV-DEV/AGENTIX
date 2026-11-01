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

export function quickGetWallet(walletAddress: string): any {
  const wallet = runSingle<any>("SELECT * FROM wallets WHERE wallet_address = ?", walletAddress);
  if (!wallet) return { success: false, error: "Wallet not found in local DB" };
  return { success: true, ...wallet };
}

export function quickListWallets(): any[] {
  return runQuery("SELECT * FROM wallets ORDER BY created_at DESC") || [];
}

// ── Lightweight Sessions ───────────────────────────────────────────────

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

export async function quickDeposit(walletAddress: string, amount: string): Promise<any> {
  const guard = getProxyGuard();
  const signer = getSigner();
  const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);

  const tx = await wallet.addDeposit({ value: ethers.parseEther(amount) });
  const receipt = await tx.wait();

  return { success: true, amount, txHash: receipt.hash };
}

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
