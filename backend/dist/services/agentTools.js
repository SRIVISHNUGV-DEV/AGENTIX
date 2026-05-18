"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentToolsService = exports.AGENT_TOOLS = void 0;
exports.getAgentToolsService = getAgentToolsService;
const ethers_1 = require("ethers");
const db_1 = require("../db");
const blockchain_1 = require("./blockchain");
// Tool definitions for OpenAI function calling
exports.AGENT_TOOLS = [
    {
        type: "function",
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
        type: "function",
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
        type: "function",
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
        type: "function",
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
        type: "function",
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
        type: "function",
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
        type: "function",
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
        type: "function",
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
];
class AgentToolsService {
    blockchain;
    constructor() {
        this.blockchain = (0, blockchain_1.getBlockchainService)();
    }
    /**
     * Execute an agent action by name
     */
    async executeAction(action, params) {
        try {
            switch (action) {
                case "send_transaction":
                    return await this.sendTransaction(params);
                case "batch_transactions":
                    return await this.batchTransactions(params);
                case "get_wallet_info":
                    return await this.getWalletInfo(params);
                case "check_whitelist":
                    return await this.checkWhitelist(params);
                case "add_to_whitelist":
                    return await this.addToWhitelist(params);
                case "remove_from_whitelist":
                    return await this.removeFromWhitelist(params);
                case "deposit_gas":
                    return await this.depositGas(params);
                case "get_gas_balance":
                    return await this.getGasBalance(params);
                default:
                    return {
                        success: false,
                        action,
                        error: `Unknown action: ${action}`
                    };
            }
        }
        catch (error) {
            return {
                success: false,
                action,
                error: error.message || "Unknown error"
            };
        }
    }
    /**
     * Send a single transaction from agent wallet
     */
    async sendTransaction(params) {
        const { walletAddress, target, valueWei = "0", data = "0x" } = params;
        // Validate inputs
        if (!walletAddress || !target) {
            return {
                success: false,
                action: "send_transaction",
                error: "Missing required parameters: walletAddress and target"
            };
        }
        const db = await (0, db_1.initDB)();
        // Get wallet from database
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet) {
            return {
                success: false,
                action: "send_transaction",
                error: `Wallet not found: ${walletAddress}`
            };
        }
        // Check whitelist enforcement
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, target);
        if (!isWhitelisted) {
            return {
                success: false,
                action: "send_transaction",
                error: `Target ${target} is not whitelisted for wallet ${walletAddress}`
            };
        }
        // Prepare and submit user operation
        const walletInterface = new ethers_1.ethers.Interface(this.blockchain.getWalletAbi());
        const callData = walletInterface.encodeFunctionData("execute", [
            target,
            BigInt(valueWei),
            data
        ]);
        const prepared = await this.blockchain.prepareUserOperationForWallet(db, walletAddress, callData);
        // Note: For autonomous execution, we need the wallet owner's signature
        // This is a placeholder - in production, use session key or pre-approved nonce
        // The signature would come from the session manager contract
        return {
            success: true,
            action: "send_transaction",
            result: {
                userOpHash: prepared.userOpHash,
                walletAddress,
                target,
                valueWei,
                status: "prepared",
                note: "Transaction prepared. Requires signature from wallet owner or session key."
            }
        };
    }
    /**
     * Execute multiple transactions in a batch
     */
    async batchTransactions(params) {
        const { walletAddress, calls } = params;
        if (!walletAddress || !calls || !Array.isArray(calls) || calls.length === 0) {
            return {
                success: false,
                action: "batch_transactions",
                error: "Missing required parameters: walletAddress and calls array"
            };
        }
        const db = await (0, db_1.initDB)();
        // Get wallet from database
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet) {
            return {
                success: false,
                action: "batch_transactions",
                error: `Wallet not found: ${walletAddress}`
            };
        }
        // Validate all targets are whitelisted
        for (const call of calls) {
            if (!call.target) {
                return {
                    success: false,
                    action: "batch_transactions",
                    error: "Each call must have a target address"
                };
            }
            const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, call.target);
            if (!isWhitelisted) {
                return {
                    success: false,
                    action: "batch_transactions",
                    error: `Target ${call.target} is not whitelisted for wallet ${walletAddress}`
                };
            }
        }
        // Prepare batch transaction
        const walletInterface = new ethers_1.ethers.Interface(this.blockchain.getWalletAbi());
        const targets = calls.map(c => c.target);
        const values = calls.map(c => BigInt(c.valueWei || "0"));
        const payloads = calls.map(c => c.data || "0x");
        const callData = walletInterface.encodeFunctionData("executeBatch", [
            targets,
            values,
            payloads
        ]);
        const prepared = await this.blockchain.prepareUserOperationForWallet(db, walletAddress, callData);
        return {
            success: true,
            action: "batch_transactions",
            result: {
                userOpHash: prepared.userOpHash,
                walletAddress,
                callCount: calls.length,
                targets,
                status: "prepared",
                note: "Batch prepared. Requires signature from wallet owner or session key."
            }
        };
    }
    /**
     * Get wallet information including balance and whitelist
     */
    async getWalletInfo(params) {
        const { walletAddress } = params;
        if (!walletAddress) {
            return {
                success: false,
                action: "get_wallet_info",
                error: "Missing required parameter: walletAddress"
            };
        }
        const db = await (0, db_1.initDB)();
        // Get wallet from database
        const wallet = await db.get(`SELECT * FROM wallets WHERE wallet_address = ?`, walletAddress);
        if (!wallet) {
            return {
                success: false,
                action: "get_wallet_info",
                error: `Wallet not found: ${walletAddress}`
            };
        }
        // Get ETH balance
        const provider = this.blockchain.provider;
        const ethBalance = await provider.getBalance(walletAddress);
        // Get EntryPoint gas balance
        const gasBalance = await this.blockchain.getEntryPointBalance(walletAddress);
        // Get whitelisted addresses
        const whitelistedParties = await this.blockchain.getWhitelistedParties(walletAddress, db);
        return {
            success: true,
            action: "get_wallet_info",
            result: {
                walletAddress,
                ownerAddress: wallet.owner_address,
                ethBalance: ethers_1.ethers.formatEther(ethBalance),
                ethBalanceWei: ethBalance.toString(),
                gasBalance: ethers_1.ethers.formatEther(gasBalance),
                gasBalanceWei: gasBalance.toString(),
                whitelistedParties,
                sessionManagerAddress: wallet.session_manager_address,
                walletKind: wallet.wallet_kind || "erc4337",
                createdAt: wallet.created_at
            }
        };
    }
    /**
     * Check if an address is whitelisted
     */
    async checkWhitelist(params) {
        const { walletAddress, address } = params;
        if (!walletAddress || !address) {
            return {
                success: false,
                action: "check_whitelist",
                error: "Missing required parameters: walletAddress and address"
            };
        }
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, address);
        return {
            success: true,
            action: "check_whitelist",
            result: {
                walletAddress,
                address,
                isWhitelisted
            }
        };
    }
    /**
     * Add address to whitelist (requires owner signature - called from wallets route)
     */
    async addToWhitelist(params) {
        const { walletAddress, party } = params;
        if (!walletAddress || !party) {
            return {
                success: false,
                action: "add_to_whitelist",
                error: "Missing required parameters: walletAddress and party"
            };
        }
        // Note: This requires the wallet owner's signature
        // The actual execution happens via the wallets route with requireSignedAction
        // This is just a check/validation function
        const db = await (0, db_1.initDB)();
        // Check current whitelist status
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, party);
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
            };
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
        };
    }
    /**
     * Remove address from whitelist (requires owner signature)
     */
    async removeFromWhitelist(params) {
        const { walletAddress, party } = params;
        if (!walletAddress || !party) {
            return {
                success: false,
                action: "remove_from_whitelist",
                error: "Missing required parameters: walletAddress and party"
            };
        }
        const isWhitelisted = await this.blockchain.isWhitelisted(walletAddress, party);
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
            };
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
        };
    }
    /**
     * Deposit ETH to EntryPoint for gas funding
     */
    async depositGas(params) {
        const { walletAddress, amountEth } = params;
        if (!walletAddress || !amountEth) {
            return {
                success: false,
                action: "deposit_gas",
                error: "Missing required parameters: walletAddress and amountEth"
            };
        }
        // Note: This requires the wallet owner's signature
        // The actual execution happens via the wallets route with requireSignedAction
        try {
            const amountWei = ethers_1.ethers.parseEther(amountEth);
            const currentBalance = await this.blockchain.getEntryPointBalance(walletAddress);
            return {
                success: true,
                action: "deposit_gas",
                result: {
                    walletAddress,
                    amountEth,
                    amountWei: amountWei.toString(),
                    currentGasBalance: ethers_1.ethers.formatEther(currentBalance),
                    note: "To deposit gas, use POST /wallets/:walletAddress/deposit-gas with owner signature"
                }
            };
        }
        catch (error) {
            return {
                success: false,
                action: "deposit_gas",
                error: `Invalid amount: ${error.message}`
            };
        }
    }
    /**
     * Get EntryPoint gas balance
     */
    async getGasBalance(params) {
        const { walletAddress } = params;
        if (!walletAddress) {
            return {
                success: false,
                action: "get_gas_balance",
                error: "Missing required parameter: walletAddress"
            };
        }
        try {
            const balance = await this.blockchain.getEntryPointBalance(walletAddress);
            return {
                success: true,
                action: "get_gas_balance",
                result: {
                    walletAddress,
                    gasBalance: ethers_1.ethers.formatEther(balance),
                    gasBalanceWei: balance.toString()
                }
            };
        }
        catch (error) {
            return {
                success: false,
                action: "get_gas_balance",
                error: error.message
            };
        }
    }
    /**
     * Get tool definitions for OpenAI function calling
     */
    getToolDefinitions() {
        return exports.AGENT_TOOLS;
    }
}
exports.AgentToolsService = AgentToolsService;
// Singleton instance
let agentToolsInstance = null;
function getAgentToolsService() {
    if (!agentToolsInstance) {
        agentToolsInstance = new AgentToolsService();
    }
    return agentToolsInstance;
}
