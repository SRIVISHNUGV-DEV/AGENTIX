import { ethers } from "ethers"
import { AppError } from "../../utils/errors"
import type {
  CovenantConfig,
  CovenantAgent,
  CovenantTask,
  CovenantAuditEntry
} from "./types"

const COVENANT_V4_ADDRESSES = {
  CovenantIdentity: "0xB93eCF2bD8DE0e35ddAD13D9F00E70b938C18FdF",
  CovenantEscrow: "0xDb9F26155192c685BEC75E86A7c70A3ca0F80Ac3",
  CovenantSettlement: "0xBB3deBA10b0bDaa79c9384E39cDd899116082939",
  CovenantArbitration: "0x874d2D6Aa857685D1B7786db2eF9C32C0AcfB614",
  CovenantGovernance: "0xd505b5CA3dB39d04592D51DB51507550e0d878DF",
  CovenantAttestation: "0x65804fb982Be86C48E03107963FDAcd285f21540"
}

const COVENANT_IDENTITY_ABI = [
  "function getAgent(address) view returns (tuple(bool isActive, uint96 stake, uint32 reputation, uint32 lastActiveEpoch, bytes32 metadataRoot))",
  "function hasCapability(address agent, bytes32 capabilityHash) view returns (bool)",
  "function getCapability(address agent, bytes32 capabilityHash) view returns (tuple(bool exists, address grantor, uint32 expiry, uint128 valueLimit))"
]

const COVENANT_ESCROW_ABI = [
  "function getTask(uint256 taskId) view returns (tuple(uint8 status, address client, address worker, uint128 amount, uint32 deadline, bytes32 metaHash, uint32 disputeCount))",
  "function taskCount() view returns (uint256)"
]

const COVENANT_ATTESTATION_ABI = [
  "function verify(bytes32 attestationId) view returns (bool valid, tuple(address subject, bytes32 schemaHash, bytes32 dataHash, uint32 issuedAt, uint32 expiresAt, bool revoked) attestation)"
]

export class CovenantClient {
  private provider: ethers.Provider
  private defaultWallet: ethers.Wallet
  private addresses: typeof COVENANT_V4_ADDRESSES

  constructor(config?: Partial<CovenantConfig>) {
    const rpcUrl = process.env.RPC_URLS || process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
    const privateKey = process.env.PRIVATE_KEY || ""

    this.provider = new ethers.JsonRpcProvider(rpcUrl)
    this.defaultWallet = new ethers.Wallet(privateKey, this.provider)
    this.addresses = COVENANT_V4_ADDRESSES
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now()
    try {
      await this.provider.getBlockNumber()
      return { healthy: true, latency: Date.now() - start }
    } catch {
      return { healthy: false, latency: Date.now() - start }
    }
  }

  async getAgent(address: string): Promise<CovenantAgent> {
    const identity = new ethers.Contract(
      this.addresses.CovenantIdentity,
      COVENANT_IDENTITY_ABI,
      this.provider
    )

    const data = await identity.getAgent(address)

    return {
      address,
      name: "",
      reputation: Number(data.reputation),
      capabilities: [],
      stake: ethers.formatEther(data.stake),
      isActive: data.isActive,
      tasksCompleted: 0,
      tasksFailed: 0
    }
  }

  async getTask(taskId: number): Promise<CovenantTask> {
    const escrow = new ethers.Contract(
      this.addresses.CovenantEscrow,
      COVENANT_ESCROW_ABI,
      this.provider
    )

    const data = await escrow.getTask(taskId)

    const statusLabels: Record<number, string> = {
      0: "None",
      1: "Created",
      2: "Funded",
      3: "Submitted",
      4: "Disputed",
      5: "Completed",
      6: "Failed",
      7: "Cancelled"
    }

    return {
      taskId,
      client: data.client,
      worker: data.worker,
      amount: ethers.formatEther(data.amount),
      deadline: Number(data.deadline),
      metaHash: data.metaHash,
      status: Number(data.status),
      statusLabel: statusLabels[Number(data.status)] || `Unknown(${data.status})`,
      disputeCount: Number(data.disputeCount)
    }
  }

  async createTask(
    params: {
      worker: string
      payment: string
      deadline: number
      metaHash: string
    },
    wallet?: ethers.Wallet
  ): Promise<{ taskId: number; txHash: string }> {
    const signer = wallet || this.defaultWallet

    const escrow = new ethers.Contract(
      this.addresses.CovenantEscrow,
      [
        "function createTask(address worker, uint128 amount, uint32 deadline, bytes32 metaHash) payable returns (uint256)"
      ],
      signer
    )

    const amountWei = ethers.parseEther(params.payment)
    const tx = await escrow.createTask(
      params.worker,
      amountWei,
      params.deadline,
      params.metaHash,
      { value: amountWei }
    )

    const receipt = await tx.wait()
    const taskCount = await new ethers.Contract(
      this.addresses.CovenantEscrow,
      COVENANT_ESCROW_ABI,
      this.provider
    ).taskCount()

    return {
      taskId: Number(taskCount) - 1,
      txHash: receipt.hash
    }
  }

  async submitWork(
    taskId: number,
    deliverableHash: string,
    wallet?: ethers.Wallet
  ): Promise<{ txHash: string }> {
    const signer = wallet || this.defaultWallet

    const escrow = new ethers.Contract(
      this.addresses.CovenantEscrow,
      ["function submitWork(uint256 taskId, bytes32 deliverableHash)"],
      signer
    )

    const tx = await escrow.submitWork(taskId, deliverableHash)
    const receipt = await tx.wait()
    return { txHash: receipt.hash }
  }

  async completeTask(
    taskId: number,
    clientSignature: string,
    wallet?: ethers.Wallet
  ): Promise<{ txHash: string }> {
    const signer = wallet || this.defaultWallet

    const escrow = new ethers.Contract(
      this.addresses.CovenantEscrow,
      ["function completeTask(uint256 taskId, bytes clientSignature)"],
      signer
    )

    const tx = await escrow.completeTask(taskId, clientSignature)
    const receipt = await tx.wait()
    return { txHash: receipt.hash }
  }

  async disputeTask(
    taskId: number,
    wallet?: ethers.Wallet
  ): Promise<{ txHash: string }> {
    const signer = wallet || this.defaultWallet

    const escrow = new ethers.Contract(
      this.addresses.CovenantEscrow,
      ["function disputeTask(uint256 taskId)"],
      signer
    )

    const tx = await escrow.disputeTask(taskId)
    const receipt = await tx.wait()
    return { txHash: receipt.hash }
  }

  async hasCapability(agentAddress: string, capabilityHash: string): Promise<boolean> {
    const identity = new ethers.Contract(
      this.addresses.CovenantIdentity,
      COVENANT_IDENTITY_ABI,
      this.provider
    )

    return await identity.hasCapability(agentAddress, capabilityHash)
  }

  async verifyAttestation(attestationId: string): Promise<{ valid: boolean; subject?: string }> {
    const attestation = new ethers.Contract(
      this.addresses.CovenantAttestation,
      COVENANT_ATTESTATION_ABI,
      this.provider
    )

    const [valid, data] = await attestation.verify(attestationId)
    return {
      valid,
      subject: data.subject
    }
  }

  async getAuditTrail(filters?: {
    agentId?: number
    orgId?: number
    sessionId?: string
    limit?: number
    offset?: number
  }): Promise<CovenantAuditEntry[]> {
    return []
  }
}
