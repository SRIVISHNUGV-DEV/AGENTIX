import { ethers } from "ethers";
import { getContract, getReadonlyContract, getWalletContract } from "../contracts";
import { runExecute, runSingle } from "../core/database";
import { getSigner } from "../core/provider";
import { logger } from "../core/logger";

export interface SessionResult {
  success: boolean;
  sessionId?: string;
  sessionKey?: string;
  wallet?: string;
  expiry?: number;
  txHash?: string;
  error?: string;
  details?: any;
}

/**
 * Create a lightweight session on-chain: owner-signed, no ZK proof needed.
 * The fast session type — the owner signs (sessionId, sessionKey, limits,
 * expiry) and the SessionManager records it; token selectors are DENIED
 * on-chain unless their token contracts are in allowedTargets, and an empty
 * allowlist still allows non-token targets but denies every token move.
 * @param walletAddress - Wallet the session is bound to; @param sessionKey - Agent address allowed to act under the session.
 * @param dailySpendLimit - Wei as a decimal string; @param dailyTxLimit - Max tx per day; @param expiry - Unix timestamp (seconds), NOT a duration.
 * @param allowedTargets - Token contracts this session may pay with; default [] (no token moves).
 * @returns SessionResult with sessionId, sessionKey, wallet, expiry and txHash; success:false + error on signing/contract/DB failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract SessionManager.createLightweightSession.
 * Side effects: on-chain transaction (gas) + local DB insert (INSERT OR REPLACE). Unlike quickCreateSession, this path emits no SessionCreated event-bus event.
 * Security: the session key is the agent's address — anyone holding that key can spend up to the limits until expiry or revocation.
 */
