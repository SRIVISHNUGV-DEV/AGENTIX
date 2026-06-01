import { ethers } from "ethers"
import { initDB } from "../db"
import { AppError } from "../utils/errors"
import { logAuditEvent } from "./audit"
import { getChainAdapter } from "./chainAdapter"
import { MerkleTree } from "../utils/merkleTree"

export type DelegationScope = {
  capabilityIds?: number[]
  allowedActions?: string[]
  allowedTargets?: string[]
  maxValueWei?: string
  maxSessions?: number
  allowedChains?: number[]
  restrictToResources?: string[]
}

export type DelegationStatus = "active" | "revoked" | "expired" | "suspended"

export type Delegation = {
  id: number
  orgId: number
  delegatorAgentId: number
  delegateAgentId: number
  scope: DelegationScope
  status: DelegationStatus
  expiresAt?: number
  maxDepth: number
  currentDepth: number
  grantorDelegationId?: number
  label?: string
  createdAt: number
  updatedAt: number
}

export type DelegationChain = {
  originator: { agentId: number; name?: string }
  chain: Array<{
    delegationId: number
    delegator: { agentId: number; name?: string }
    delegate: { agentId: number; name?: string }
    scope: DelegationScope
    status: DelegationStatus
    timestamp: number
  }>
  depth: number
}

const DELEGATION_MANAGER_ABI = [
  "function updateDelegationRoot(address delegator, bytes32 newRoot) external",
  "function revokeDelegation(bytes32 delegationLeafHash, address delegator) external",
  "function delegationRoots(address) external view returns (bytes32)",
  "function verifyDelegation(bytes32 delegationLeaf, bytes32[] calldata merkleProof, address delegator, bytes32 scopeHash, uint64 expiresAt, uint8 maxDepth) external view returns (bool)",
]

function computeDelegationLeafHash(
  delegationId: string,
  delegator: string,
  delegate: string,
  scopeHash: string,
  expiresAt: number,
  maxDepth: number
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "address", "bytes32", "uint64", "uint8"],
    [delegationId, delegator, delegate, scopeHash, expiresAt, maxDepth]
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

function computeScopeHash(scope: DelegationScope): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(sortedStringify(scope))
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
    const contractAddr = adapter.getContractAddress(chainId, "delegationManager")
    if (!contractAddr) return null

    const signer = await adapter.getWallet(chainId)
    const contract = new ethers.Contract(contractAddr, DELEGATION_MANAGER_ABI, signer)
    return { contract, signer }
  } catch {
    return null
  }
}

