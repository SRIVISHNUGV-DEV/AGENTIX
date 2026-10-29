import { ethers } from "ethers";
import { getContract, getReadonlyContract } from "../contracts";
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
 * Complete a pending delegation-root proposal after the 2-day timelock.
 * Reverts before the delay (TimelockNotReady). Marks the local row active.
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

/** Cancel a pending delegation-root proposal. The local row stays inactive. */
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
