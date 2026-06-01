import { ethers } from "ethers"
import { buildPoseidon } from "circomlibjs"

export type VerificationResult = {
  valid: boolean
  reason?: string
  details?: Record<string, unknown>
}

export type ChainConfig = {
  chainId: number
  rpcUrl: string
  credentialRegistry: string
  sessionManager: string
  capabilityRegistry?: string
  delegationManager?: string
}

export type CapabilityCheck = {
  agent: string
  action: string
  capabilityId: string
  grantLeaf: string
  merkleProof: string[]
  grantor: string
  constraintsHash: string
  expiresAt: number
}

export type DelegationVerification = {
  delegationLeaf: string
  merkleProof: string[]
  delegator: string
  delegate: string
  scopeHash: string
  expiresAt: number
  maxDepth: number
  expectedOriginator?: string
}

const ERC1271_MAGIC_VALUE = "0x1626ba7e"

const CAPABILITY_REGISTRY_ABI = [
  "function verifyCapability(address agent, bytes32 capabilityId, bytes32 grantLeaf, bytes32[] calldata merkleProof, address grantor, bytes32 constraintsHash, uint64 expiresAt) external view returns (bool)",
  "function capabilities(bytes32) external view returns (string action, address registrar, uint64 createdAt, uint64 expiresAt, bool revoked)",
  "function grantRoots(address) external view returns (bytes32)",
  "function revokedGrants(bytes32) external view returns (bool)",
]

const DELEGATION_MANAGER_ABI = [
  "function verifyDelegation(bytes32 delegationLeaf, bytes32[] calldata merkleProof, address delegator, bytes32 scopeHash, uint64 expiresAt, uint8 maxDepth) external view returns (bool)",
  "function verifyDelegationChain(bytes32[] calldata delegationLeaves, bytes32[][] calldata merkleProofs, address[] calldata delegators, address[] calldata delegates, bytes32[] calldata scopeHashes, uint64[] calldata expiries, uint8[] calldata maxDepths) external view returns (bool)",
  "function delegationRoots(address) external view returns (bytes32)",
  "function revokedDelegations(bytes32) external view returns (bool)",
]

export class AgentVerifier {
  private provider: ethers.JsonRpcProvider
  private config: ChainConfig
  private poseidon: any