export class DelegationService {
  async createDelegation(
    orgId: number,
    delegatorAgentId: number,
    delegateAgentId: number,
    scope: DelegationScope,
    options?: {
      expiresAt?: number
      maxDepth?: number
      grantorDelegationId?: number
      label?: string
    },
    chainId?: number
  ): Promise<Delegation> {
    const db = await initDB()

    const delegator = await db.get(
      `SELECT id, agent_name FROM external_agents WHERE id = $1 AND org_id = $2`,
      [delegatorAgentId, orgId]
    )
    if (!delegator) throw new AppError(404, "Delegator agent not found")

    const delegate = await db.get(
      `SELECT id, agent_name FROM external_agents WHERE id = $1 AND org_id = $2`,
      [delegateAgentId, orgId]
    )
    if (!delegate) throw new AppError(404, "Delegate agent not found")

    const maxDepth = options?.maxDepth ?? 5
    let currentDepth = 1

    if (options?.grantorDelegationId) {
      const grantorDelegation = await this.getDelegation(options.grantorDelegationId, orgId)
      if (!grantorDelegation) throw new AppError(404, "Grantor delegation not found")
      if (grantorDelegation.status !== "active") throw new AppError(400, "Grantor delegation is not active")

      currentDepth = grantorDelegation.currentDepth + 1
      if (currentDepth > maxDepth) {
        throw new AppError(400, `Max delegation depth (${maxDepth}) exceeded`)
      }
    }

    const result = await db.run(
      `INSERT INTO agent_delegations (org_id, delegator_agent_id, delegate_agent_id, scope, status, expires_at, max_depth, current_depth, grantor_delegation_id, label, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [orgId, delegatorAgentId, delegateAgentId, JSON.stringify(scope), "active", options?.expiresAt || null, maxDepth, currentDepth, options?.grantorDelegationId || null, options?.label || null, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)]
    )

    const delegationId = result.lastID!

    if (chainId) {
      await this._syncDelegationRootOnChain(delegatorAgentId, orgId, chainId)
    }

    await logAuditEvent({
      orgId,
      action: "delegation.create",
      resourceType: "delegation",
      resourceId: String(delegationId),
      eventCategory: "authorization",
      actorType: "agent",
      actorId: String(delegatorAgentId),
      targetType: "agent",
      targetId: String(delegateAgentId),
      outcome: "success",
      severity: "info",
      details: { scope, maxDepth, currentDepth, label: options?.label },
    })

    return {
      id: delegationId,
      orgId,
      delegatorAgentId,
      delegateAgentId,
      scope,
      status: "active",
      expiresAt: options?.expiresAt,
      maxDepth,
      currentDepth,
      grantorDelegationId: options?.grantorDelegationId,
      label: options?.label,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    }
  }

  private async _syncDelegationRootOnChain(
    delegatorAgentId: number,
    orgId: number,
    chainId: number
  ): Promise<void> {
    const walletAddr = await getAgentWalletAddress(delegatorAgentId)
    if (!walletAddr) return

    const result = await getContract(chainId)
    if (!result) return
    const { contract } = result

    const db = await initDB()
    const delegations = await db.all(
      `SELECT * FROM agent_delegations
       WHERE delegator_agent_id = $1 AND org_id = $2 AND status = 'active'`,
      [delegatorAgentId, orgId]
    )

    if (delegations.length === 0) {
      const tx = await contract.updateDelegationRoot(walletAddr, ethers.ZeroHash)
      await tx.wait()
      return
    }

    const leaves: string[] = []
    for (const d of delegations) {
      const scopeHash = computeScopeHash(JSON.parse(d.scope || "{}"))
      const leaf = computeDelegationLeafHash(
        ethers.keccak256(ethers.toUtf8Bytes(`delegation:${orgId}:${d.id}`)),
        walletAddr,
        (await getAgentWalletAddress(d.delegate_agent_id)) || ethers.ZeroAddress,
        scopeHash,
        d.expires_at || 0,
        d.max_depth
      )
      leaves.push(leaf)
    }

    const tree = new MerkleTree(leaves)
    if (tree.root !== ethers.ZeroHash) {
      const tx = await contract.updateDelegationRoot(walletAddr, tree.root)
      await tx.wait()
    }
  }

  async revokeDelegation(
    delegationId: number,
    orgId: number,
    reason?: string,
    chainId?: number
  ): Promise<void> {
    const db = await initDB()
    const delegation = await this.getDelegation(delegationId, orgId)
    if (!delegation) throw new AppError(404, "Delegation not found")

    await db.run(
      `UPDATE agent_delegations SET status = 'revoked', updated_at = $1 WHERE id = $2 AND org_id = $3`,
      [Math.floor(Date.now() / 1000), delegationId, orgId]
    )

    await db.run(
      `UPDATE agent_delegations SET status = 'revoked', updated_at = $1
       WHERE grantor_delegation_id = $2 AND status = 'active'`,
      [Math.floor(Date.now() / 1000), delegationId]
    )

    if (chainId) {
      const result = await getContract(chainId)
      if (result) {
        const { contract } = result
        const walletAddr = await getAgentWalletAddress(delegation.delegatorAgentId)
        if (walletAddr) {
          const delegateAddr = await getAgentWalletAddress(delegation.delegateAgentId)
          const scopeHash = computeScopeHash(delegation.scope)
          const leaf = computeDelegationLeafHash(
            ethers.keccak256(ethers.toUtf8Bytes(`delegation:${orgId}:${delegationId}`)),
            walletAddr,
            delegateAddr || ethers.ZeroAddress,
            scopeHash,
            delegation.expiresAt || 0,
            delegation.maxDepth
          )
          const tx = await contract.revokeDelegation(leaf, walletAddr)
          await tx.wait()
        }
      }

      await this._syncDelegationRootOnChain(delegation.delegatorAgentId, orgId, chainId)
    }

    await logAuditEvent({
      orgId,
      action: "delegation.revoke",
      resourceType: "delegation",
      resourceId: String(delegationId),
      eventCategory: "authorization",
      actorType: "agent",
      actorId: String(delegation.delegatorAgentId),
      targetType: "agent",
      targetId: String(delegation.delegateAgentId),
      outcome: "success",
      severity: "high",
      details: { reason, cascadeRevoke: true },
    })
  }

  async getDelegation(delegationId: number, orgId: number): Promise<Delegation | null> {
    const db = await initDB()
    const row = await db.get(
      `SELECT * FROM agent_delegations WHERE id = $1 AND org_id = $2`,
      [delegationId, orgId]
    )
    return row ? this.mapDelegation(row) : null
  }

  async getDelegationsForDelegate(agentId: number, orgId: number): Promise<Delegation[]> {
    const db = await initDB()
    const rows = await db.all(
      `SELECT d.*, ea.agent_name as delegator_name
       FROM agent_delegations d
       JOIN external_agents ea ON d.delegator_agent_id = ea.id
       WHERE d.delegate_agent_id = $1 AND d.org_id = $2 AND d.status = 'active'
       ORDER BY d.created_at DESC`,
      [agentId, orgId]
    )
    return rows.map((r: any) => this.mapDelegation(r))
  }

  async getDelegationsFromDelegator(agentId: number, orgId: number): Promise<Delegation[]> {
    const db = await initDB()
    const rows = await db.all(
      `SELECT d.*, ea.agent_name as delegate_name
       FROM agent_delegations d
       JOIN external_agents ea ON d.delegate_agent_id = ea.id
       WHERE d.delegator_agent_id = $1 AND d.org_id = $2
       ORDER BY d.created_at DESC`,
      [agentId, orgId]
    )
    return rows.map((r: any) => this.mapDelegation(r))
  }

  async getDelegationChain(delegateAgentId: number, orgId: number): Promise<DelegationChain | null> {
    const db = await initDB()
    const directDelegations = await this.getDelegationsForDelegate(delegateAgentId, orgId)
    if (directDelegations.length === 0) return null

    const chain: DelegationChain["chain"] = []
    let currentAgentId = delegateAgentId
    let depth = 0
    const maxTraversal = 10

    while (depth < maxTraversal) {
      const delegations = await db.all(
        `SELECT d.*, de.agent_name as delegator_name, de2.agent_name as delegate_name
         FROM agent_delegations d
         JOIN external_agents de ON d.delegator_agent_id = de.id
         JOIN external_agents de2 ON d.delegate_agent_id = de2.id
         WHERE d.delegate_agent_id = $1 AND d.org_id = $2 AND d.status = 'active'
         ORDER BY d.created_at DESC
         LIMIT 1`,
        [currentAgentId, orgId]
      )
      if (delegations.length === 0) break

      const d = delegations[0]
      chain.unshift({
        delegationId: d.id,
        delegator: { agentId: d.delegator_agent_id, name: d.delegator_name },
        delegate: { agentId: d.delegate_agent_id, name: d.delegate_name },
        scope: JSON.parse(d.scope || "{}"),
        status: d.status,
        timestamp: d.created_at,
      })
      currentAgentId = d.delegator_agent_id
      depth++
    }

    const originatorAgent = await db.get(
      `SELECT agent_name FROM external_agents WHERE id = $1 AND org_id = $2`,
      [currentAgentId, orgId]
    )

    return {
      originator: { agentId: currentAgentId, name: originatorAgent?.agent_name },
      chain,
      depth: chain.length,
    }
  }

  async checkDelegationPermission(
    delegateAgentId: number,
    orgId: number,
    requiredAction: string,
    context?: { target?: string; valueWei?: string; chainId?: number }
  ): Promise<{ allowed: boolean; delegation?: Delegation; reason?: string }> {
    const now = Math.floor(Date.now() / 1000)
    const activeDelegations = await this.getDelegationsForDelegate(delegateAgentId, orgId)

    for (const del of activeDelegations) {
      if (del.expiresAt && del.expiresAt < now) {
        await this.expireDelegation(del.id, orgId)
        continue
      }

      const scope = del.scope

      if (scope.allowedActions && !scope.allowedActions.includes(requiredAction)) continue
      if (scope.allowedTargets && context?.target && !scope.allowedTargets.includes(context.target)) continue
      if (scope.allowedChains && context?.chainId && !scope.allowedChains.includes(context.chainId)) continue
      if (scope.maxValueWei && context?.valueWei) {
        if (BigInt(context.valueWei) > BigInt(scope.maxValueWei)) continue
      }

      return { allowed: true, delegation: del }
    }

    return { allowed: false, reason: "No active delegation permits this action" }
  }

  async getMerkleProof(
    delegatorAgentId: number,
    orgId: number,
    delegationId: number,
    chainId: number
  ): Promise<{ leaf: string; proof: string[]; root: string } | null> {
    const db = await initDB()
    const delegation = await db.get(
      `SELECT * FROM agent_delegations WHERE id = $1 AND org_id = $2 AND status = 'active'`,
      [delegationId, orgId]
    )
    if (!delegation || delegation.delegator_agent_id !== delegatorAgentId) return null

    const walletAddr = await getAgentWalletAddress(delegatorAgentId)
    const delegateAddr = await getAgentWalletAddress(delegation.delegate_agent_id)
    const result = await getContract(chainId)
    if (!walletAddr || !delegateAddr || !result) return null

    const scopeHash = computeScopeHash(JSON.parse(delegation.scope || "{}"))
    const targetLeaf = computeDelegationLeafHash(
      ethers.keccak256(ethers.toUtf8Bytes(`delegation:${orgId}:${delegationId}`)),
      walletAddr,
      delegateAddr,
      scopeHash,
      delegation.expires_at || 0,
      delegation.max_depth
    )

    const allDelegations = await db.all(
      `SELECT d.*, ea.wallet_address as delegate_wallet
       FROM agent_delegations d
       JOIN external_agents ea ON d.delegate_agent_id = ea.id
       WHERE d.delegator_agent_id = $1 AND d.org_id = $2 AND d.status = 'active'`,
      [delegatorAgentId, orgId]
    )

    const leaves: string[] = []
    for (const d of allDelegations) {
      const dScopeHash = computeScopeHash(JSON.parse(d.scope || "{}"))
      const dDelegateAddr = d.delegate_wallet || ethers.ZeroAddress
      leaves.push(
        computeDelegationLeafHash(
          ethers.keccak256(ethers.toUtf8Bytes(`delegation:${orgId}:${d.id}`)),
          walletAddr,
          dDelegateAddr,
          dScopeHash,
          d.expires_at || 0,
          d.max_depth
        )
      )
    }

    const tree = new MerkleTree(leaves)
    return {
      leaf: targetLeaf,
      proof: tree.getProof(targetLeaf),
      root: tree.root,
    }
  }

  private async expireDelegation(delegationId: number, orgId: number): Promise<void> {
    const db = await initDB()
    await db.run(
      `UPDATE agent_delegations SET status = 'expired', updated_at = $1 WHERE id = $2 AND org_id = $3`,
      [Math.floor(Date.now() / 1000), delegationId, orgId]
    )
  }

  async cleanupExpired(): Promise<number> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)
    const result = await db.run(
      `UPDATE agent_delegations SET status = 'expired', updated_at = $1
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < $2`,
      [now, now]
    )
    return result.changes || 0
  }

  private mapDelegation(row: any): Delegation {
    return {
      id: row.id,
      orgId: row.org_id,
      delegatorAgentId: row.delegator_agent_id,
      delegateAgentId: row.delegate_agent_id,
      scope: JSON.parse(row.scope || "{}"),
      status: row.status,
      expiresAt: row.expires_at,
      maxDepth: row.max_depth,
      currentDepth: row.current_depth,
      grantorDelegationId: row.grantor_delegation_id,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
