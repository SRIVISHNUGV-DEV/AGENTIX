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
  funding: {
    walletTxHash: string
    gasDepositTxHash: string
    walletFunded: string
    gasDeposited: string
  }
}

export interface ProvisionOptions {
  orgId: number
  agentId: number
  ownerAddress: string
  dailySpendLimitWei?: string
  dailyTxLimit?: number
  walletFundingEth?: string
  gasDepositEth?: string
  sessionExpiryDays?: number
}

export class ProvisioningService {

  /**
   * Fully provision an agent in one call:
   * 1. Create ERC-4337 wallet via factory
   * 2. Fund wallet with ETH from deployer
   * 3. Deposit gas to EntryPoint
   * 4. Generate session key and create session
   */
  async provisionAgent(options: ProvisionOptions): Promise<ProvisionResult> {
    const {
      orgId,
      agentId,
      ownerAddress,
      dailySpendLimitWei = "100000000000000000", // 0.1 ETH
      dailyTxLimit = 10,
      walletFundingEth = "0.05",
      gasDepositEth = "0.01",
      sessionExpiryDays = 30,
    } = options

    const db = await initDB()
    const blockchain = getBlockchainService()

    // Check if agent is already provisioned
    const existingWallet = await db.get(
      `SELECT wallet_address FROM wallets WHERE agent_id = ?`,
      agentId
    )
    if (existingWallet) {
      throw new AppError(400, "Agent already has a wallet. Revoke existing session first.")
    }

    // Check for existing active session
    const existingSession = await sessionKeyService.getSessionForAgent(agentId)
    if (existingSession) {
      throw new AppError(400, "Agent already has an active session.")
    }

    // Step 1: Create wallet
    const walletResult = await blockchain.createWalletForOrg(db, orgId, ownerAddress)
    const walletAddress = walletResult.walletAddress

    if (!walletAddress) {
      throw new AppError(500, "Wallet creation failed — no address returned")
    }

    // Store wallet in DB
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

    // Step 2: Fund wallet
    const fundingResult = await blockchain.fundAddress(walletAddress, walletFundingEth)

    // Step 3: Deposit gas to EntryPoint
    const gasDepositResult = await this.depositGas(walletAddress, gasDepositEth, walletResult.entryPointAddress)

    // Step 4: Create session key and session
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
      entryPointAddress: walletResult.entryPointAddress,
      session: {
        id: session.id,
        sessionIdOnChain,
        sessionKeyPublic: keyPair.publicKey,
        dailySpendLimit: dailySpendLimitWei,
        dailyTxLimit,
        expiresAt: session.expiresAt,
      },
      funding: {
        walletTxHash: fundingResult.txHash,
        gasDepositTxHash: gasDepositResult.txHash,
        walletFunded: walletFundingEth,
        gasDeposited: gasDepositEth,
      },
    }
  }

  /**
   * Deposit ETH to EntryPoint for gas
   */
  private async depositGas(walletAddress: string, amountEth: string, entryPointAddress: string): Promise<{ txHash: string }> {
    const blockchain = getBlockchainService()
    const walletContract = new ethers.Contract(
      entryPointAddress,
      ["function depositTo(address account) payable"],
      blockchain.wallet
    )

    const tx = await walletContract.depositTo{ value: ethers.parseEther(amountEth) }(walletAddress)
    const receipt = await tx.wait()

    return { txHash: receipt.hash }
  }
}

export const provisioningService = new ProvisioningService()
