import express from "express"
import crypto from "crypto"
import { initDB } from "../db"
import { BlockchainService } from "../services/blockchain"
import { IncrementalMerkleTree } from "../services/merkle"
import { SparseRevocationTree } from "../services/revocationTree"
import { getProverBackend, type ProverInput } from "../services/fastProver"
import { poseidonHash } from "../utils/crypto"
import { requireAuth } from "../middleware/auth"
import { BudgetTracker } from "../integrations/covenant/budget-tracker"
import type { AuthRequest } from "../types/http"
import { respondWithError, AppError } from "../utils/errors"
import { ensureBodyObject, requireInteger, requireString } from "../utils/validation"

const blockchain = new BlockchainService()
const budgetTracker = new BudgetTracker()
const router = express.Router()

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = await initDB()
    ensureBodyObject(req.body)

    const agentId = requireInteger(req.body.agentId, "agentId", 1)
    const maxValue = requireInteger(req.body.maxValue, "maxValue", 0)
    const expirySeconds = requireInteger(req.body.expirySeconds || req.body.expiry, "expirySeconds", 1)
    const permissions = req.body.permissions as number | undefined

    const agent = await db.get(
      `SELECT a.id, a.org_id, a.agent_name,
              c.id as cred_id, c.permissions, c.expiry as cred_expiry,
              c.leaf_index, c.secret_hash, c.commitment
       FROM agents a
       LEFT JOIN credentials c ON c.agent_id = a.id
       WHERE a.id = ?`,
      agentId
    )

    if (!agent) {
      throw new AppError(404, "Agent not found")
    }

    if (!agent.cred_id) {
      throw new AppError(400, "Agent has no credential. Issue a credential first.")
    }

    const now = Math.floor(Date.now() / 1000)
    if (agent.cred_expiry && Number(agent.cred_expiry) < now) {
      throw new AppError(403, "Agent credential has expired. Renew it first.")
    }

    const credentialPermissions = permissions ?? (Number(agent.permissions) || 0)
    const sessionExpiry = now + expirySeconds

    const sessionId = `sess_${crypto.randomBytes(16).toString("hex")}`
    const secret = crypto.randomBytes(31).toString("hex")
    const sessionNonce = String(now)

    const activeTree = new IncrementalMerkleTree(20, { orgId: agent.org_id })
    await activeTree.rebuildFromCredentials(db)
    const activeProof = await activeTree.generateProof(db, agent.leaf_index ?? 0)
    const activeRoot = await activeTree.getRoot(db)

    if (!agent.secret_hash) {
      throw new AppError(400, "Credential missing secret hash")
    }

    const revokedProof = await new SparseRevocationTree(agent.org_id).generateProof(
      db,
      BigInt(agent.secret_hash)
    )

    const nullifier = poseidonHash([
      BigInt(agentId),
      BigInt(now),
      BigInt(crypto.randomInt(1, 1000000))
    ])

    const proverInput: ProverInput = {
      agentId: String(agentId),
      orgId: String(agent.org_id),
      permissions: String(credentialPermissions),
      expiry: String(agent.cred_expiry || 0),
      secret,
      sessionNonce,
      activePathElements: activeProof.pathElements,
      activePathIndices: activeProof.pathIndices.map(String),
      revokedSiblings: revokedProof.siblings,
      revokedOldKey: revokedProof.oldKey,
      revokedOldValue: revokedProof.oldValue,
      revokedIsOld0: revokedProof.isOld0,
      activeRoot: activeRoot.toString(),
      revokedRoot: revokedProof.root,
      maxValue: String(maxValue),
      sessionExpiry: String(sessionExpiry)
    }

    const prover = getProverBackend()
    const proofResult = await prover.prove(proverInput)

    const tx = await blockchain.submitSessionForOrg(
      db,
      agent.org_id,
      sessionId,
      `0x${crypto.randomBytes(20).toString("hex")}`,
      maxValue,
      sessionExpiry,
      proofResult.proof,
      proofResult.publicSignals
    )

    await db.run(
      `INSERT INTO sessions
       (agent_id, session_id, nullifier, proof, public_signals, tx_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      agentId,
      sessionId,
      nullifier.toString(),
      JSON.stringify(proofResult.proof),
      JSON.stringify({
        sessionId,
        maxValue,
        expiry: sessionExpiry,
        publicSignals: proofResult.publicSignals
      }),
      tx.txHash
    )

    await budgetTracker.initBudget(sessionId, maxValue)

    res.json({
      success: true,
      sessionId,
      txHash: tx.txHash,
      session: {
        sessionId,
        agentId,
        orgId: agent.org_id,
        agentName: agent.agent_name,
        maxValue,
        expiry: sessionExpiry,
        expiresIn: `${expirySeconds}s`,
        permissions: credentialPermissions,
        nullifier: nullifier.toString()
      },
      proof: {
        protocol: "groth16",
        curve: "bn128",
        publicSignals: proofResult.publicSignals,
        generatedAt: new Date().toISOString(),
        generatedBy: "agentix-backend"
      }
    })
  } catch (error) {
    respondWithError(res, error, "sessions.create_server_side")
  }
})

export default router
