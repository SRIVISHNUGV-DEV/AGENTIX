import { ethers } from "ethers";
import { randomBytes } from "crypto";
import { getReadonlyContract } from "../contracts";
import { runExecute, runSingle, runQuery } from "../core/database";
import { getActiveTree } from "../trees/active-tree";
import { getRevokedTree } from "../trees/revoked-tree";
import { logger } from "../core/logger";
import { getProvider } from "../core/provider";

export interface CredResult {
  success: boolean;
  credentialId?: string;
  agentId?: number;
  commitment?: string;
  secret?: string;
  walletAddress?: string;
  activeRoot?: string;
  revokedRoot?: string;
  expiry?: number;
  error?: string;
}

export function getNextAgentId(): number {
  const row = runSingle<{ max_id: number }>(
    "SELECT COALESCE(MAX(agent_id), 0) as max_id FROM credentials"
  );
  return (row?.max_id || 0) + 1;
}

export function getNextOrgId(): number {
  const row = runSingle<{ max_num: number }>(
    "SELECT COALESCE(MAX(CAST(org_numeric_id AS INTEGER)), 0) as max_num FROM organizations"
  );
  return (row?.max_num || 0) + 1;
}

export function listOrgsForDropdown(): Array<{ id: string; name: string; numericId: number }> {
  const rows = runQuery<{ id: string; name: string; org_numeric_id: string }>(
    "SELECT id, name, org_numeric_id FROM organizations ORDER BY created_at ASC"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    numericId: parseInt(r.org_numeric_id || "0", 10),
  }));
}

export function getExpiryBlockNumber(durationValue: number, durationUnit: "days" | "months"): number {
  const now = Math.floor(Date.now() / 1000);
  let seconds: number;
  if (durationUnit === "days") {
    seconds = durationValue * 86400;
  } else {
    seconds = durationValue * 30 * 86400;
  }
  return now + seconds;
}

export async function computeExpiryBlock(durationValue: number, durationUnit: "days" | "months"): Promise<number> {
  try {
    const provider = getProvider();
    const blockNumber = await provider.getBlockNumber();
    const secondsInFuture = durationUnit === "days"
      ? durationValue * 86400
      : durationValue * 30 * 86400;
    const avgBlockTime = 2;
    const blocksInFuture = Math.ceil(secondsInFuture / avgBlockTime);
    return blockNumber + blocksInFuture;
  } catch {
    return getExpiryBlockNumber(durationValue, durationUnit);
  }
}

