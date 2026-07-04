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
  expiry?: number;
  active?: boolean;
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

    logger.info("delegation", `Creating delegation: ${delegator} → ${delegatee} (${scope})`);

    const contract = getContract("DelegationManager");
    const tx = await contract.createDelegation(
      delegator,
      delegatee,
      scope,
      ethers.parseEther(maxValue),
      expiry
    );
    const receipt = await tx.wait();

    runExecute(
      `INSERT OR REPLACE INTO delegations
       (delegation_id, organization_id, delegator, delegatee, scope, max_value, expiry, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      delegationId,
      organizationId,
      delegator,
      delegatee,
      scope,
      maxValue,
      expiry,
      Math.floor(Date.now() / 1000)
    );

    logger.info("delegation", `Delegation created: ${delegationId}`);

    return {
      success: true,
      delegationId,
      delegator,
      delegatee,
      scope,
      expiry,
      active: true,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("delegation", `Failed to create delegation: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function revokeDelegation(delegationId: string): Promise<DelegationResult> {
  try {
    const contract = getContract("DelegationManager");
    const tx = await contract.revokeDelegation(delegationId);
    await tx.wait();

    runExecute("UPDATE delegations SET active = 0 WHERE delegation_id = ?", delegationId);

    return { success: true, delegationId, active: false, txHash: tx.hash };
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
