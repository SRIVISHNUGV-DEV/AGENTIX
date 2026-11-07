import { ethers } from "ethers";
import { getContract } from "../contracts";
import { runExecute, runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

export interface DelegationResult {
  success: boolean;
  delegationId?: string;
  delegator?: string;
  delegatee?: string;
  scope?: string;
  scopeHash?: string;
  leaf?: string;
  expiry?: number;
  active?: boolean;
  /** Lifecycle state: "proposed" (waiting out the 2-day timelock + accept) or "active". */
  status?: string;
  message?: string;
  txHash?: string;
  error?: string;
}

/**
 * Propose a delegation root on-chain (NOT active until accepted) and store the row as inactive.
 * A delegation is a Merkle leaf (delegator, delegatee, scopeHash, expiry) whose root
 * is published on-chain; since the C-5 timelock fix publishing is PROPOSE + ACCEPT,
 * so this call only proposes — the delegation becomes effective after the 2-day
 * timelock AND an acceptDelegation() call, and the result says "proposed", never "created".
 * @param organizationId - Owning org; @param delegator - Address granting the scope; @param delegatee - Address receiving it.
 * @param scope - Free-form scope string, hashed on-chain; @param maxValue - Stored locally only, not enforced on-chain here.
 * @param expiry - Unix timestamp (seconds) after which the delegation is dead.
 * @returns DelegationResult with delegationId, scopeHash, leaf, active:false, status:"proposed" and txHash; success:false + error on revert or DB failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract DelegationManager.proposeDelegationRoot.
 * Side effects: on-chain transaction (gas) + local DB insert (active=0).
 * Security: the caller must be the delegator (or their authorized signer); the leaf commits to the exact scope/expiry, so neither can be widened later.
 */
export async function createDelegation(
  organizationId: string,
  delegator: string,
  delegatee: string,
  scope: string,
  maxValue: string,
  expiry: number
): Promise<DelegationResult> {
  try {
    const delegationId = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "address", "address", "string"],
        [ethers.id(organizationId), delegator, delegatee, scope]
      )
    );

    logger.info("delegation", `Proposing delegation: ${delegator} → ${delegatee} (${scope})`);

    // The DelegationManager has no createDelegation() function (it never
    // did — the old call reverted). A delegation is a Merkle leaf in a
    // tree whose root is published on-chain. Single-leaf tree: root == leaf.
    // Since the C-5 timelock fix, publishing is PROPOSE + ACCEPT: this
    // call only proposes. The delegation is NOT active until the 2-day
    // timelock passes AND acceptDelegation() succeeds — the DB row stays
    // active=0 until then, and the result says "proposed", never "created".
    const scopeHash = ethers.solidityPackedKeccak256(["string"], [scope]);
    const leaf = ethers.solidityPackedKeccak256(
      ["address", "address", "bytes32", "uint64"],
      [delegator, delegatee, scopeHash, expiry]
    );

    const contract = getContract("DelegationManager");
    const tx = await contract.proposeDelegationRoot(delegator, scopeHash, leaf, expiry);
    const receipt = await tx.wait();

    runExecute(
      `INSERT OR REPLACE INTO delegations
       (delegation_id, organization_id, delegator, delegatee, scope, max_value, expiry, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      delegationId,
      organizationId,
      delegator,
      delegatee,
      scope,
      maxValue,
      expiry,
      Math.floor(Date.now() / 1000)
    );

    logger.info("delegation", `Delegation proposed: ${delegationId} (accept after 2-day timelock)`);

    return {
      success: true,
      delegationId,
      delegator,
      delegatee,
      scope,
      scopeHash,
      leaf,
      expiry,
      active: false,
      status: "proposed",
      message: "Delegation root proposed on-chain. It becomes effective only after the 2-day timelock AND an acceptDelegation() call.",
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("delegation", `Failed to create delegation: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Revoke a delegation on-chain and mark the local row inactive.
 * The on-chain call takes (leafHash, delegator), so the stored row is read first
 * and the leaf recomputed exactly as createDelegation built it — a missing row is
 * an explicit error, never a guessed call.
 * @param delegationId - Local delegation id from createDelegation.
 * @returns DelegationResult with active:false, status:"revoked" and txHash; success:false when the record is missing or the tx reverts.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract DelegationManager.revokeDelegation.
 * Side effects: on-chain transaction (gas) + local DB update.
 */
export async function revokeDelegation(delegationId: string): Promise<DelegationResult> {
  try {
    // Revocation is 2-arg on-chain (leafHash, delegator) and namespaced
    // per delegator since C-3. The CLI passes a local delegation_id, so
    // look the row up and recompute the leaf exactly as createDelegation
    // built it. A missing row is an explicit error, not a guessed call.
    const row = runSingle<{ delegator: string; delegatee: string; scope: string; expiry: number }>(
      "SELECT delegator, delegatee, scope, expiry FROM delegations WHERE delegation_id = ?",
      delegationId
    );
    if (!row) return { success: false, delegationId, error: `Delegation record ${delegationId} not found — revocation needs the stored delegator/scope to recompute the leaf` };

    const scopeHash = ethers.solidityPackedKeccak256(["string"], [row.scope]);
    const leaf = ethers.solidityPackedKeccak256(
      ["address", "address", "bytes32", "uint64"],
      [row.delegator, row.delegatee, scopeHash, row.expiry]
    );

    const contract = getContract("DelegationManager");
    const tx = await contract.revokeDelegation(leaf, row.delegator);
    await tx.wait();

    runExecute("UPDATE delegations SET active = 0 WHERE delegation_id = ?", delegationId);

    return { success: true, delegationId, active: false, status: "revoked", txHash: tx.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Complete a pending delegation-root proposal after the 2-day timelock and mark the local row active.
 * Only call once the timelock has elapsed — the contract reverts with
 * TimelockNotReady before the delay — and only then is the delegation usable.
 * @param delegationId - Local delegation id from createDelegation; the stored delegator/scope are needed to rebuild the on-chain call.
 * @returns DelegationResult with active:true, status:"active" and txHash; success:false when the record is missing or the timelock has not elapsed.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract DelegationManager.acceptDelegationRoot.
 * Side effects: on-chain transaction (gas) + local DB update (active=1).
 */
export async function acceptDelegation(delegationId: string): Promise<DelegationResult> {
  try {
    const row = runSingle<{ delegator: string; scope: string }>(
      "SELECT delegator, scope FROM delegations WHERE delegation_id = ?",
      delegationId
    );
    if (!row) return { success: false, delegationId, error: `Delegation record ${delegationId} not found — accept needs the stored delegator/scope` };

    const scopeHash = ethers.solidityPackedKeccak256(["string"], [row.scope]);
    const contract = getContract("DelegationManager");
    const tx = await contract.acceptDelegationRoot(row.delegator, scopeHash);
    const receipt = await tx.wait();

    runExecute("UPDATE delegations SET active = 1 WHERE delegation_id = ?", delegationId);

    return { success: true, delegationId, active: true, status: "active", txHash: receipt.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Cancel a pending delegation-root proposal; the local row stays inactive.
 * Use this to abandon a proposal during the timelock window instead of letting
 * it sit pending — cancelling is not the same as revoking an active delegation.
 * @param delegationId - Local delegation id from createDelegation; the stored delegator/scope are needed to rebuild the on-chain call.
 * @returns DelegationResult with active:false, status:"cancelled" and txHash; success:false when the record is missing or the tx reverts.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract DelegationManager.cancelDelegationRoot.
 * Side effects: on-chain transaction (gas); the local DB row is left unchanged (still inactive).
 */
export async function cancelDelegation(delegationId: string): Promise<DelegationResult> {
  try {
    const row = runSingle<{ delegator: string; scope: string }>(
      "SELECT delegator, scope FROM delegations WHERE delegation_id = ?",
      delegationId
    );
    if (!row) return { success: false, delegationId, error: `Delegation record ${delegationId} not found — cancel needs the stored delegator/scope` };

    const scopeHash = ethers.solidityPackedKeccak256(["string"], [row.scope]);
    const contract = getContract("DelegationManager");
    const tx = await contract.cancelDelegationRoot(row.delegator, scopeHash);
    const receipt = await tx.wait();

    return { success: true, delegationId, active: false, status: "cancelled", txHash: receipt.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * One delegation by id, from the local DB (no on-chain read).
 * @param delegationId - Local delegation id from createDelegation.
 * @returns DelegationResult; success:false + "Delegation not found" when the id has no row.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: internal — delegation CLI/MCP read path (no dedicated MCP get tool).
 * Side effects: read-only DB query.
 */
export async function getDelegation(delegationId: string): Promise<DelegationResult> {
  try {
    const row = runSingle<any>(
      "SELECT * FROM delegations WHERE delegation_id = ?",
      delegationId
    );

    if (!row) return { success: false, error: "Delegation not found" };

    return {
      success: true,
      delegationId: row.delegation_id,
      delegator: row.delegator,
      delegatee: row.delegatee,
      scope: row.scope,
      expiry: row.expiry,
      active: row.active === 1,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * All delegations of one org, newest first, from the local DB.
 * @param organizationId - Org whose delegations to list; unknown orgs yield an empty list, not an error.
 * @returns DelegationResult[] (empty when none); a DB failure yields [{success:false, error}].
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_delegation_list.
 * Side effects: read-only DB query.
 */
export async function listDelegations(organizationId: string): Promise<DelegationResult[]> {
  try {
    const rows = runQuery<any>(
      "SELECT * FROM delegations WHERE organization_id = ? ORDER BY created_at DESC",
      organizationId
    );

    return rows.map((r) => ({
      success: true,
      delegationId: r.delegation_id,
      delegator: r.delegator,
      delegatee: r.delegatee,
      scope: r.scope,
      expiry: r.expiry,
      active: r.active === 1,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}