export async function createLightweightSession(
  walletAddress: string,
  sessionKey: string,
  dailySpendLimit: string,
  dailyTxLimit: number,
  expiry: number,
  // C-1 rule: token selectors (ERC-20 transfer/approve/transferFrom,
  // ERC-721 transferFrom/safeTransferFrom) are DENIED on-chain unless the
  // token contract is in the session's allowlist. An empty allowlist still
  // allows NON-token targets, but it does NOT mean "no restriction" for
  // tokens. Pass the token contracts this session must pay with here.
  allowedTargets: string[] = []
): Promise<SessionResult> {
  try {
    const signer = getSigner();
    const wallet = getWalletContract(walletAddress);

    const sessionId = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "address", "uint256"],
        [walletAddress, sessionKey, BigInt(Math.floor(Date.now() / 1000))]
      )
    );

    const ownerAddress = await wallet.owner();
    const message = ethers.solidityPacked(
      ["bytes32", "address", "uint256", "uint256", "uint64"],
      [sessionId, sessionKey, BigInt(dailySpendLimit), BigInt(dailyTxLimit), BigInt(expiry)]
    );
    const messageHash = ethers.keccak256(message);
    const ownerSig = await signer.signMessage(ethers.getBytes(messageHash));

    logger.info("session", `Creating lightweight session ${sessionId.slice(0, 20)}...`);

    const sessionMgr = getContract("SessionManager");
    const tx = await sessionMgr.createLightweightSession(
      sessionId,
      sessionKey,
      BigInt(dailySpendLimit),
      BigInt(dailyTxLimit),
      BigInt(expiry),
      allowedTargets,
      ownerSig
    );
    const receipt = await tx.wait();

    runExecute(
      `INSERT OR REPLACE INTO sessions
       (session_id, wallet_address, session_key, session_type, daily_spend_limit, daily_tx_limit, expiry, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      sessionId,
      walletAddress,
      sessionKey,
      dailySpendLimit,
      dailyTxLimit,
      expiry,
      Math.floor(Date.now() / 1000)
    );

    logger.info("session", `Lightweight session created: ${sessionId}`);

    return {
      success: true,
      sessionId,
      sessionKey,
      wallet: walletAddress,
      expiry,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("session", `Failed to create session: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Validate a lightweight session for a SPECIFIC intended call.
 * target is required and data defaults to "0x": the 5-arg on-chain
 * validator denies zero/protocol targets and token selectors on
 * non-allowlisted targets, so a target-less check would answer a different
 * question than the caller asked. There is no neutral target — passing a
 * dummy would change validation semantics — so a missing target is an
 * explicit error, not a defaulted call.
 * @param sessionId - Session to check; @param signerAddress - Session-key address; @param value - ETH as a decimal string (parsed with parseEther).
 * @param target - Contract address the session would call (required); @param data - Calldata, defaults to "0x".
 * @returns SessionResult with success = on-chain validity and details {valid, value, target, data}; success:false + error when target is missing or the call fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_session_validate / contract SessionManager.validateLightweightSession.
 * Side effects: read-only contract call.
 */
export async function validateSession(
  sessionId: string,
  signerAddress: string,
  value: string,
  target?: string,
  data: string = "0x"
): Promise<SessionResult> {
  try {
    if (!target) {
      return {
        success: false,
        sessionId,
        error: "target is required: pass the contract address the session would call, and data (default 0x) for its calldata",
      };
    }
    const sessionMgr = getContract("SessionManager");
    const isValid = await sessionMgr.validateLightweightSession(
      sessionId,
      signerAddress,
      BigInt(ethers.parseEther(value)),
      target,
      data
    );

    return {
      success: isValid,
      sessionId,
      details: { valid: isValid, value, target, data },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Read a session's target allowlist (works for standard and lightweight
 * sessions — both share the sessionTargets mapping on-chain).
 * Empty array = no allowlist set = token selectors DENIED on-chain.
 * @param sessionId - Session to query.
 * @returns string[] of allowlisted target addresses (copy — mutating it changes nothing on-chain); empty when no allowlist is set.
 * @throws Throws when the contract call fails (unknown session reverts).
 * Maps to: contract SessionManager.getSessionTargets.
 * Side effects: read-only contract call.
 */
export async function getSessionTargets(sessionId: string): Promise<string[]> {
  const sessionMgr = getReadonlyContract("SessionManager");
  const targets = await sessionMgr.getSessionTargets(sessionId);
  return [...(targets as string[])];
}

/**
 * Set a STANDARD session's target allowlist. Only the bound wallet may
 * call this on-chain (msg.sender == wallet), so this sends
 * wallet.execute(sessionManager, 0, setSessionTargets(...)) from the
 * runtime signer — which must be the wallet owner in the local setup.
 * Standard sessions have no allowlist parameter at creation, so this is
 * the required follow-up for any standard session intended for token
 * payments: without it, every token transfer reverts on-chain.
 * (Lightweight sessions take allowedTargets at creation instead.)
 * @param walletAddress - Wallet owning the session (the runtime signer must be its owner); @param sessionId - Standard session to update; @param targets - Full replacement allowlist (not additive).
 * @returns SessionResult with sessionId, wallet, txHash and details.targets; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract SessionManager.setSessionTargets (via AgentWallet.execute).
 * Side effects: on-chain transaction through the wallet (gas).
 * Security: the allowlist is the token-payment gate — an overly broad list lets the session drain to any listed token contract.
 */
export async function setSessionTargets(
  walletAddress: string,
  sessionId: string,
  targets: string[]
): Promise<SessionResult> {
  try {
    const { loadConfig } = await import("../core/config");
    const config = loadConfig();
    const wallet = getWalletContract(walletAddress);
    const sessionMgr = getContract("SessionManager");
    const inner = sessionMgr.interface.encodeFunctionData("setSessionTargets", [sessionId, targets]);
    const tx = await wallet.execute(config.contracts.sessionManager, 0, inner);
    const receipt = await tx.wait();
    logger.info("session", `Session targets set for ${sessionId.slice(0, 20)}...: ${targets.join(",")}`);
    return { success: true, sessionId, wallet: walletAddress, txHash: receipt.hash, details: { targets } };
  } catch (e: any) {
    logger.error("session", `Failed to set session targets: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Revoke a lightweight session on-chain and mark it revoked locally.
 * Revocation is immediate on-chain — the session key stops working as soon as
 * the tx confirms, regardless of remaining limits or expiry.
 * @param sessionId - Session to revoke; @param walletAddress - Wallet the session belongs to.
 * @returns SessionResult with sessionId and txHash; success:false + error on contract/DB failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract SessionManager.revokeLightweightSession.
 * Side effects: on-chain transaction (gas) + local DB update.
 */
export async function revokeSession(
  sessionId: string,
  walletAddress: string
): Promise<SessionResult> {
  try {
    const sessionMgr = getContract("SessionManager");
    const tx = await sessionMgr.revokeLightweightSession(sessionId, walletAddress);
    const receipt = await tx.wait();

    runExecute("UPDATE sessions SET revoked = 1, revoked_at = ? WHERE session_id = ?", Math.floor(Date.now() / 1000), sessionId);

    logger.info("session", `Session revoked: ${sessionId}`);

    return {
      success: true,
      sessionId,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * One session by id, read on-chain, with type-specific details.
 * Session type 1 is lightweight (spend/tx limits + usage); anything else is
 * read as a full session (maxValue/valueUsed) via the sessions mapping.
 * @param sessionId - Session id; unknown ids make the contract call revert, surfaced as success:false.
 * @returns SessionResult with sessionKey, wallet, expiry and details {type, limits/usage, revoked}; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_session_status / contract SessionManager.getLightSession / sessions.
 * Side effects: read-only contract calls.
 */
export async function getSession(sessionId: string): Promise<SessionResult> {
  try {
    const sessionMgr = getReadonlyContract("SessionManager");
    const sessionType = await sessionMgr.getSessionType(sessionId);

    if (sessionType === 1) {
      const light = await sessionMgr.getLightSession(sessionId);
      return {
        success: true,
        sessionId,
        sessionKey: light.sessionKey,
        wallet: light.sessionWallet,
        expiry: Number(light.expiry),
        details: {
          type: "lightweight",
          dailySpendLimit: light.dailySpendLimit.toString(),
          dailyTxLimit: Number(light.dailyTxLimit),
          dailySpendUsed: light.dailySpendUsed.toString(),
          dailyTxUsed: Number(light.dailyTxUsed),
          revoked: light.revoked,
        },
      };
    }

    const session = await sessionMgr.sessions(sessionId);
    return {
      success: true,
      sessionId,
      sessionKey: session.sessionKey,
      wallet: session.wallet,
      expiry: Number(session.expiry),
      details: {
        type: "full",
        maxValue: session.maxValue.toString(),
        valueUsed: session.valueUsed.toString(),
        revoked: session.revoked,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * All sessions of one wallet, newest on-chain order, each read via getSession.
 * N+1 on-chain reads — one getWalletSessions call plus one getSession per id —
 * so a wallet with many sessions is slow; the local quickListSessions is the cheap alternative.
 * @param walletAddress - Wallet whose sessions to list.
 * @returns SessionResult[] (empty when the wallet has none); a failure yields [{success:false, error}] — and a single getSession failure inside the loop propagates as that same single-element result.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_session_list (wallet filter) / contract SessionManager.getWalletSessions.
 * Side effects: read-only contract calls (1 + N).
 */
export async function listWalletSessions(walletAddress: string): Promise<SessionResult[]> {
  try {
    const sessionMgr = getReadonlyContract("SessionManager");
    const sessionIds = await sessionMgr.getWalletSessions(walletAddress);

    const results: SessionResult[] = [];
    for (const sid of sessionIds) {
      const result = await getSession(sid);
      results.push(result);
    }
    return results;
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}