  constructor(config: ChainConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, {
      staticNetwork: true,
    })
  }

  async init(): Promise<void> {
    this.poseidon = await buildPoseidon()
  }

  /* ------------------------------------------------------------------ */
  /*  Credential Verification                                            */
  /* ------------------------------------------------------------------ */

  async verifyCredentialProof(
    proof: {
      a: [string, string]
      b: [[string, string], [string, string]]
      c: [string, string]
    },
    publicSignals: string[],
    options?: {
      verifierAddress?: string
      expectedActiveRoot?: string
      expectedRevokedRoot?: string
    }
  ): Promise<VerificationResult> {
    if (!options?.verifierAddress) {
      return { valid: false, reason: "Verifier address required" }
    }

    const verifier = new ethers.Contract(
      options.verifierAddress,
      [
        "function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata publicSignals) external view returns (bool)",
      ],
      this.provider
    )

    const registry = new ethers.Contract(
      this.config.credentialRegistry,
      [
        "function activeRoot() external view returns (bytes32)",
        "function revokedSecretRoot() external view returns (bytes32)",
        "function isNullifierUsed(bytes32 nullifier) external view returns (bool)",
      ],
      this.provider
    )

    const [activeRoot, revokedRoot, nullifierUsed] = await Promise.all([
      registry.activeRoot(),
      registry.revokedSecretRoot(),
      registry.isNullifierUsed(publicSignals[0]),
    ])

    if (nullifierUsed) {
      return { valid: false, reason: "Nullifier already used (replay detected)" }
    }

    if (options?.expectedActiveRoot && activeRoot !== options.expectedActiveRoot) {
      return {
        valid: false,
        reason: "Active root mismatch",
        details: { onChain: activeRoot, expected: options.expectedActiveRoot },
      }
    }

    if (options?.expectedRevokedRoot && revokedRoot !== options.expectedRevokedRoot) {
      return {
        valid: false,
        reason: "Revoked root mismatch",
        details: { onChain: revokedRoot, expected: options.expectedRevokedRoot },
      }
    }

    const valid = await verifier.verifyProof(
      proof.a,
      proof.b,
      proof.c,
      publicSignals.map((s) => BigInt(s))
    )

    if (!valid) {
      return { valid: false, reason: "Groth16 proof verification failed" }
    }

    return {
      valid: true,
      details: {
        nullifier: publicSignals[0],
        activeRoot,
        revokedRoot,
      },
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Capability Verification (Merkle-Proof Based)                       */
  /* ------------------------------------------------------------------ */

  async verifyCapability(check: CapabilityCheck): Promise<VerificationResult> {
    if (!this.config.capabilityRegistry) {
      return { valid: false, reason: "Capability registry not configured for this chain" }
    }

    const registry = new ethers.Contract(
      this.config.capabilityRegistry,
      CAPABILITY_REGISTRY_ABI,
      this.provider
    )

    const [grantRoot, capability, revoked] = await Promise.all([
      registry.grantRoots(check.agent),
      registry.capabilities(check.capabilityId),
      registry.revokedGrants(check.grantLeaf).catch(() => false),
    ])

    if (grantRoot === ethers.ZeroHash) {
      return { valid: false, reason: "Agent has no grant root set" }
    }

    if (revoked) {
      return { valid: false, reason: "Grant leaf has been revoked" }
    }

    if (capability.revoked) {
      return { valid: false, reason: "Capability has been revoked" }
    }
    if (capability.expiresAt > 0 && Number(capability.expiresAt) < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: "Capability has expired" }
    }
    if (capability.action !== check.action) {
      return { valid: false, reason: `Action mismatch: expected ${check.action}, got ${capability.action}` }
    }

    const valid = await registry.verifyCapability(
      check.agent,
      check.capabilityId,
      check.grantLeaf,
      check.merkleProof,
      check.grantor,
      check.constraintsHash,
      check.expiresAt
    )

    if (!valid) {
      return { valid: false, reason: "On-chain Merkle proof verification failed" }
    }

    return {
      valid: true,
      details: {
        action: capability.action,
        grantor: check.grantor,
        registrar: capability.registrar,
        expiresAt: check.expiresAt,
      },
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Delegation Chain Verification (Merkle-Proof Based)                  */
  /* ------------------------------------------------------------------ */

  async verifyDelegation(
    params: DelegationVerification
  ): Promise<VerificationResult> {
    if (!this.config.delegationManager) {
      return { valid: false, reason: "Delegation manager not configured for this chain" }
    }

    const manager = new ethers.Contract(
      this.config.delegationManager,
      DELEGATION_MANAGER_ABI,
      this.provider
    )

    const [root, revoked] = await Promise.all([
      manager.delegationRoots(params.delegator),
      manager.revokedDelegations(params.delegationLeaf).catch(() => false),
    ])

    if (root === ethers.ZeroHash) {
      return { valid: false, reason: "Delegator has no delegation root set" }
    }

    if (revoked) {
      return { valid: false, reason: "Delegation has been revoked" }
    }

    if (Number(params.expiresAt) < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: "Delegation has expired" }
    }

    if (params.expectedOriginator) {
      const chainValid = await manager.verifyDelegationChain(
        [params.delegationLeaf],
        [params.merkleProof],
        [params.delegator],
        [params.delegate],
        [params.scopeHash],
        [params.expiresAt],
        [params.maxDepth]
      )
      if (!chainValid) {
        return { valid: false, reason: "Delegation chain verification failed" }
      }
    } else {
      const valid = await manager.verifyDelegation(
        params.delegationLeaf,
        params.merkleProof,
        params.delegator,
        params.scopeHash,
        params.expiresAt,
        params.maxDepth
      )
      if (!valid) {
        return { valid: false, reason: "Delegation verification failed" }
      }
    }

    return {
      valid: true,
      details: {
        delegator: params.delegator,
        delegate: params.delegate,
        maxDepth: params.maxDepth,
      },
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Session Authorization Verification                                 */
  /* ------------------------------------------------------------------ */

  async verifySessionAuthorization(params: {
    sessionId: string
    signer: string
    value: string
    chainId?: number
  }): Promise<VerificationResult> {
    const sessionManager = new ethers.Contract(
      this.config.sessionManager,
      [
        "function sessions(bytes32) external view returns (address sessionKey, uint256 valueUsed, uint256 maxValue, uint64 expiry, bool revoked)",
        "function lightSessions(bytes32) external view returns (address sessionKey, uint256 dailySpendLimit, uint256 dailyTxLimit, uint256 dailySpendUsed, uint256 dailyTxUsed, uint64 lastResetDay, uint64 expiry, bool revoked)",
      ],
      this.provider
    )

    const sessionIdBytes = ethers.id(params.sessionId)

    const session = await sessionManager.sessions(sessionIdBytes).catch(() => null)

    if (session && session.sessionKey !== ethers.ZeroAddress) {
      if (session.revoked) {
        return { valid: false, reason: "Session has been revoked" }
      }
      if (Number(session.expiry) < Math.floor(Date.now() / 1000)) {
        return { valid: false, reason: "Session has expired" }
      }
      if (session.sessionKey.toLowerCase() !== params.signer.toLowerCase()) {
        return { valid: false, reason: "Signer does not match session key" }
      }

      const newTotal = session.valueUsed + BigInt(params.value)
      if (newTotal > session.maxValue) {
        return { valid: false, reason: "Session max value exceeded" }
      }

      return { valid: true, details: { type: "zk_session", maxValue: session.maxValue.toString() } }
    }

    const lightSession = await sessionManager.lightSessions(sessionIdBytes).catch(() => null)

    if (lightSession && lightSession.sessionKey !== ethers.ZeroAddress) {
      if (lightSession.revoked) {
        return { valid: false, reason: "Light session has been revoked" }
      }
      if (Number(lightSession.expiry) < Math.floor(Date.now() / 1000)) {
        return { valid: false, reason: "Light session has expired" }
      }
      if (lightSession.sessionKey.toLowerCase() !== params.signer.toLowerCase()) {
        return { valid: false, reason: "Signer does not match session key" }
      }

      const currentDay = Math.floor(Date.now() / 86400000)
      if (Number(lightSession.lastResetDay) < currentDay) {
        return { valid: true, details: { type: "light_session", note: "Daily limits reset" } }
      }

      const newSpend = lightSession.dailySpendUsed + BigInt(params.value)
      if (newSpend > lightSession.dailySpendLimit) {
        return { valid: false, reason: "Daily spend limit exceeded" }
      }

      return { valid: true, details: { type: "light_session" } }
    }

    return { valid: false, reason: "Session not found on-chain" }
  }

  /* ------------------------------------------------------------------ */
  /*  EIP-1271 Signature Verification                                    */
  /* ------------------------------------------------------------------ */

  async verifyEIP1271Signature(
    walletAddress: string,
    digest: string,
    signature: string
  ): Promise<VerificationResult> {
    const wallet = new ethers.Contract(
      walletAddress,
      [
        "function isValidSignature(bytes32 _hash, bytes calldata _signature) external view returns (bytes4)",
      ],
      this.provider
    )

    try {
      const result = await wallet.isValidSignature(digest, signature)
      const valid = result === ERC1271_MAGIC_VALUE

      return {
        valid,
        reason: valid ? undefined : "EIP-1271 signature verification failed",
      }
    } catch (err: any) {
      return {
        valid: false,
        reason: `EIP-1271 verification error: ${err.message}`,
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Utility Methods                                                    */
  /* ------------------------------------------------------------------ */

  async getChainStatus(): Promise<{
    connected: boolean
    blockNumber: number
    chainId: number
    contractAddresses: {
      credentialRegistry: string
      sessionManager: string
      capabilityRegistry?: string
      delegationManager?: string
    }
  }> {
    const blockNumber = await this.provider.getBlockNumber()

    return {
      connected: true,
      blockNumber,
      chainId: this.config.chainId,
      contractAddresses: {
        credentialRegistry: this.config.credentialRegistry,
        sessionManager: this.config.sessionManager,
        capabilityRegistry: this.config.capabilityRegistry,
        delegationManager: this.config.delegationManager,
      },
    }
  }

  static computeGrantLeafHash(
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

  static computeDelegationLeafHash(
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

  static computePoseidonHash(values: bigint[]): bigint {
    const poseidon = buildPoseidon()
    const hash = poseidon(values)
    return BigInt(poseidon.F.toString(hash))
  }

  static async computeCommitment(
    agentId: number,
    orgId: number,
    permissions: number,
    expiry: number,
    secret: bigint
  ): Promise<bigint> {
    const poseidon = await buildPoseidon()
    const hash = poseidon([BigInt(agentId), BigInt(orgId), BigInt(permissions), BigInt(expiry), secret])
    return BigInt(poseidon.F.toString(hash))
  }
}
