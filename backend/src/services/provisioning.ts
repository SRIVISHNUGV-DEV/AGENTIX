/**
 * Agent Provisioning Service
 *
 * One-call setup: creates wallet, funds it, deposits gas, creates session.
 * New users go from "I just signed up" to "my agent can transact" in one API call.
 */

import crypto from "crypto"
import { ethers } from "ethers"
import { initDB } from "../db"
import { getBlockchainService } from "./blockchain"
import { sessionKeyService, generateSessionKeyPair } from "./sessionKey"
import { AppError } from "../utils/errors"

export interface ProvisionResult {
  walletAddress: string
  entryPointAddress: string
  session: {
    id: string
    sessionIdOnChain: string
    sessionKeyPublic: string
    dailySpendLimit: string
    dailyTxLimit: number
    expiresAt: number
  }
}

export interface WalletCreationResult {
  walletAddress: string
  entryPointAddress: string
  sessionManagerAddress: string
}

export interface ProvisionOptions {
  orgId: number
  agentId: number
  ownerAddress: string
  dailySpendLimitWei?: string
  dailyTxLimit?: number
  sessionExpiryDays?: number
}

export class ProvisioningService {

  /**
   * Phase 1: Create wallet only. User will deposit funds from their own wallet.
   */
  async createWallet(options: {
    orgId: number
    agentId: number
    ownerAddress: string
  }): Promise<WalletCreationResult> {
    const { orgId, agentId, ownerAddress } = options
    const db = await initDB()
    const blockchain = getBlockchainService()

    const existingWallet = await db.get(
      `SELECT wallet_address FROM wallets WHERE agent_id = ?`,
      agentId
    )
    if (existingWallet) {
      throw new AppError(400, "Agent already has a wallet.")
    }

    const walletResult = await blockchain.createWalletForOrg(db, orgId, ownerAddress)
    const walletAddress = walletResult.walletAddress

    if (!walletAddress) {
      throw new AppError(500, "Wallet creation failed — no address returned")
    }

    await db.run(
      `INSERT INTO wallets (
        wallet_address, org_id, agent_id, owner_address,
        session_manager_address, entry_point_address,
        wallet_kind, factory_address, factory_salt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)`,
      walletAddress,
      orgId,
      agentId,
      ownerAddress,
      walletResult.sessionManagerAddress,
      walletResult.entryPointAddress,
      "erc4337",
      walletResult.factoryAddress,
      walletResult.factorySalt
    )

    return {
      walletAddress,
      entryPointAddress: walletResult.entryPointAddress,
      sessionManagerAddress: walletResult.sessionManagerAddress,
    }
  }

