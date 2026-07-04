import { ethers } from "ethers";
import { getContract, getReadonlyContract } from "../contracts";
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
