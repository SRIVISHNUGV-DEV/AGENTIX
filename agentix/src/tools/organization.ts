import { ethers } from "ethers";
import { getContract, getReadonlyContract } from "../contracts";
import { getProxyGuard } from "../core/proxy-guard";
import { runExecute, runSingle, runQuery } from "../core/database";
import { logger } from "../core/logger";

export interface OrgResult {
  success: boolean;
  organizationId?: string;
  name?: string;
  owner?: string;
  credentialAnchor?: string;
  active?: boolean;
  txHash?: string;
  error?: string;
}

export async function createOrganization(
  name: string,
  ownerAddress: string
): Promise<OrgResult> {
  try {
    const guard = getProxyGuard();
    const validation = guard.validate(ownerAddress);
    if (!validation.valid) return { success: false, error: validation.error };

    const contract = getContract("OrganizationRegistry");
    const orgId = ethers.keccak256(ethers.toUtf8Bytes(name + ownerAddress + Date.now()));

    const maxOrgRow = runSingle<{ max_num: number }>(
      "SELECT COALESCE(MAX(CAST(org_numeric_id AS INTEGER)), 0) as max_num FROM organizations"
    );
    const orgNumericId = (maxOrgRow?.max_num || 0) + 1;

    logger.info("org", `Creating organization "${name}" with owner ${ownerAddress} (numericId=${orgNumericId})`);

    const tx = await contract.registerOrganization(orgId, name, ownerAddress);
    const receipt = await tx.wait();

    const orgData = await getReadonlyContract("OrganizationRegistry").getOrganization(orgId);

    runExecute(
      "INSERT OR REPLACE INTO organizations (id, name, owner_address, credential_anchor, active, created_at, org_numeric_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      orgId,
      name,
      ownerAddress,
      orgData.credentialAnchor,
      orgData.active ? 1 : 0,
      Number(orgData.createdAt),
      orgNumericId
    );

    logger.info("org", `Organization created: ${orgId} (numericId=${orgNumericId})`);

    return {
      success: true,
      organizationId: orgId,
      name: orgData.name,
      owner: orgData.owner,
      credentialAnchor: orgData.credentialAnchor,
      active: orgData.active,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("org", `Failed to create organization: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function getOrganization(orgId: string): Promise<OrgResult> {
  try {
    const contract = getReadonlyContract("OrganizationRegistry");
    const org = await contract.getOrganization(orgId);

    return {
      success: true,
      organizationId: org.organizationId,
      name: org.name,
      owner: org.owner,
      credentialAnchor: org.credentialAnchor,
      active: org.active,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function listOrganizations(): Promise<OrgResult[]> {
  try {
    const rows = runQuery<{ id: string; name: string; owner_address: string; credential_anchor: string; active: number }>(
      "SELECT * FROM organizations ORDER BY created_at DESC"
    );

    return rows.map((r) => ({
      success: true,
      organizationId: r.id,
      name: r.name,
      owner: r.owner_address,
      credentialAnchor: r.credential_anchor,
      active: r.active === 1,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}

export async function deactivateOrganization(orgId: string): Promise<OrgResult> {
  try {
    const contract = getContract("OrganizationRegistry");
    const tx = await contract.deactivateOrganization(orgId);
    await tx.wait();

    runExecute("UPDATE organizations SET active = 0 WHERE id = ?", orgId);

    return { success: true, organizationId: orgId, active: false, txHash: tx.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function reactivateOrganization(orgId: string): Promise<OrgResult> {
  try {
    const contract = getContract("OrganizationRegistry");
    const tx = await contract.reactivateOrganization(orgId);
    await tx.wait();

    runExecute("UPDATE organizations SET active = 1 WHERE id = ?", orgId);

    return { success: true, organizationId: orgId, active: true, txHash: tx.hash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
