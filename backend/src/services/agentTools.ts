/**
 * Agent Tools Service
 *
 * Backend service that exposes blockchain tools for agent execution.
 * Any runtime (local, Lambda, Cloudflare Workers) can call these tools
 * without implementing blockchain logic.
 *
 * Architecture:
 *   Runtime -> Backend /external/:id/execute -> agentTools.executeAction()
 *
 * The runtime is a thin pass-through that just forwards action requests.
 */

import { ethers } from "ethers"
import { initDB } from "../db"
import { getBlockchainService, BlockchainService } from "./blockchain"
import { sessionKeyService } from "./sessionKey"
import { AppError } from "../utils/errors"

// Tool definitions for OpenAI function calling
export const AGENT_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "send_transaction",
            description: "Send a transaction from the agent wallet to a target address. The target MUST be whitelisted.",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent's wallet address" },
                    target: { type: "string", description: "Target address to send to (must be whitelisted)" },
                    valueWei: { type: "string", description: "Amount in wei to send", default: "0" },
                    data: { type: "string", description: "Transaction calldata (hex)", default: "0x" }
                },
                required: ["walletAddress", "target"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "batch_transactions",
            description: "Execute multiple transactions in a single atomic batch from the agent wallet. All targets MUST be whitelisted.",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent's wallet address" },
                    calls: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                target: { type: "string" },
                                valueWei: { type: "string", default: "0" },
                                data: { type: "string", default: "0x" }
                            },
                            required: ["target"]
                        },
                        description: "Array of transaction calls"
                    }
                },
                required: ["walletAddress", "calls"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_wallet_info",
            description: "Get information about an agent wallet including balance, whitelist, and gas funding",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The wallet address to query" }
                },
                required: ["walletAddress"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "check_whitelist",
            description: "Check if an address is whitelisted for the agent wallet",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent wallet address" },
                    address: { type: "string", description: "Address to check" }
                },
                required: ["walletAddress", "address"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "add_to_whitelist",
            description: "Add an address to the wallet's whitelist (requires owner signature)",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent wallet address" },
                    party: { type: "string", description: "Address to whitelist" }
                },
                required: ["walletAddress", "party"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "remove_from_whitelist",
            description: "Remove an address from the wallet's whitelist (requires owner signature)",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent wallet address" },
                    party: { type: "string", description: "Address to remove from whitelist" }
                },
                required: ["walletAddress", "party"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "deposit_gas",
            description: "Deposit ETH to the EntryPoint for gas funding. Owner funds the agent wallet.",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The agent wallet to fund" },
                    amountEth: { type: "string", description: "Amount in ETH to deposit" }
                },
                required: ["walletAddress", "amountEth"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_gas_balance",
            description: "Get the EntryPoint gas balance for an agent wallet",
            parameters: {
                type: "object",
                properties: {
                    walletAddress: { type: "string", description: "The wallet to check" }
                },
                required: ["walletAddress"]
            }
        }
    }
]

export type AgentActionResult = {
    success: boolean
    action: string
    result?: any
    txHash?: string
    error?: string
    needsSession?: boolean
    needsWhitelist?: boolean
    limitRemaining?: string
}

export class AgentToolsService {
    private blockchain: BlockchainService

    constructor() {
        this.blockchain = getBlockchainService()
    }

    /**
     * Execute an agent action by name
     */
    async executeAction(action: string, params: Record<string, any>, agentId?: number): Promise<AgentActionResult> {
        try {
            switch (action) {
                case "send_transaction":
                    return await this.sendTransaction(params, agentId)

                case "batch_transactions":
                    return await this.batchTransactions(params, agentId)

                case "get_wallet_info":
                    return await this.getWalletInfo(params)

                case "check_whitelist":
                    return await this.checkWhitelist(params)

                case "add_to_whitelist":
                    return await this.addToWhitelist(params)

                case "remove_from_whitelist":
                    return await this.removeFromWhitelist(params)

                case "deposit_gas":
                    return await this.depositGas(params)

                case "get_gas_balance":
                    return await this.getGasBalance(params)

                default:
                    return {
                        success: false,
                        action,
                        error: `Unknown action: ${action}`
                    }
            }
        } catch (error: any) {
            return {
                success: false,
                action,
                error: error.message || "Unknown error"
            }
        }
    }

