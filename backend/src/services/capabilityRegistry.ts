import { ethers } from "ethers"
import { initDB } from "../db"
import { AppError } from "../utils/errors"
import { getChainAdapter } from "./chainAdapter"
import { MerkleTree } from "../utils/merkleTree"

export type CapabilityAction =
  | "database.read"
  | "database.write"
  | "payments.send"
  | "payments.receive"
  | "workflow.execute"
  | "tool.invoke"
  | "model.access"
  | "agent.create"
  | "agent.delegate"
  | "treasury.access"
  | "contract.interact"
  | "api.call"
  | "file.read"
  | "file.write"
  | "shell.execute"

export type CapabilityEffect = "allow" | "deny" | "audit"

export type CapabilityConstraint = {
  maxValueWei?: string
  maxCount?: number
  allowedTargets?: string[]
  allowedChains?: number[]
  timeWindowSeconds?: number
  requireApproval?: boolean
}

export type Capability = {
  id: number
  orgId: number
  action: CapabilityAction
  effect: CapabilityEffect
  constraints: CapabilityConstraint
  resourcePattern?: string
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

export type CapabilityGrant = {
  id: number
  grantorAgentId: number
  granteeAgentId: number
  orgId: number
  capabilityId: number
  constraints: CapabilityConstraint
  expiresAt?: number
  revoked: boolean
  createdAt: number
}

const CAPABILITY_DEFAULTS: Record<CapabilityAction, CapabilityConstraint> = {
  "database.read": { maxCount: 10000 },
  "database.write": { maxCount: 1000 },
  "payments.send": { maxValueWei: "100000000000000000" },
  "payments.receive": {},
  "workflow.execute": { maxCount: 100 },
  "tool.invoke": { maxCount: 500 },
  "model.access": { maxCount: 10000 },
  "agent.create": { maxCount: 10 },
  "agent.delegate": { maxCount: 20 },
  "treasury.access": { maxValueWei: "0" },
  "contract.interact": { allowedTargets: [] },
  "api.call": { maxCount: 1000 },
  "file.read": { maxCount: 1000 },
  "file.write": { maxCount: 500 },
  "shell.execute": { requireApproval: true },
}

const CAPABILITY_REGISTRY_ABI = [
  "function registerCapability(bytes32 capabilityId, string calldata action, uint64 expiresAt) external",
  "function updateGrantRoot(address agent, bytes32 newRoot) external",
  "function revokeGrant(bytes32 grantLeafHash, bytes32 capabilityId) external",
  "function grantRoots(address) external view returns (bytes32)",
  "function capabilities(bytes32) external view returns (bytes32 actionHash, address registrar, uint64 createdAt, uint64 expiresAt, bool revoked)",
  "function verifyCapability(address agent, bytes32 capabilityId, bytes32 grantLeaf, bytes32[] calldata merkleProof, address grantor, bytes32 constraintsHash, uint64 expiresAt) external view returns (bool)",
]

function computeOnchainCapabilityId(orgId: number, action: string): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(`capability:${orgId}:${action}`)
  )
}

function computeGrantLeafHash(
  capabilityId: string,
  grantor: string,
  grantee: string,
  constraintsHash: string,
  expiresAt: number
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "address", "bytes32", "uint64"],
    [capabilityId, grantor, grantee, constraintsHash, expiresAt]
  )
  return ethers.keccak256(encoded)
}

function sortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(",")}]`
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  const pairs = keys.map(k => `${JSON.stringify(k)}:${sortedStringify((obj as Record<string, unknown>)[k])}`)
  return `{${pairs.join(",")}}`
}

function computeConstraintsHash(constraints: CapabilityConstraint): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(sortedStringify(constraints))
  )
}

async function getAgentWalletAddress(agentId: number): Promise<string | null> {
  const db = await initDB()
  const row = await db.get(
    `SELECT wallet_address FROM external_agents WHERE id = $1`,
    [agentId]
  )
  return row?.wallet_address || null
}

async function getContract(
  chainId: number
): Promise<{ contract: ethers.Contract; signer: ethers.Signer } | null> {
  try {
    const adapter = getChainAdapter()
    const contractAddr = adapter.getContractAddress(chainId, "capabilityRegistry")
    if (!contractAddr) return null

    const signer = await adapter.getWallet(chainId)
    const contract = new ethers.Contract(contractAddr, CAPABILITY_REGISTRY_ABI, signer)
    return { contract, signer }
  } catch {
    return null
  }
}

export class CapabilityRegistryService {
  async createCapability(
    orgId: number,
    action: CapabilityAction,
    effect: CapabilityEffect = "allow",
    constraints?: Partial<CapabilityConstraint>,
    resourcePattern?: string,
    expiresAt?: number,
    chainId?: number
  ): Promise<Capability> {
    const db = await initDB()
    const mergedConstraints = { ...CAPABILITY_DEFAULTS[action], ...(constraints || {}) }

    const result = await db.run(
      `INSERT INTO agent_capabilities (org_id, action, effect, constraints, resource_pattern, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [orgId, action, effect, JSON.stringify(mergedConstraints), resourcePattern || null, expiresAt || null, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)]
    )

    const capabilityId = result.lastID!

    if (chainId) {
      await this._syncCapabilityOnChain(orgId, action, expiresAt, chainId)
    }

    return {
      id: capabilityId,
      orgId,
      action,
      effect,
      constraints: mergedConstraints,
      resourcePattern,
      expiresAt,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    }
  }

  private async _syncCapabilityOnChain(
    orgId: number,
    action: string,
    expiresAt: number | undefined,
    chainId: number
  ): Promise<void> {
    const result = await getContract(chainId)
    if (!result) return

    const { contract } = result
    const capId = computeOnchainCapabilityId(orgId, action)

    try {
      const exists = await contract.capabilities(capId)
      if (exists.createdAt > 0) return
    } catch {}

    const tx = await contract.registerCapability(
      capId,
      action,
      expiresAt || 0
    )
    await tx.wait()
  }

  async updateCapability(
    capabilityId: number,
    orgId: number,
    updates: Partial<{
      effect: CapabilityEffect
      constraints: CapabilityConstraint
      resourcePattern: string
      expiresAt: number | null
    }>
  ): Promise<Capability> {
    const db = await initDB()
    const existing = await db.get(
      `SELECT * FROM agent_capabilities WHERE id = $1 AND org_id = $2`,
      [capabilityId, orgId]
    )
    if (!existing) throw new AppError(404, "Capability not found")

    const newEffect = updates.effect || existing.effect
    const newConstraints = updates.constraints
      ? { ...JSON.parse(existing.constraints || "{}"), ...updates.constraints }
      : JSON.parse(existing.constraints || "{}")
    const newResourcePattern = updates.resourcePattern !== undefined ? updates.resourcePattern : existing.resource_pattern
    const newExpiresAt = updates.expiresAt !== undefined ? updates.expiresAt : existing.expires_at

    await db.run(
      `UPDATE agent_capabilities SET effect = $1, constraints = $2, resource_pattern = $3, expires_at = $4, updated_at = $5
       WHERE id = $6 AND org_id = $7`,
      [newEffect, JSON.stringify(newConstraints), newResourcePattern, newExpiresAt, Math.floor(Date.now() / 1000), capabilityId, orgId]
    )

    return {
      id: capabilityId,
      orgId,
      action: existing.action,
      effect: newEffect,
      constraints: newConstraints,
      resourcePattern: newResourcePattern,
      expiresAt: newExpiresAt,
      createdAt: existing.created_at,
      updatedAt: Math.floor(Date.now() / 1000),
    }
  }

  async revokeCapability(capabilityId: number, orgId: number): Promise<void> {
    const db = await initDB()
    const existing = await db.get(
      `SELECT id FROM agent_capabilities WHERE id = $1 AND org_id = $2`,
      [capabilityId, orgId]
    )
    if (!existing) throw new AppError(404, "Capability not found")
    await db.run(
      `UPDATE agent_capabilities SET effect = 'deny', updated_at = $1 WHERE id = $2`,
      [Math.floor(Date.now() / 1000), capabilityId]
    )
  }

  async getCapability(capabilityId: number, orgId: number): Promise<Capability | null> {
    const db = await initDB()
    const row = await db.get(
      `SELECT * FROM agent_capabilities WHERE id = $1 AND org_id = $2`,
      [capabilityId, orgId]
    )
    if (!row) return null
    return this.mapCapability(row)
  }

  async listCapabilities(orgId: number): Promise<Capability[]> {
    const db = await initDB()
    const rows = await db.all(
      `SELECT * FROM agent_capabilities WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    )
    return rows.map((r: any) => this.mapCapability(r))
  }

  async grantCapabilityToAgent(
    grantorAgentId: number,
    granteeAgentId: number,
    orgId: number,
    capabilityId: number,
    constraints?: Partial<CapabilityConstraint>,
    expiresAt?: number,
    chainId?: number
  ): Promise<CapabilityGrant> {
    const db = await initDB()
    const cap = await this.getCapability(capabilityId, orgId)
    if (!cap) throw new AppError(404, "Capability not found")
    if (cap.effect === "deny") throw new AppError(400, "Cannot grant a revoked capability")

    const mergedConstraints = { ...cap.constraints, ...(constraints || {}) }

    const result = await db.run(
      `INSERT INTO capability_grants (grantor_agent_id, grantee_agent_id, org_id, capability_id, constraints, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [grantorAgentId, granteeAgentId, orgId, capabilityId, JSON.stringify(mergedConstraints), expiresAt || null, Math.floor(Date.now() / 1000)]
    )

    if (chainId) {
      await this._syncGrantRootOnChain(granteeAgentId, orgId, chainId)
    }

    return {
      id: result.lastID!,
      grantorAgentId,
      granteeAgentId,
      orgId,
      capabilityId,
      constraints: mergedConstraints,
      expiresAt,
      revoked: false,
      createdAt: Math.floor(Date.now() / 1000),
    }
  }

  private async _syncGrantRootOnChain(
    agentId: number,
    orgId: number,
    chainId: number
  ): Promise<void> {
    const walletAddr = await getAgentWalletAddress(agentId)
    if (!walletAddr) return

    const result = await getContract(chainId)
    if (!result) return
    const { contract } = result

    const db = await initDB()
    const grants = await db.all(
      `SELECT cg.*, ca.action FROM capability_grants cg
       JOIN agent_capabilities ca ON cg.capability_id = ca.id
       WHERE cg.grantee_agent_id = $1 AND cg.org_id = $2 AND cg.revoked = 0`,
      [agentId, orgId]
    )

    if (grants.length === 0) {
      const tx = await contract.updateGrantRoot(walletAddr, ethers.ZeroHash)
      await tx.wait()
      return
    }

    const grantorAddr = await result.signer.getAddress()
    const leaves: string[] = []
    for (const g of grants) {
      const capId = computeOnchainCapabilityId(orgId, g.action)
      const constraintsHash = computeConstraintsHash(JSON.parse(g.constraints || "{}"))
      const leaf = computeGrantLeafHash(
        capId,
        grantorAddr,
        walletAddr,
        constraintsHash,
        g.expires_at || 0
      )
      leaves.push(leaf)
    }

    const tree = new MerkleTree(leaves)
    if (tree.root !== ethers.ZeroHash) {
      const tx = await contract.updateGrantRoot(walletAddr, tree.root)
      await tx.wait()
    }
  }

  async revokeGrant(
    grantId: number,
    orgId: number,
    chainId?: number
  ): Promise<void> {
    const db = await initDB()
    const grant = await db.get(
      `SELECT cg.*, ca.action FROM capability_grants cg
       JOIN agent_capabilities ca ON cg.capability_id = ca.id
       WHERE cg.id = $1 AND cg.org_id = $2`,
      [grantId, orgId]
    )
    if (!grant) throw new AppError(404, "Grant not found")

    await db.run(
      `UPDATE capability_grants SET revoked = 1 WHERE id = $1 AND org_id = $2`,
      [grantId, orgId]
    )

    if (chainId) {
      const result = await getContract(chainId)
      if (result) {
        const { contract } = result
        const walletAddr = await getAgentWalletAddress(grant.grantee_agent_id)
        if (walletAddr) {
          const grantorAddr = await result.signer.getAddress()
          const capId = computeOnchainCapabilityId(orgId, grant.action)
          const constraintsHash = computeConstraintsHash(JSON.parse(grant.constraints || "{}"))
          const leaf = computeGrantLeafHash(
            capId,
            grantorAddr,
            walletAddr,
            constraintsHash,
            grant.expires_at || 0
          )
          const tx = await contract.revokeGrant(leaf, capId)
          await tx.wait()
        }
      }

      await this._syncGrantRootOnChain(grant.grantee_agent_id, orgId, chainId)
    }
  }

  async getGrantsForAgent(agentId: number, orgId: number): Promise<CapabilityGrant[]> {
    const db = await initDB()
    const rows = await db.all(
      `SELECT cg.*, ca.action, ca.effect as capability_effect, ca.constraints as capability_constraints
       FROM capability_grants cg
       JOIN agent_capabilities ca ON cg.capability_id = ca.id
       WHERE cg.grantee_agent_id = $1 AND cg.org_id = $2 AND cg.revoked = 0
       ORDER BY cg.created_at DESC`,
      [agentId, orgId]
    )
    return rows.map((r: any) => ({
      id: r.id,
      grantorAgentId: r.grantor_agent_id,
      granteeAgentId: r.grantee_agent_id,
      orgId: r.org_id,
      capabilityId: r.capability_id,
      constraints: JSON.parse(r.constraints || "{}"),
      expiresAt: r.expires_at,
      revoked: !!r.revoked,
      createdAt: r.created_at,
    }))
  }

  async getGrantsFromAgent(agentId: number, orgId: number): Promise<CapabilityGrant[]> {
    const db = await initDB()
    const rows = await db.all(
      `SELECT * FROM capability_grants WHERE grantor_agent_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [agentId, orgId]
    )
    return rows.map((r: any) => ({
      id: r.id,
      grantorAgentId: r.grantor_agent_id,
      granteeAgentId: r.grantee_agent_id,
      orgId: r.org_id,
      capabilityId: r.capability_id,
      constraints: JSON.parse(r.constraints || "{}"),
      expiresAt: r.expires_at,
      revoked: !!r.revoked,
      createdAt: r.created_at,
    }))
  }

  async checkAgentCapability(
    agentId: number,
    orgId: number,
    action: CapabilityAction,
    context?: { valueWei?: string; target?: string; chainId?: number }
  ): Promise<{ allowed: boolean; grants: CapabilityGrant[]; reason?: string }> {
    const grants = await this.getGrantsForAgent(agentId, orgId)

    const db = await initDB()
    const caps: Capability[] = []
    for (const grant of grants) {
      const cap = await this.getCapability(grant.capabilityId, orgId)
      if (cap) caps.push(cap)
    }

    const matching = caps.filter(c => c.action === action)

    if (matching.length === 0) {
      return { allowed: false, grants: [], reason: `No capability grant for action: ${action}` }
    }

    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < matching.length; i++) {
      const cap = matching[i]
      const grant = grants[i]

      if (cap.effect === "deny") continue
      if (cap.expiresAt && cap.expiresAt < now) continue
      if (grant.expiresAt && grant.expiresAt < now) continue

      const constraints = { ...cap.constraints, ...grant.constraints }

      if (constraints.maxValueWei && context?.valueWei) {
        if (BigInt(context.valueWei) > BigInt(constraints.maxValueWei)) continue
      }
      if (constraints.allowedTargets && context?.target) {
        if (!constraints.allowedTargets.includes(context.target)) continue
      }
      if (constraints.allowedChains && context?.chainId) {
        if (!constraints.allowedChains.includes(context.chainId)) continue
      }
      if (constraints.requireApproval) {
        return { allowed: false, grants: [grants[i]], reason: "Approval required" }
      }

      return { allowed: true, grants: [grants[i]] }
    }

    return { allowed: false, grants: [], reason: "No matching capability satisfied all constraints" }
  }

  async getMerkleProof(
    granteeAgentId: number,
    orgId: number,
    grantId: number,
    chainId: number
  ): Promise<{ leaf: string; proof: string[]; root: string } | null> {
    const db = await initDB()
    const grant = await db.get(
      `SELECT cg.*, ca.action FROM capability_grants cg
       JOIN agent_capabilities ca ON cg.capability_id = ca.id
       WHERE cg.id = $1 AND cg.org_id = $2 AND cg.revoked = 0`,
      [grantId, orgId]
    )
    if (!grant || grant.grantee_agent_id !== granteeAgentId) return null

    const walletAddr = await getAgentWalletAddress(granteeAgentId)
    const result = await getContract(chainId)
    if (!walletAddr || !result) return null

    const grantorAddr = await result.signer.getAddress()
    const capId = computeOnchainCapabilityId(orgId, grant.action)
    const constraintsHash = computeConstraintsHash(JSON.parse(grant.constraints || "{}"))
    const targetLeaf = computeGrantLeafHash(
      capId,
      grantorAddr,
      walletAddr,
      constraintsHash,
      grant.expires_at || 0
    )

    const allGrants = await db.all(
      `SELECT cg.*, ca.action FROM capability_grants cg
       JOIN agent_capabilities ca ON cg.capability_id = ca.id
       WHERE cg.grantee_agent_id = $1 AND cg.org_id = $2 AND cg.revoked = 0`,
      [granteeAgentId, orgId]
    )

    const leaves = allGrants.map((g: any) =>
      computeGrantLeafHash(
        computeOnchainCapabilityId(orgId, g.action),
        grantorAddr,
        walletAddr,
        computeConstraintsHash(JSON.parse(g.constraints || "{}")),
        g.expires_at || 0
      )
    )

    const tree = new MerkleTree(leaves)
    return {
      leaf: targetLeaf,
      proof: tree.getProof(targetLeaf),
      root: tree.root,
    }
  }

  private mapCapability(row: any): Capability {
    return {
      id: row.id,
      orgId: row.org_id,
      action: row.action,
      effect: row.effect,
      constraints: JSON.parse(row.constraints || "{}"),
      resourcePattern: row.resource_pattern,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