export async function issueCredential(params: {
  orgId?: string;
  budgetLimit: string;
  expiryDuration: number;
  expiryUnit: "days" | "months";
  walletAddress: string;
  ownerAddress: string;
}): Promise<CredResult> {
  try {
    const {
      orgId: orgInput,
      budgetLimit: budgetEth,
      expiryDuration,
      expiryUnit,
      walletAddress,
      ownerAddress,
    } = params;

    if (!orgInput || orgInput === "0" || orgInput === "standalone") {
      return { success: false, error: "Credentials require an organization. Standalone wallets use lightweight sessions directly." };
    }

    const orgRow = runSingle<{ org_numeric_id: string }>(
      "SELECT org_numeric_id FROM organizations WHERE id = ?",
      orgInput
    );
    if (!orgRow) return { success: false, error: `Organization ${orgInput} not found` };

    const agentId = getNextAgentId();
    const orgNumericId = parseInt(orgRow.org_numeric_id || "0", 10);
    const orgId = orgInput;

    const secretBytes = randomBytes(32);
    const secret = BigInt("0x" + secretBytes.toString("hex"));

    const expiryBlock = await computeExpiryBlock(expiryDuration, expiryUnit);
    const credentialVersion = 1;
    const budgetWei = ethers.parseEther(budgetEth || "0");
    const budgetLimitBig = BigInt(budgetWei.toString());
    const walletBigInt = BigInt(walletAddress);

    logger.info("credential", `Computing Poseidon(7) commitment: agentId=${agentId} orgId=${orgNumericId} budget=${budgetEth} ETH (${budgetWei} wei) wallet=${walletAddress.slice(0, 10)}... expiry=${expiryBlock}`);

    let commitmentHex: string;
    try {
      const circomlibjs = await import("circomlibjs");
      const poseidon = await circomlibjs.buildPoseidon();
      const F = poseidon.F;

      const inputs = [
        F.e(BigInt(agentId).toString()),
        F.e(BigInt(orgNumericId).toString()),
        F.e(budgetLimitBig.toString()),
        F.e(walletBigInt.toString()),
        F.e(BigInt(expiryBlock).toString()),
        F.e(BigInt(credentialVersion).toString()),
        F.e(secret.toString()),
      ];

      const hash = poseidon(...inputs);
      commitmentHex = "0x" + F.toString(hash);
    } catch (e: any) {
      logger.warn("credential", `circomlibjs unavailable, using keccak256 fallback: ${e.message}`);
      commitmentHex = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "uint256", "uint256", "address", "uint256", "uint256", "bytes32"],
          [agentId, orgNumericId, budgetLimitBig, walletAddress, expiryBlock, credentialVersion, "0x" + secretBytes.toString("hex")]
        )
      );
    }

    const credentialId = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "uint256"],
        [commitmentHex, budgetLimitBig]
      )
    );

    logger.info("credential", `Issuing credential for agent ${agentId} in org ${orgId}`);

    runExecute(
      `INSERT INTO credentials
       (credential_id, organization_id, agent_id, nullifier, secret, permissions, expiry, revoked, created_at, wallet_address, budget_limit, credential_version, commitment)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      credentialId,
      orgId,
      agentId,
      commitmentHex,
      secretBytes.toString("hex"),
      parseInt(budgetEth || "0", 10),
      expiryBlock,
      Math.floor(Date.now() / 1000),
      walletAddress,
      budgetEth || "0",
      credentialVersion,
      commitmentHex
    );

    const tree = await getActiveTree(orgId);
    const commitmentBig = BigInt(commitmentHex);
    const { root, epoch } = tree.addLeaf(commitmentBig, commitmentBig);

    const revokedTree = await getRevokedTree(orgId);

    logger.info("credential", `Credential issued: ${credentialId.slice(0, 20)}... commitment=${commitmentHex.slice(0, 20)}... root=${root.toString().slice(0, 20)}...`);

    // Persist event
    try {
      const { getEventBus } = require("../../packages/core/eventbus");
      const bus = getEventBus();
      const evData = { credentialId, agentId, organizationId: orgId, walletAddress };
      bus.emit({ type: "CredentialIssued", data: evData });
      runExecute(
        "INSERT INTO events (event_type, data, created_at) VALUES (?, ?, ?)",
        "CredentialIssued",
        JSON.stringify(evData),
        Math.floor(Date.now() / 1000)
      );
    } catch {}

    return {
      success: true,
      credentialId,
      agentId,
      commitment: commitmentHex,
      secret: secretBytes.toString("hex"),
      walletAddress,
      activeRoot: root.toString(),
      revokedRoot: revokedTree.getRoot(),
      expiry: expiryBlock,
    };
  } catch (e: any) {
    logger.error("credential", `Failed to issue credential: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function revokeCredential(
  organizationId: string,
  agentId: number
): Promise<CredResult> {
  try {
    const cred = runSingle<{ nullifier: string; credential_id: string }>(
      "SELECT nullifier, credential_id FROM credentials WHERE organization_id = ? AND agent_id = ? AND revoked = 0",
      organizationId,
      agentId
    );

    if (!cred) return { success: false, error: "Credential not found or already revoked" };

    logger.info("credential", `Revoking credential for agent ${agentId}`);

    runExecute(
      "UPDATE credentials SET revoked = 1, revoked_at = ? WHERE organization_id = ? AND agent_id = ?",
      Math.floor(Date.now() / 1000),
      organizationId,
      agentId
    );

    const activeTree = await getActiveTree(organizationId);
    activeTree.removeLeaf(BigInt(cred.nullifier));

    const revokedTree = await getRevokedTree(organizationId);
    const { root, epoch } = revokedTree.addNullifier(BigInt(cred.nullifier));

    logger.info("credential", `Credential revoked: root=${root.toString().slice(0, 20)}...`);

    // Persist event
    try {
      const { getEventBus } = require("../../packages/core/eventbus");
      const bus = getEventBus();
      const evData = { credentialId: cred.credential_id, agentId, organizationId };
      bus.emit({ type: "CredentialRevoked", data: evData });
      runExecute(
        "INSERT INTO events (event_type, data, created_at) VALUES (?, ?, ?)",
        "CredentialRevoked",
        JSON.stringify(evData),
        Math.floor(Date.now() / 1000)
      );
    } catch {}

    return {
      success: true,
      credentialId: cred.credential_id,
      agentId,
      activeRoot: activeTree.getRoot(),
      revokedRoot: root.toString(),
    };
  } catch (e: any) {
    logger.error("credential", `Failed to revoke credential: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function getCredential(
  organizationId: string,
  agentId: number
): Promise<CredResult> {
  try {
    const cred = runSingle<any>(
      "SELECT * FROM credentials WHERE organization_id = ? AND agent_id = ?",
      organizationId,
      agentId
    );

    if (!cred) return { success: false, error: "Credential not found" };

    return {
      success: true,
      credentialId: cred.credential_id,
      agentId: cred.agent_id,
      commitment: cred.commitment,
      walletAddress: cred.wallet_address,
      error: cred.revoked ? "Credential is revoked" : undefined,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function listCredentials(organizationId?: string): Promise<any[]> {
  try {
    const rows = organizationId
      ? runQuery<any>(
          "SELECT * FROM credentials WHERE organization_id = ? ORDER BY created_at DESC",
          organizationId
        )
      : runQuery<any>("SELECT * FROM credentials ORDER BY created_at DESC");

    return rows.map((r: any) => {
      const budgetEth = r.budget_limit || "0";
      return {
        credentialId: r.credential_id,
        agentId: r.agent_id,
        organizationId: r.organization_id,
        commitment: r.commitment,
        secret: r.secret,
        walletAddress: r.wallet_address,
        budgetEth,
        credentialVersion: r.credential_version,
        expiry: r.expiry,
        revoked: r.revoked === 1,
        createdAt: r.created_at,
      };
    });
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}