    /**
     * Send a single transaction from agent wallet using session-based signing
     */
    private async sendTransaction(params: Record<string, any>, agentId?: number): Promise<AgentActionResult> {
        const { walletAddress, target, valueWei = "0", data = "0x" } = params

        if (!walletAddress || !target) {
            return {
                success: false,
                action: "send_transaction",
                error: "Missing required parameters: walletAddress and target"
            }
        }

        if (!agentId) {
            return {
                success: false,
                action: "send_transaction",
                error: "No agent ID provided. Session-based signing requires an agent ID."
            }
        }

        // Check whitelist enforcement
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, target)
        if (!isWhitelisted) {
            return {
                success: false,
                action: "send_transaction",
                error: `Target ${target} is not whitelisted for wallet ${walletAddress}`
            }
        }

        // Get active session for this agent
        const session = await sessionKeyService.getSessionForAgent(agentId)
        if (!session) {
            return {
                success: false,
                action: "send_transaction",
                error: "No active session. Create a session first.",
                needsSession: true
            }
        }

        // Validate session limits
        const limitCheck = await sessionKeyService.validateSessionForExecution(
            session.id,
            walletAddress,
            agentId,
            BigInt(valueWei)
        )
        if (!limitCheck.valid) {
            return {
                success: false,
                action: "send_transaction",
                error: limitCheck.reason || "Session validation failed"
            }
        }

        // Build UserOperation
        const db = await initDB()
        const walletInterface = new ethers.Interface(this.blockchain.getWalletAbi())
        const callData = walletInterface.encodeFunctionData("execute", [
            target,
            BigInt(valueWei),
            data
        ])

        const prepared = await this.blockchain.prepareUserOperationForWallet(
            db,
            walletAddress,
            callData
        )

        // Decrypt session key and sign the UserOp hash
        const { privateKey } = await sessionKeyService.unlockSession(session.id)
        const sessionWallet = new ethers.Wallet(privateKey)
        const sessionSignature = await sessionWallet.signMessage(
            ethers.getBytes(prepared.userOpHash)
        )

