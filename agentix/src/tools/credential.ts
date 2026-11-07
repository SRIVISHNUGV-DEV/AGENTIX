import { ethers } from "ethers";
import { randomBytes } from "crypto";
import { runExecute, runSingle, runQuery } from "../core/database";
import { getActiveTree } from "../trees/active-tree";
import { getRevokedTree } from "../trees/revoked-tree";
import { logger } from "../core/logger";
import { getProvider } from "../core/provider";
import { getEventBus } from "../../packages/core/eventbus";

/**
 * Propose the active Merkle root on-chain (step 1 of 2 — NOT an anchor).
 * Since the C-5 timelock fix a root change takes this propose tx, a 2-day wait,
 * then acceptRootOnChain(); callers must never describe the root as "anchored"
 * until the accept lands.
 * @param root - Decimal string of the Merkle root to propose.
 * @returns {success, txHash} on success; success:false if the signer is not an issuer or the tx fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract CredentialRegistry root proposal (via blockchain adapter sendRootProposal).
 * Side effects: on-chain transaction (gas).
 * Security: only a signer registered as an issuer may propose; anyone else gets an explicit error, no tx is sent.
 */
export async function proposeRootOnChain(root: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const adapter = await import("../blockchain/adapter");
    const signerAddr = adapter.getSignerAddress();
    const authorized = await adapter.isIssuer(signerAddr);
    if (!authorized) {
      return { success: false, error: `Backend signer ${signerAddr} is not an issuer. Add it via: credReg.addIssuer(${signerAddr})` };
    }
    const result = await adapter.sendRootProposal(root);
    return { success: true, txHash: result.txHash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Complete a pending root proposal after the 2-day timelock (step 2 of 2).
 * Only call once the timelock has elapsed — the contract reverts with
 * TimelockNotReady before the delay, and the local root is unchanged until this lands.
 * @returns {success, txHash} on success; success:false if the signer is not an issuer or the timelock has not elapsed.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract CredentialRegistry root accept (via blockchain adapter sendRootAccept).
 * Side effects: on-chain transaction (gas); the on-chain active root changes.
 * Security: only a registered issuer signer may accept; the timelock itself is the guard against a rushed root swap.
 */
export async function acceptRootOnChain(): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const adapter = await import("../blockchain/adapter");
    const signerAddr = adapter.getSignerAddress();
    const authorized = await adapter.isIssuer(signerAddr);
    if (!authorized) {
      return { success: false, error: `Backend signer ${signerAddr} is not an issuer. Add it via: credReg.addIssuer(${signerAddr})` };
    }
    const result = await adapter.sendRootAccept();
    return { success: true, txHash: result.txHash };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

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
  txHash?: string;
  error?: string;
}

/**
 * Next free agent id: MAX(agent_id) + 1 across all credentials.
 * Agent ids are sequential within the credential table; call this immediately
 * before issuing so the id matches the row being created.
 * @returns A number >= 1 (1 when the table is empty).
 * @throws Throws if the DB cannot be read; not concurrency-safe — two parallel issueCredential calls can compute the same id.
 * Maps to: internal — issueCredential.
 * Side effects: read-only DB query.
 */
export function getNextAgentId(): number {
  const row = runSingle<{ max_id: number }>(
    "SELECT COALESCE(MAX(agent_id), 0) as max_id FROM credentials"
  );
  return (row?.max_id || 0) + 1;
}

/**
 * Next free org numeric id: MAX(org_numeric_id) + 1 across all organizations.
 * The numeric id is the small integer the ZK circuit uses for the org; the
 * string org id (keccak) is the DB/on-chain key.
 * @returns A number >= 1 (1 when the table is empty).
 * @throws Throws if the DB cannot be read; not concurrency-safe — two parallel org creations can compute the same id.
 * Maps to: internal — organization creation callers.
 * Side effects: read-only DB query.
 */
export function getNextOrgId(): number {
  const row = runSingle<{ max_num: number }>(
    "SELECT COALESCE(MAX(CAST(org_numeric_id AS INTEGER)), 0) as max_num FROM organizations"
  );
  return (row?.max_num || 0) + 1;
}

/**
 * Every org as {id, name, numericId}, oldest first, for UI pickers.
 * @returns Array (empty when no orgs exist); numericId is 0 when the stored value is missing or unparsable.
 * @throws Throws if the DB cannot be read.
 * Maps to: internal — dashboard/API org picker.
 * Side effects: read-only DB query.
 */
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

/**
 * Offline expiry fallback: current unix time plus the duration, in seconds.
 * Despite the name this returns a UNIX TIMESTAMP, not a block number — it is only
 * the fallback when no RPC is reachable, and callers store the result where a
 * block number is expected, so the two units must never be compared.
 * @param durationValue - Positive amount in the given unit.
 * @param durationUnit - "days" (x86400s) or "months" (x30 days, approximation).
 * @returns Seconds since epoch.
 * @throws Never throws for valid inputs; a non-numeric duration yields NaN.
 * Maps to: internal — computeExpiryBlock (fallback path).
 */
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

/**
 * Expiry as a block number: current block + ceil(duration / 2s average block time).
 * Credentials expire by block on-chain, so prefer this over the timestamp
 * fallback; the 2s block time is a Base Sepolia assumption, not measured.
 * @param durationValue - Positive amount in the given unit.
 * @param durationUnit - "days" (x86400s) or "months" (x30 days, approximation).
 * @returns Block number; silently falls back to getExpiryBlockNumber (a unix timestamp) when the RPC call fails.
 * @throws Never throws: RPC failure triggers the timestamp fallback instead.
 * Maps to: internal — issueCredential.
 * Side effects: one RPC call (getBlockNumber); none when the fallback is used.
 */
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

/**
 * Issue a ZK credential: Poseidon(7) commitment, leaf in the org's active tree, DB row, event.
 * The credential is what a later Groth16 proof proves — agentId, org numeric id,
 * budget, wallet, expiry, version and a fresh 32-byte secret, all bound into one
 * commitment. If circomlibjs is unavailable a keccak256 fallback commitment is used
 * instead, which will NOT match the Poseidon(7) circuit, so proofs for such a
 * credential fail at generation time.
 * @param params.orgId - Required; "0"/"standalone"/missing is rejected — standalone wallets use lightweight sessions, not credentials.
 * @param params.budgetLimit - Budget in ETH as a decimal string ("0" allowed); parsed with parseEther, so garbage throws.
 * @param params.expiryDuration - Positive amount; @param params.expiryUnit - "days" or "months" (30-day months).
 * @param params.walletAddress - Agent wallet the credential is bound to.
 * @param params.autoAnchor - When true, proposes the new root on-chain (propose only — the 2-day timelock + accept still apply); a failed propose only warns, the credential is still issued.
 * @returns CredResult with credentialId, agentId, commitment, the plaintext secret (hex — show once, store securely), active/revoked roots and expiry block; success:false + error when the org is missing or any step fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract CredentialRegistry + trees ActiveTree; event CredentialIssued.
 * Side effects: DB insert + leaf-index update, active-tree mutation, event-bus emit + events-table insert, optional on-chain propose tx.
 * Security: the returned secret is the credential's private key material — never log it or return it over an untrusted channel; the DB stores it in plaintext.
 */
export async function issueCredential(params: {
  orgId?: string;
  budgetLimit: string;
  expiryDuration: number;
  expiryUnit: "days" | "months";
  walletAddress: string;
  ownerAddress: string;
  autoAnchor?: boolean;
}): Promise<CredResult> {
  try {
    const {
      orgId: orgInput,
      budgetLimit: budgetEth,
      expiryDuration,
      expiryUnit,
      walletAddress,
      ownerAddress,
      autoAnchor = false,
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

      // circomlibjs poseidon takes inputs as ONE array arg (poseidon(inputs, initState, nOut)).
      // Must match computeCommitment() in zk-prover.ts and the circuit's Poseidon(7),
      // verified against canonical vectors. Spreading mis-binds the arguments.
      const hash = poseidon(inputs);
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
    const { root, epoch, leafIndex } = tree.addLeaf(commitmentBig, commitmentBig);
    // Persist the dense leaf index assigned by the tree (collision-free position).
    runExecute(
      "UPDATE credentials SET leaf_index = ? WHERE credential_id = ?",
      leafIndex,
      credentialId
    );

    const revokedTree = await getRevokedTree(orgId);

    logger.info("credential", `Credential issued: ${credentialId.slice(0, 20)}... commitment=${commitmentHex.slice(0, 20)}... root=${root.toString().slice(0, 20)}...`);

    // Persist event
    try {
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

    // Auto-propose root on-chain if requested (propose only — accept is a separate step after the timelock)
    let txHash: string | undefined;
    if (autoAnchor) {
      const anchorResult = await proposeRootOnChain(root.toString());
      if (anchorResult.success) {
        txHash = anchorResult.txHash;
        logger.info("credential", `Auto-proposed root on-chain (effective after 2-day timelock + accept): ${txHash}`);
      } else {
        logger.warn("credential", `Auto-propose failed: ${anchorResult.error}`);
      }
    }

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
      txHash,
    };
  } catch (e: any) {
    logger.error("credential", `Failed to issue credential: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Revoke a credential: mark it revoked, remove its leaf from the active tree, add its revocation key to the revoked SMT.
 * Revocation is what makes a previously valid credential fail future proofs — the
 * revoked SMT is checked for non-membership at proof time, and the key is
 * Poseidon2(secret, 0) mod 2^64, exactly what the circuit's SMTVerifier expects.
 * @param organizationId - Org the credential belongs to.
 * @param agentId - Agent whose credential is revoked.
 * @param autoAnchor - When true, proposes the new active root on-chain (propose only); a failed propose only warns.
 * @returns CredResult with credentialId, agentId and the new active/revoked roots; success:false + "Credential not found or already revoked" when there is nothing active to revoke.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: trees ActiveTree / RevokedTree; event CredentialRevoked.
 * Side effects: DB update, both trees mutated, event-bus emit + events-table insert, optional on-chain propose tx.
 * Security: revocation is irreversible through this path — there is no un-revoke; the secret-derived key must be computed from the stored secret, never guessed.
 */
export async function revokeCredential(
  organizationId: string,
  agentId: number,
  autoAnchor?: boolean
): Promise<CredResult> {
  try {
    const cred = runSingle<{ nullifier: string; credential_id: string; secret: string; commitment: string }>(
      "SELECT nullifier, credential_id, secret, commitment FROM credentials WHERE organization_id = ? AND agent_id = ? AND revoked = 0",
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

    // The active tree is keyed by the commitment (raw leaf). The `nullifier`
    // column historically stores the commitment, but prefer the explicit
    // `commitment` column when present.
    const activeLeaf = BigInt(cred.commitment || cred.nullifier);
    const activeTree = await getActiveTree(organizationId);
    activeTree.removeLeaf(activeLeaf);

    // The revoked SMT is keyed by revocationKey = Poseidon2(secret, 0) mod 2^64,
    // exactly what the circuit's SMTVerifier checks non-membership against and
    // what revoked-tree.loadFromDb recomputes on reload. Adding the commitment
    // here (the old behaviour) made the live in-memory tree diverge from the
    // reloaded one. Compute the real revocation key from the secret.
    const { computeRevocationKey } = await import("../core/zk-prover");
    const secretBig = cred.secret ? BigInt("0x" + cred.secret) : BigInt(cred.nullifier);
    const revocationKey = await computeRevocationKey(secretBig);

    const revokedTree = await getRevokedTree(organizationId);
    const { root, epoch } = await revokedTree.addRevocationKey(revocationKey);

    logger.info("credential", `Credential revoked: root=${root.toString().slice(0, 20)}...`);

    // Persist event
    try {
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

    // Auto-propose root on-chain if requested (propose only — accept is a separate step after the timelock)
    let txHash: string | undefined;
    if (autoAnchor) {
      const anchorResult = await proposeRootOnChain(activeTree.getRoot());
      if (anchorResult.success) {
        txHash = anchorResult.txHash;
        logger.info("credential", `Auto-proposed root on-chain after revocation (effective after 2-day timelock + accept): ${txHash}`);
      } else {
        logger.warn("credential", `Auto-propose failed after revocation: ${anchorResult.error}`);
      }
    }

    return {
      success: true,
      credentialId: cred.credential_id,
      agentId,
      activeRoot: activeTree.getRoot(),
      revokedRoot: root.toString(),
      txHash,
    };
  } catch (e: any) {
    logger.error("credential", `Failed to revoke credential: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * One credential by org + agent id, from the local DB.
 * Note the odd success shape: a revoked credential still returns success:true
 * with error:"Credential is revoked" set — callers must check the error field,
 * not just success.
 * @param organizationId - Org id; @param agentId - Agent id within the org.
 * @returns CredResult with credentialId, commitment and wallet; success:false + "Credential not found" when no row matches.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_cred_get.
 * Side effects: read-only DB query.
 */
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

/**
 * All credentials, optionally filtered to one org, newest first.
 * @param organizationId - Omit for every credential in the DB.
 * @returns Array of credential rows (empty when none); a DB failure yields [{success:false, error}].
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_cred_list.
 * Side effects: read-only DB query.
 * Security: every row includes the plaintext `secret` — never expose this output to an untrusted caller.
 */
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