  /**
   * Phase 2: After user has deposited funds, create session.
   * The user sends ETH from their wallet to the agent wallet via wallet provider.
   * We verify the balance and create the session.
   */
  async completeProvisioning(options: ProvisionOptions & { walletAddress: string }): Promise<ProvisionResult> {
    const {
      orgId,
      agentId,
      ownerAddress,
      walletAddress,
      dailySpendLimitWei = "100000000000000000",
      dailyTxLimit = 10,
      sessionExpiryDays = 30,
    } = options

    const db = await initDB()
    const blockchain = getBlockchainService()

    const existingSession = await sessionKeyService.getSessionForAgent(agentId)
    if (existingSession) {
      throw new AppError(400, "Agent already has an active session.")
    }

    // Verify wallet has balance
    const balance = await blockchain.provider.getBalance(walletAddress)
    if (balance === 0n) {
      throw new AppError(400, "Wallet has no balance. Please deposit funds first.")
    }

    // Deposit to EntryPoint for gas from wallet balance
    // The user's ETH is now in the agent wallet; we use it for gas
    await this.depositGasFromWallet(walletAddress, blockchain)

    // Create session key and session
    const keyPair = generateSessionKeyPair()
    const sessionIdOnChain = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "uint256"],
        [BigInt(agentId), keyPair.publicKey, BigInt(Date.now())]
      )
    )

    const session = await sessionKeyService.createSession({
      externalAgentId: agentId,
      agentWalletAddress: walletAddress,
      sessionKeyPrivate: keyPair.privateKey,
      sessionKeyPublic: keyPair.publicKey,
      sessionIdOnChain,
      dailySpendLimit: BigInt(dailySpendLimitWei),
      dailyTxLimit,
      expiresInSeconds: sessionExpiryDays * 24 * 60 * 60,
    })

    return {
      walletAddress,
      entryPointAddress: "", // Already set during wallet creation
      session: {
        id: session.id,
        sessionIdOnChain,
        sessionKeyPublic: keyPair.publicKey,
        dailySpendLimit: dailySpendLimitWei,
        dailyTxLimit,
        expiresAt: session.expiresAt,
      },
    }
  }

  /**
   * Legacy: Full provisioning in one call (auto-funds from deployer).
   * Use createWallet + completeProvisioning instead for user-deposited flow.
   */
  async provisionAgent(options: ProvisionOptions & { walletFundingEth?: string; gasDepositEth?: string }): Promise<ProvisionResult & { funding: { walletTxHash: string; gasDepositTxHash: string; walletFunded: string; gasDeposited: string } }> {
    const {
      orgId,
      agentId,
      ownerAddress,
      dailySpendLimitWei = "100000000000000000",
      dailyTxLimit = 10,
      walletFundingEth = "0.05",
      gasDepositEth = "0.01",
      sessionExpiryDays = 30,
    } = options

    const db = await initDB()
    const blockchain = getBlockchainService()

    // Step 1: Create wallet
    const walletResult = await this.createWallet({ orgId, agentId, ownerAddress })

    // Step 2: Fund wallet from deployer
    const fundingResult = await blockchain.fundAddress(walletResult.walletAddress, walletFundingEth)

    // Step 3: Deposit gas to EntryPoint
    const gasDepositResult = await this.depositGasFromWallet(walletResult.walletAddress, blockchain)

    // Step 4: Create session
    const result = await this.completeProvisioning({
      orgId,
      agentId,
      ownerAddress,
      walletAddress: walletResult.walletAddress,
      dailySpendLimitWei,
      dailyTxLimit,
      sessionExpiryDays,
    })

    return {
      ...result,
      entryPointAddress: walletResult.entryPointAddress,
      funding: {
        walletTxHash: fundingResult.txHash,
        gasDepositTxHash: gasDepositResult.txHash,
        walletFunded: walletFundingEth,
        gasDeposited: gasDepositEth,
      },
    }
  }

  /**
   * Deposit ETH from agent wallet to EntryPoint for gas
   */
  private async depositGasFromWallet(walletAddress: string, blockchain: ReturnType<typeof getBlockchainService>): Promise<{ txHash: string }> {
    // Get the entry point address from the wallet record
    const db = await initDB()
    const walletRecord = await db.get(
      `SELECT entry_point_address FROM wallets WHERE wallet_address = ?`,
      walletAddress
    )
    const entryPointAddress = walletRecord?.entry_point_address || process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"

    // Use the wallet's balance to deposit gas
    // In ERC-4337, the wallet calls EntryPoint.depositTo() with ETH
    const walletContract = new ethers.Contract(
      walletAddress,
      ["function addDeposit() payable", "function getDeposit() view returns (uint256)"],
      blockchain.wallet
    )

    // Check current deposit
    const currentDeposit = await walletContract.getDeposit()

    // Only deposit if needed (minimum 0.005 ETH for gas)
    if (currentDeposit < ethers.parseEther("0.005")) {
      // The deployer sends a small amount to the wallet for gas, then wallet deposits
      // Or we can deposit directly if the wallet has funds
      const balance = await blockchain.provider.getBalance(walletAddress)
      if (balance > ethers.parseEther("0.01")) {
        const depositAmount = ethers.parseEther("0.005")
        const tx = await walletContract.addDeposit({ value: depositAmount })
        const receipt = await tx.wait()
        return { txHash: receipt.hash }
      }
    }

    return { txHash: "0x" }
  }
}

export const provisioningService = new ProvisioningService()