        // Encode signature as abi.encode(sessionId, signature) for AgentWallet validation
        const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes"],
            [session.sessionIdOnChain, sessionSignature]
        )

        // Set the signature on the UserOp
        prepared.userOp.signature = encodedSignature

        // Submit to EntryPoint via bundler
        const submitResult = await this.blockchain.submitUserOperation(
            prepared.userOp,
            prepared.entryPointAddress
        )

        // Record usage after successful submission
        await sessionKeyService.recordUsage(session.id, BigInt(valueWei))

        return {
            success: true,
            action: "send_transaction",
            result: {
                userOpHash: submitResult.userOpHash,
                walletAddress,
                target,
                valueWei,
                sessionId: session.id,
                entryPointAddress: submitResult.entryPointAddress,
                status: "submitted"
            }
        }
    }

    /**
     * Execute multiple transactions in a batch using session-based signing
     */
    private async batchTransactions(params: Record<string, any>, agentId?: number): Promise<AgentActionResult> {
        const { walletAddress, calls } = params

        if (!walletAddress || !calls || !Array.isArray(calls) || calls.length === 0) {
            return {
                success: false,
                action: "batch_transactions",
                error: "Missing required parameters: walletAddress and calls array"
            }
        }

        if (!agentId) {
            return {
                success: false,
                action: "batch_transactions",
                error: "No agent ID provided. Session-based signing requires an agent ID."
            }
        }

        // Validate all targets are whitelisted
        for (const call of calls) {
            if (!call.target) {
                return {
                    success: false,
                    action: "batch_transactions",
                    error: "Each call must have a target address"
                }
            }

            const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, call.target)
            if (!isWhitelisted) {
                return {
                    success: false,
                    action: "batch_transactions",
                    error: `Target ${call.target} is not whitelisted for wallet ${walletAddress}`
                }
            }
        }

        // Get active session for this agent
        const session = await sessionKeyService.getSessionForAgent(agentId)
        if (!session) {
            return {
                success: false,
                action: "batch_transactions",
                error: "No active session. Create a session first.",
                needsSession: true
            }
        }

        // Calculate total value for limit check
        const totalValue = calls.reduce(
            (sum, call) => sum + BigInt(call.valueWei || "0"),
            BigInt(0)
        )

        // Validate session limits
        const limitCheck = await sessionKeyService.validateSessionForExecution(
            session.id,
            walletAddress,
            agentId,
            totalValue
        )
        if (!limitCheck.valid) {
            return {
                success: false,
                action: "batch_transactions",
                error: limitCheck.reason || "Session validation failed"
            }
        }

        // Build batch UserOperation
        const db = await initDB()
        const walletInterface = new ethers.Interface(this.blockchain.getWalletAbi())
        const targets = calls.map(c => c.target)
        const values = calls.map(c => BigInt(c.valueWei || "0"))
        const payloads = calls.map(c => c.data || "0x")

        const callData = walletInterface.encodeFunctionData("executeBatch", [
            targets,
            values,
            payloads
        ])

        const prepared = await this.blockchain.prepareUserOperationForWallet(
            db,
            walletAddress,
            callData
        )

        // Decrypt session key and sign
        const { privateKey } = await sessionKeyService.unlockSession(session.id)
        const sessionWallet = new ethers.Wallet(privateKey)
        const sessionSignature = await sessionWallet.signMessage(
            ethers.getBytes(prepared.userOpHash)
        )

        // Encode signature
        const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes"],
            [session.sessionIdOnChain, sessionSignature]
        )

        prepared.userOp.signature = encodedSignature

        // Submit via bundler
        const submitResult = await this.blockchain.submitUserOperation(
            prepared.userOp,
            prepared.entryPointAddress
        )

        // Record usage
        await sessionKeyService.recordUsage(session.id, totalValue)

        return {
            success: true,
            action: "batch_transactions",
            result: {
                userOpHash: submitResult.userOpHash,
                walletAddress,
                callCount: calls.length,
                targets,
                totalValue: totalValue.toString(),
                sessionId: session.id,
                entryPointAddress: submitResult.entryPointAddress,
                status: "submitted"
            }
        }
    }

    /**
     * Get wallet information including balance and whitelist
     */
    private async getWalletInfo(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress } = params

        if (!walletAddress) {
            return {
                success: false,
                action: "get_wallet_info",
                error: "Missing required parameter: walletAddress"
            }
        }

        const db = await initDB()

        // Get wallet from database
        const wallet = await db.get(
            `SELECT * FROM wallets WHERE wallet_address = ?`,
            walletAddress
        )

        if (!wallet) {
            return {
                success: false,
                action: "get_wallet_info",
                error: `Wallet not found: ${walletAddress}`
            }
        }

        // Get ETH balance
        const provider = this.blockchain.provider
        const ethBalance = await provider.getBalance(walletAddress)

        // Get EntryPoint gas balance
        const gasBalance = await this.blockchain.getEntryPointBalance(walletAddress)

        // Get whitelisted addresses
        const whitelistedParties = await this.blockchain.getWhitelistedParties(walletAddress, db)

        return {
            success: true,
            action: "get_wallet_info",
            result: {
                walletAddress,
                ownerAddress: wallet.owner_address,
                ethBalance: ethers.formatEther(ethBalance),
                ethBalanceWei: ethBalance.toString(),
                gasBalance: ethers.formatEther(gasBalance),
                gasBalanceWei: gasBalance.toString(),
                whitelistedParties,
                sessionManagerAddress: wallet.session_manager_address,
                walletKind: wallet.wallet_kind || "erc4337",
                createdAt: wallet.created_at
            }
        }
    }

    /**
     * Check if an address is whitelisted
     */
    private async checkWhitelist(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress, address } = params

        if (!walletAddress || !address) {
            return {
                success: false,
                action: "check_whitelist",
                error: "Missing required parameters: walletAddress and address"
            }
        }

        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, address)

        return {
            success: true,
            action: "check_whitelist",
            result: {
                walletAddress,
                address,
                isWhitelisted
            }
        }
    }

    /**
     * Add address to whitelist (requires owner signature - called from wallets route)
     */
    private async addToWhitelist(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress, party } = params

        if (!walletAddress || !party) {
            return {
                success: false,
                action: "add_to_whitelist",
                error: "Missing required parameters: walletAddress and party"
            }
        }

        // Note: This requires the wallet owner's signature
        // The actual execution happens via the wallets route with requireSignedAction
        // This is just a check/validation function

        const db = await initDB()

        // Check current whitelist status
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, party)

        if (isWhitelisted) {
            return {
                success: true,
                action: "add_to_whitelist",
                result: {
                    walletAddress,
                    party,
                    alreadyWhitelisted: true,
                    note: "Address is already whitelisted"
                }
            }
        }

        // Return instructions for adding to whitelist
        return {
            success: true,
            action: "add_to_whitelist",
            result: {
                walletAddress,
                party,
                currentlyWhitelisted: false,
                note: "To add to whitelist, use POST /wallets/:walletAddress/whitelist with owner signature"
            }
        }
    }

    /**
     * Remove address from whitelist (requires owner signature)
     */
    private async removeFromWhitelist(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress, party } = params

        if (!walletAddress || !party) {
            return {
                success: false,
                action: "remove_from_whitelist",
                error: "Missing required parameters: walletAddress and party"
            }
        }

        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, party)

        if (!isWhitelisted) {
            return {
                success: true,
                action: "remove_from_whitelist",
                result: {
                    walletAddress,
                    party,
                    notWhitelisted: true,
                    note: "Address is not currently whitelisted"
                }
            }
        }

        return {
            success: true,
            action: "remove_from_whitelist",
            result: {
                walletAddress,
                party,
                currentlyWhitelisted: true,
                note: "To remove from whitelist, use DELETE /wallets/:walletAddress/whitelist/:party with owner signature"
            }
        }
    }

    /**
     * Deposit ETH to EntryPoint for gas funding
     */
    private async depositGas(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress, amountEth } = params

        if (!walletAddress || !amountEth) {
            return {
                success: false,
                action: "deposit_gas",
                error: "Missing required parameters: walletAddress and amountEth"
            }
        }

        // Note: This requires the wallet owner's signature
        // The actual execution happens via the wallets route with requireSignedAction

        try {
            const amountWei = ethers.parseEther(amountEth)
            const currentBalance = await this.blockchain.getEntryPointBalance(walletAddress)

            return {
                success: true,
                action: "deposit_gas",
                result: {
                    walletAddress,
                    amountEth,
                    amountWei: amountWei.toString(),
                    currentGasBalance: ethers.formatEther(currentBalance),
                    note: "To deposit gas, use POST /wallets/:walletAddress/deposit-gas with owner signature"
                }
            }
        } catch (error: any) {
            return {
                success: false,
                action: "deposit_gas",
                error: `Invalid amount: ${error.message}`
            }
        }
    }

    /**
     * Get EntryPoint gas balance
     */
    private async getGasBalance(params: Record<string, any>): Promise<AgentActionResult> {
        const { walletAddress } = params

        if (!walletAddress) {
            return {
                success: false,
                action: "get_gas_balance",
                error: "Missing required parameter: walletAddress"
            }
        }

        try {
            const balance = await this.blockchain.getEntryPointBalance(walletAddress)

            return {
                success: true,
                action: "get_gas_balance",
                result: {
                    walletAddress,
                    gasBalance: ethers.formatEther(balance),
                    gasBalanceWei: balance.toString()
                }
            }
        } catch (error: any) {
            return {
                success: false,
                action: "get_gas_balance",
                error: error.message
            }
        }
    }

    /**
     * Get tool definitions for OpenAI function calling
     */
    getToolDefinitions() {
        return AGENT_TOOLS
    }
}

// Singleton instance
let agentToolsInstance: AgentToolsService | null = null

export function getAgentToolsService(): AgentToolsService {
    if (!agentToolsInstance) {
        agentToolsInstance = new AgentToolsService()
    }
    return agentToolsInstance
}
