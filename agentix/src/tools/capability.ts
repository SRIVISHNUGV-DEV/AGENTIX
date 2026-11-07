import { ethers } from "ethers";
import { getContract } from "../contracts";
import { runExecute, runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

export interface CapabilityResult {
  success: boolean;
  capabilityId?: string;
  name?: string;
  description?: string;
  hash?: string;
  active?: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Register a named capability on-chain and mirror it in the local DB.
 * Call when an org wants its agents' allowed actions discoverable on-chain;
 * the capabilityId is keccak(orgId, name), so re-registering the same name
 * overwrites the local row rather than creating a second capability.
 * @param organizationId - Owning org id; name + description are hashed into the on-chain `hash`.
 * @returns CapabilityResult with capabilityId, hash and txHash; success:false + error on revert or DB failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract CapabilityRegistry.registerCapability.
 * Side effects: on-chain transaction (gas) + local DB insert; emits no local event.
 * Security: the runtime signer pays and must be authorized to register for this org.
 */
export async function registerCapability(
  organizationId: string,
  name: string,
  description: string
): Promise<CapabilityResult> {
  try {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(name + description));

    const capabilityId = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "string"],
        [ethers.id(organizationId), name]
      )
    );

    logger.info("capability", `Registering capability "${name}" for org ${organizationId}`);

    const contract = getContract("CapabilityRegistry");
    const tx = await contract.registerCapability(name, description, hash);
    const receipt = await tx.wait();

    runExecute(
      `INSERT OR REPLACE INTO capabilities
       (capability_id, organization_id, name, description, hash, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      capabilityId,
      organizationId,
      name,
      description,
      hash,
      Math.floor(Date.now() / 1000)
    );

    logger.info("capability", `Capability registered: ${capabilityId}`);

    return {
      success: true,
      capabilityId,
      name,
      description,
      hash,
      active: true,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("capability", `Failed to register capability: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * One capability by id, from the local DB (no on-chain read).
 * Use for display/validation; it reflects the last local mirror, so a capability
 * revoked on-chain but not yet mirrored locally still shows active:true.
 * @param capabilityId - keccak(orgId, name) hex id from registerCapability.
 * @returns CapabilityResult; success:false + "Capability not found" when the id has no row.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_capability_get.
 * Side effects: read-only DB query.
 */
export async function getCapability(capabilityId: string): Promise<CapabilityResult> {
  try {
    const row = runSingle<any>(
      "SELECT * FROM capabilities WHERE capability_id = ?",
      capabilityId
    );

    if (!row) return { success: false, error: "Capability not found" };

    return {
      success: true,
      capabilityId: row.capability_id,
      name: row.name,
      description: row.description,
      hash: row.hash,
      active: row.active === 1,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * All capabilities of one org, newest first, from the local DB.
 * @param organizationId - Org whose capabilities to list; unknown orgs yield an empty list, not an error.
 * @returns CapabilityResult[] (empty when none); a DB failure yields [{success:false, error}].
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_capability_list.
 * Side effects: read-only DB query.
 */
export async function listCapabilities(organizationId: string): Promise<CapabilityResult[]> {
  try {
    const rows = runQuery<any>(
      "SELECT * FROM capabilities WHERE organization_id = ? ORDER BY created_at DESC",
      organizationId
    );

    return rows.map((r) => ({
      success: true,
      capabilityId: r.capability_id,
      name: r.name,
      description: r.description,
      hash: r.hash,
      active: r.active === 1,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}

/**
 * Revoke a capability on-chain and mark it inactive locally.
 * Revocation is on-chain first: if the transaction reverts (unknown id, wrong
 * signer) the local row is left untouched, so the two stay in agreement.
 * @param capabilityId - keccak(orgId, name) hex id from registerCapability.
 * @returns CapabilityResult with active:false and txHash; success:false + error on revert or DB failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract CapabilityRegistry.revokeCapability.
 * Side effects: on-chain transaction (gas) + local DB update.
 */
export async function revokeCapability(capabilityId: string): Promise<CapabilityResult> {
  try {
    const contract = getContract("CapabilityRegistry");
    const tx = await contract.revokeCapability(capabilityId);
    await tx.wait();

    runExecute("UPDATE capabilities SET active = 0 WHERE capability_id = ?", capabilityId);

    return { success: true, capabilityId, active: false, txHash: tx.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
