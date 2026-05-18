"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentClient = void 0;
const axios_1 = __importDefault(require("axios"));
// FLAW 2 FIX: Browser-compatible SDK
// Use conditional imports for Node.js-specific modules
const circomlibjs_1 = require("circomlibjs");
const ethers_1 = require("ethers");
const SessionManager_1 = require("./SessionManager");
// Check if running in browser or Node.js
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
// FLAW 12 FIX: SDK backend URL configuration
// Default URL can be overridden via constructor or environment variable
const DEFAULT_BACKEND_URL = isBrowser
    ? (typeof process !== "undefined" && process.env?.AGENTIX_BACKEND_URL) || "http://127.0.0.1:3001"
    : process.env.AGENTIX_BACKEND_URL || "http://127.0.0.1:3001";
// Browser-compatible random bytes using Web Crypto API
async function getRandomBytes(length) {
    if (isBrowser && window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(length);
        window.crypto.getRandomValues(bytes);
        return bytes;
    }
    // Node.js fallback
    const { randomBytes } = await Promise.resolve().then(() => __importStar(require("crypto")));
    return new Uint8Array(randomBytes(length));
}
class AgentClient {
    api;
    secret;
    poseidon;
    constructor(api) {
        this.api = api;
    }
    async init() {
        this.poseidon = await (0, circomlibjs_1.buildPoseidon)();
        // FLAW 2 FIX: Use browser-compatible random bytes
        const randomBytes = await getRandomBytes(31);
        this.secret = BigInt("0x" + Array.from(randomBytes)
            .map(b => b.toString(16).padStart(2, "0"))
            .join(""));
    }
    getSecret() {
        return this.secret;
    }
    computeCommitment(input) {
        const commitment = this.poseidon([
            BigInt(input.agentId),
            BigInt(input.orgId),
            BigInt(input.permissions),
            BigInt(input.expiry),
            this.secret
        ]);
        return BigInt(this.poseidon.F.toString(commitment));
    }
    computeSecretHash() {
        const secretHash = this.poseidon([
            this.secret,
            0n
        ]);
        return BigInt(this.poseidon.F.toString(secretHash));
    }
    async registerCredential(input) {
        const commitment = this.computeCommitment(input);
        await axios_1.default.post(`${this.api}/credentials`, {
            agentId: input.agentId,
            orgId: input.orgId,
            permissions: input.permissions,
            expiry: input.expiry,
            commitment: commitment.toString(),
            secretHash: this.computeSecretHash().toString()
        });
        return commitment;
    }
    async registerAgent(input) {
        const provision = await axios_1.default.post(`${this.api}/v1/agents/provision`, {
            orgId: input.orgId,
            orgName: input.orgName,
            agentName: input.agentName
        });
        const payload = provision.data;
        const commitment = this.computeCommitment({
            agentId: payload.agentId,
            orgId: payload.orgId,
            permissions: input.permissions,
            expiry: input.expiry
        });
        await axios_1.default.post(`${this.api}/credentials`, {
            agentId: payload.agentId,
            orgId: payload.orgId,
            permissions: input.permissions,
            expiry: input.expiry,
            commitment: commitment.toString(),
            secretHash: this.computeSecretHash().toString()
        });
        return payload;
    }
    async createWallet(options) {
        let owner = options?.ownerAddress;
        let ownerPrivateKey;
        if (!owner) {
            // FLAW 2 FIX: Use ethers browser-compatible wallet creation
            // Note: In production, recommend wallet extension (MetaMask) integration
            const wallet = ethers_1.Wallet.createRandom();
            owner = wallet.address;
            ownerPrivateKey = wallet.privateKey;
        }
        const res = await axios_1.default.post(`${this.api}/wallets`, {
            ownerAddress: owner,
            agentId: options?.agentId
        });
        return {
            ...res.data,
            ownerPrivateKey
        };
    }
    async revokeAgent(agentId) {
        const res = await axios_1.default.post(`${this.api}/credentials/revoke`, {
            agentId,
            secretHash: this.computeSecretHash().toString()
        });
        return res.data;
    }
    async getAgentState(agentId) {
        const res = await axios_1.default.get(`${this.api}/v1/agents/${agentId}/state`);
        return res.data;
    }
    async getEvents(params) {
        const res = await axios_1.default.get(`${this.api}/events`, {
            params
        });
        return res.data;
    }
    async syncEvents() {
        const res = await axios_1.default.post(`${this.api}/events/sync`);
        return res.data;
    }
    async createSession(input) {
        const state = (input.orgId === undefined ||
            input.permissions === undefined ||
            input.expiry === undefined)
            ? await this.getAgentState(input.agentId)
            : null;
        const orgId = input.orgId ?? Number(state?.agent?.org_id);
        const permissions = input.permissions ?? Number(state?.credential?.permissions);
        const expiry = input.expiry ?? Number(state?.credential?.expiry);
        const manager = this.sessionManager();
        const proofBundle = await manager.fetchMerkleProof(input.agentId);
        const sessionWallet = input.sessionKey
            ? { address: input.sessionKey }
            : manager.createSessionWallet();
        const zk = await manager.generateProof(input.agentId, orgId, permissions, expiry, Date.now(), proofBundle);
        const session = await manager.submitSession(input.agentId, zk, sessionWallet.address);
        return {
            session,
            sessionKey: sessionWallet.address,
            sessionPrivateKey: "privateKey" in sessionWallet ? sessionWallet.privateKey : undefined,
            publicSignals: zk.publicSignals
        };
    }
    sessionManager() {
        return new SessionManager_1.SessionManager(this.api, this.secret);
    }
    // ==================== Execution Methods ====================
    /**
     * Execute an action as an autonomous agent.
     * The action must be permitted by the agent's credentials.
     *
     * @param agentId - The external agent ID
     * @param request - The execution request with action and params
     * @returns The execution result
     */
    async executeAction(agentId, request) {
        const nonce = request.nonce || crypto.randomUUID();
        const res = await axios_1.default.post(`${this.api}/external-agents/${agentId}/execute`, {
            action: request.action,
            params: request.params,
            nonce,
            requestedAt: Math.floor(Date.now() / 1000),
            timeout: request.timeout
        });
        return res.data;
    }
    /**
     * Execute a read file action.
     */
    async readFile(agentId, path) {
        return this.executeAction(agentId, {
            action: "read_file",
            params: { path }
        });
    }
    /**
     * Execute a write file action.
     */
    async writeFile(agentId, path, content) {
        return this.executeAction(agentId, {
            action: "write_file",
            params: { path, content }
        });
    }
    /**
     * Execute a shell command.
     */
    async executeCommand(agentId, command, args, cwd) {
        return this.executeAction(agentId, {
            action: "execute_command",
            params: { command, args, cwd }
        });
    }
    /**
     * Execute a database query.
     */
    async query(agentId, query, params) {
        return this.executeAction(agentId, {
            action: "query",
            params: { query, params }
        });
    }
    /**
     * Make an external API call.
     */
    async apiCall(agentId, url, method = "GET", headers, body) {
        return this.executeAction(agentId, {
            action: "api_call",
            params: { url, method, headers, body }
        });
    }
    /**
     * Sign a blockchain transaction.
     */
    async signTransaction(agentId, to, value, data) {
        return this.executeAction(agentId, {
            action: "sign_transaction",
            params: { to, value, data }
        });
    }
    /**
     * Deploy a smart contract.
     */
    async deployContract(agentId, bytecode, abi, constructorArgs) {
        return this.executeAction(agentId, {
            action: "deploy_contract",
            params: { bytecode, abi, constructorArgs }
        });
    }
    /**
     * Execute a custom action.
     */
    async customAction(agentId, customType, params) {
        return this.executeAction(agentId, {
            action: "custom",
            params: { customType, ...params }
        });
    }
    /**
     * Get execution history for an agent.
     */
    async getExecutions(agentId, limit = 50) {
        const res = await axios_1.default.get(`${this.api}/external-agents/${agentId}/executions?limit=${limit}`);
        return res.data;
    }
    /**
     * Get a specific execution by ID.
     */
    async getExecution(agentId, executionId) {
        const res = await axios_1.default.get(`${this.api}/external-agents/${agentId}/executions/${executionId}`);
        return res.data;
    }
    /**
     * Get execution statistics for an agent.
     */
    async getExecutionStats(agentId) {
        const res = await axios_1.default.get(`${this.api}/external-agents/${agentId}/executions/stats`);
        return res.data;
    }
    // ==================== Whitelist Management ====================
    /**
     * Get whitelisted addresses for a wallet.
     */
    async getWhitelist(walletAddress) {
        const res = await axios_1.default.get(`${this.api}/wallets/${walletAddress}/whitelist`);
        return res.data;
    }
    /**
     * Add an address to the wallet's whitelist.
     * Requires signature from the wallet owner.
     */
    async addToWhitelist(walletAddress, party, signature, nonce, requestedAt) {
        const res = await axios_1.default.post(`${this.api}/wallets/${walletAddress}/whitelist`, { party, signature, nonce, requestedAt });
        return res.data;
    }
    /**
     * Remove an address from the wallet's whitelist.
     * Requires signature from the wallet owner.
     */
    async removeFromWhitelist(walletAddress, party, signature, nonce, requestedAt) {
        const res = await axios_1.default.delete(`${this.api}/wallets/${walletAddress}/whitelist/${party}`, { data: { signature, nonce, requestedAt } });
        return res.data;
    }
}
exports.AgentClient = AgentClient;
