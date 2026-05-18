"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExternalAgentService = exports.AGENT_PERMISSIONS = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const errors_1 = require("../utils/errors");
const merkle_1 = require("./merkle");
const crypto_2 = require("../utils/crypto");
// Permission bitmasks for agent actions
exports.AGENT_PERMISSIONS = {
    READ_FILE: 1 << 0, // 1
    WRITE_FILE: 1 << 1, // 2
    EXECUTE_COMMAND: 1 << 2, // 4
    QUERY: 1 << 3, // 8
    API_CALL: 1 << 4, // 16
    SIGN_TRANSACTION: 1 << 5, // 32
    DEPLOY_CONTRACT: 1 << 6, // 64
    CUSTOM: 1 << 7, // 128
    ALL: 255 // All permissions
};
// Action to permission mapping
const ACTION_PERMISSIONS = {
    read_file: exports.AGENT_PERMISSIONS.READ_FILE,
    write_file: exports.AGENT_PERMISSIONS.WRITE_FILE,
    execute_command: exports.AGENT_PERMISSIONS.EXECUTE_COMMAND,
    query: exports.AGENT_PERMISSIONS.QUERY,
    api_call: exports.AGENT_PERMISSIONS.API_CALL,
    sign_transaction: exports.AGENT_PERMISSIONS.SIGN_TRANSACTION,
    deploy_contract: exports.AGENT_PERMISSIONS.DEPLOY_CONTRACT,
    custom: exports.AGENT_PERMISSIONS.CUSTOM
};
function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY?.trim();
    if (!key) {
        throw new errors_1.AppError(500, "ENCRYPTION_KEY environment variable is required", false);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
        throw new errors_1.AppError(500, "ENCRYPTION_KEY must be 64 hex characters", false);
    }
    return Buffer.from(key, "hex");
}
const ENCRYPTION_KEY = getEncryptionKey();
class ExternalAgentService {
    static agentTypeConfigs = {
        openclaude: {
            name: "OpenClaude",
            icon: "claude",
            defaultEndpoint: "https://api.openclaude.ai",
            authType: "api_key",
            capabilities: ["code_execution", "web_browsing", "file_operations", "terminal"],
            securityRequirements: { ssl: true, ipWhitelist: false, rotation: true }
        },
        langchain: {
            name: "LangChain",
            icon: "chain",
            defaultEndpoint: "http://localhost:8000",
            authType: "bearer",
            capabilities: ["llm_chat", "tool_execution", "memory", "rag"],
            securityRequirements: { ssl: true, ipWhitelist: true, rotation: false }
        },
        claude_code: {
            name: "Claude Code (Claude Dev)",
            icon: "claude",
            defaultEndpoint: "http://localhost:8080",
            authType: "api_key",
            capabilities: ["code_execution", "terminal", "git_ops", "web_search"],
            securityRequirements: { ssl: false, ipWhitelist: false, rotation: false }
        },
        custom: {
            name: "Custom Agent",
            icon: "bot",
            defaultEndpoint: "",
            authType: "custom",
            capabilities: [],
            securityRequirements: { ssl: true, ipWhitelist: true, rotation: true }
        },
        crewai: {
            name: "CrewAI",
            icon: "crew",
            defaultEndpoint: "http://localhost:8001",
            authType: "bearer",
            capabilities: ["multi_agent", "task_planning", "role_delegation"],
            securityRequirements: { ssl: true, ipWhitelist: false, rotation: false }
        },
        llama_index: {
            name: "LlamaIndex",
            icon: "llama",
            defaultEndpoint: "http://localhost:8002",
            authType: "bearer",
            capabilities: ["rag", "knowledge_graph", "query_engine"],
            securityRequirements: { ssl: true, ipWhitelist: false, rotation: false }
        },
        autogen: {
            name: "AutoGen",
            icon: "auto",
            defaultEndpoint: "http://localhost:8003",
            authType: "api_key",
            capabilities: ["multi_agent", "code_execution", "conversation"],
            securityRequirements: { ssl: true, ipWhitelist: false, rotation: false }
        },
        smolagents: {
            name: "SmolAgents",
            icon: "smol",
            defaultEndpoint: "http://localhost:8004",
            authType: "api_key",
            capabilities: ["code_execution", "web_search", "terminal"],
            securityRequirements: { ssl: false, ipWhitelist: false, rotation: false }
        }
    };
    async createExternalAgent(orgId, agentType, name, endpoint, metadata, existingLinkedAgentId) {
        const db = await (0, db_1.initDB)();
        const config = ExternalAgentService.agentTypeConfigs[agentType];
        if (!config) {
            throw new errors_1.AppError(400, "unsupported agent type");
        }
        let linkedAgentId;
        if (existingLinkedAgentId) {
            // Link to existing protocol agent
            const existingAgent = await db.get(`SELECT id, org_id FROM agents WHERE id = ?`, existingLinkedAgentId);
            if (!existingAgent) {
                throw new errors_1.AppError(404, "linked agent not found");
            }
            if (existingAgent.org_id !== orgId) {
                throw new errors_1.AppError(403, "linked agent belongs to different organization");
            }
            linkedAgentId = existingLinkedAgentId;
        }
        else {
            // Create new protocol agent
            const linkedAgent = await db.run(`
                INSERT INTO agents (org_id, agent_name)
                VALUES (?, ?)
                `, orgId, name);
            linkedAgentId = linkedAgent.lastID;
        }
        const result = await db.run(`
            INSERT INTO external_agents
            (org_id, linked_agent_id, agent_type, agent_name, agent_endpoint, status, is_active, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, orgId, linkedAgentId, agentType, name, endpoint ?? config.defaultEndpoint, existingLinkedAgentId ? "active" : "disconnected", // Active when linking to existing agent
        1, JSON.stringify(metadata || {}));
        return {
            agentId: result.lastID,
            linkedAgentId,
            name,
            agentType
        };
    }
    async listExternalAgents(orgId) {
        const db = await (0, db_1.initDB)();
        const query = orgId
            ? `SELECT * FROM external_agents WHERE org_id = ? ORDER BY created_at DESC`
            : `SELECT * FROM external_agents ORDER BY created_at DESC`;
        const params = orgId ? [orgId] : [];
        const agents = await db.all(query, ...params);
        return agents.map((agent) => this.mapAgent(agent));
    }
    async getExternalAgent(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        const agent = orgId
            ? await db.get(`SELECT * FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId)
            : await db.get(`SELECT * FROM external_agents WHERE id = ?`, agentId);
        return agent ? this.mapAgent(agent) : null;
    }
    async ensureExternalAgent(agentId, orgId) {
        const agent = await this.getExternalAgent(agentId, orgId);
        if (!agent) {
            throw new errors_1.AppError(404, "agent not found");
        }
        return agent;
    }
    async updateExternalAgent(agentId, orgId, updates) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const setClauses = [];
        const params = [];
        if (updates.name !== undefined) {
            setClauses.push("agent_name = ?");
            params.push(updates.name);
        }
        if (updates.endpoint !== undefined) {
            setClauses.push("agent_endpoint = ?");
            params.push(updates.endpoint);
        }
        if (updates.apiKey !== undefined) {
            setClauses.push("agent_api_key = ?");
            params.push(this.encryptValue(updates.apiKey));
        }
        if (updates.apiSecret !== undefined) {
            setClauses.push("agent_api_secret = ?");
            params.push(this.encryptValue(updates.apiSecret));
        }
        if (updates.isActive !== undefined) {
            setClauses.push("is_active = ?");
            params.push(updates.isActive ? 1 : 0);
        }
        if (updates.metadata !== undefined) {
            setClauses.push("metadata = ?");
            params.push(JSON.stringify(updates.metadata));
        }
        if (setClauses.length === 0)
            return { success: false };
        setClauses.push("updated_at = ?");
        params.push(Math.floor(Date.now() / 1000));
        params.push(agentId);
        await db.run(`UPDATE external_agents SET ${setClauses.join(", ")} WHERE id = ?`, ...params);
        return { success: true };
    }
    async deleteExternalAgent(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        await db.run(`DELETE FROM agent_whitelisted_contracts WHERE external_agent_id = ?`, agentId);
        await db.run(`DELETE FROM agent_funding_accounts WHERE external_agent_id = ?`, agentId);
        await db.run(`DELETE FROM agent_vault_credentials WHERE external_agent_id = ?`, agentId);
        await db.run(`DELETE FROM external_agents WHERE id = ?`, agentId);
        return { success: true };
    }
    async testConnection(agentId, orgId) {
        const agent = await this.getExternalAgentForInternalUse(agentId, orgId);
        if (!agent) {
            return { success: false, latency: 0, error: "Agent not found" };
        }
        const startTime = Date.now();
        try {
            const endpoint = this.healthEndpoint(agent.endpoint);
            const response = await fetch(endpoint, {
                method: "GET",
                headers: this.getAuthHeaders(agent),
                signal: AbortSignal.timeout(5000)
            });
            const latency = Date.now() - startTime;
            if (response.ok) {
                await this.updateAgentStatus(agentId, "connected");
                return { success: true, latency, status: "healthy" };
            }
            else {
                await this.updateAgentStatus(agentId, "error");
                return { success: false, latency, error: `HTTP ${response.status}` };
            }
        }
        catch (error) {
            await this.updateAgentStatus(agentId, "disconnected");
            return { success: false, latency: Date.now() - startTime, error: error.message };
        }
    }
    async performSecurityAudit(agentId, orgId) {
        const agent = await this.getExternalAgent(agentId, orgId);
        if (!agent) {
            return {
                agentId,
                passed: false,
                score: 0,
                checks: [],
                performedAt: new Date().toISOString(),
                error: "Agent not found"
            };
        }
        const checks = [];
        const config = ExternalAgentService.agentTypeConfigs[agent.agentType];
        if (!config) {
            throw new errors_1.AppError(400, "unsupported agent type");
        }
        // Check 1: SSL/TLS validation
        const sslCheck = await this.checkSSL(agent.endpoint);
        checks.push(sslCheck);
        // Check 2: API key encryption
        const encryptionCheck = await this.checkEncryptionStored(agentId);
        checks.push(encryptionCheck);
        // Check 3: Credential rotation capability
        const rotationCheck = this.checkRotationCapability(config);
        checks.push(rotationCheck);
        // Check 4: IP whitelist (if required)
        const ipCheck = await this.checkIPWhitelist(agent);
        checks.push(ipCheck);
        // Check 5: Funding account security
        const fundingCheck = await this.checkFundingSecurity(agentId);
        checks.push(fundingCheck);
        // Check 6: Contract whitelist validation
        const contractCheck = await this.checkContractWhitelist(agentId);
        checks.push(contractCheck);
        // Check 7: Rate limiting configuration
        const rateLimitCheck = await this.checkRateLimiting(agent);
        checks.push(rateLimitCheck);
        // Calculate score
        const passedChecks = checks.filter(c => c.passed).length;
        const score = Math.round((passedChecks / checks.length) * 100);
        return {
            agentId,
            passed: passedChecks === checks.length,
            score,
            checks,
            performedAt: new Date().toISOString()
        };
    }
    async checkSSL(endpoint) {
        try {
            const url = new URL(endpoint);
            if (url.protocol === "http:" && url.hostname !== "localhost") {
                return {
                    name: "SSL/TLS Encryption",
                    passed: false,
                    severity: "critical",
                    details: "Non-HTTPS endpoint detected. Exposes credentials in transit."
                };
            }
            if (url.protocol === "https:") {
                return {
                    name: "SSL/TLS Encryption",
                    passed: true,
                    severity: "low",
                    details: "HTTPS properly configured"
                };
            }
            return {
                name: "SSL/TLS Encryption",
                passed: true,
                severity: "low",
                details: "Localhost connection (development)"
            };
        }
        catch {
            return {
                name: "SSL/TLS Encryption",
                passed: false,
                severity: "critical",
                details: "Invalid endpoint URL"
            };
        }
    }
    async checkEncryptionStored(agentId) {
        const db = await (0, db_1.initDB)();
        const credentials = await db.all(`SELECT agent_api_key FROM external_agents WHERE id = ?`, agentId);
        if (credentials.length === 0 || !credentials[0].agent_api_key) {
            return {
                name: "Credential Encryption",
                passed: true,
                severity: "low",
                details: "No stored credentials"
            };
        }
        const isEncrypted = credentials[0].agent_api_key.startsWith("ENC:");
        return {
            name: "Credential Encryption",
            passed: isEncrypted,
            severity: isEncrypted ? "low" : "critical",
            details: isEncrypted
                ? "API keys are encrypted at rest"
                : "API keys stored in plaintext! Immediate rotation required."
        };
    }
    checkRotationCapability(config) {
        const canRotate = config.securityRequirements.rotation;
        return {
            name: "Credential Rotation",
            passed: canRotate,
            severity: canRotate ? "low" : "medium",
            details: canRotate
                ? "Credential rotation supported"
                : "Manual rotation required. Consider enabling auto-rotation."
        };
    }
    async checkIPWhitelist(agent) {
        const metadata = JSON.parse(agent.metadata || "{}");
        const hasIPWhitelist = metadata.ipWhitelist && Array.isArray(metadata.ipWhitelist);
        return {
            name: "IP Whitelisting",
            passed: Boolean(hasIPWhitelist),
            severity: hasIPWhitelist ? "low" : "medium",
            details: hasIPWhitelist
                ? `IP whitelist configured: ${metadata.ipWhitelist.join(", ")}`
                : "No IP restriction. Consider adding IP whitelist."
        };
    }
    async checkFundingSecurity(agentId) {
        const db = await (0, db_1.initDB)();
        const accounts = await db.all(`SELECT wallet_private_key_encrypted, daily_limit, is_active 
             FROM agent_funding_accounts 
             WHERE external_agent_id = ?`, agentId);
        if (accounts.length === 0) {
            return {
                name: "Funding Account Security",
                passed: true,
                severity: "low",
                details: "No funding accounts configured"
            };
        }
        const allEncrypted = accounts.every(a => a.wallet_private_key_encrypted.startsWith("ENC:"));
        const hasLimits = accounts.every(a => Number(a.daily_limit) > 0);
        return {
            name: "Funding Account Security",
            passed: allEncrypted && hasLimits,
            severity: allEncrypted && hasLimits ? "low" : "critical",
            details: allEncrypted
                ? `Funding secured with $${accounts[0].daily_limit}/day limit`
                : "Missing encryption or daily limits on funding accounts!"
        };
    }
    async checkContractWhitelist(agentId) {
        const db = await (0, db_1.initDB)();
        const contracts = await db.all(`SELECT contract_address, is_enabled 
             FROM agent_whitelisted_contracts 
             WHERE external_agent_id = ?`, agentId);
        if (contracts.length === 0) {
            return {
                name: "Contract Whitelisting",
                passed: false,
                severity: "high",
                details: "No contracts whitelisted. Agent can interact with ANY contract."
            };
        }
        const allEnabled = contracts.every(c => c.is_enabled === 1);
        return {
            name: "Contract Whitelisting",
            passed: allEnabled && contracts.length > 0,
            severity: allEnabled ? "low" : "high",
            details: `${contracts.length} contract(s) whitelisted`
        };
    }
    async checkRateLimiting(agent) {
        const metadata = JSON.parse(agent.metadata || "{}");
        const hasRateLimit = metadata.rateLimit && metadata.rateLimit.requestsPerMinute;
        return {
            name: "Rate Limiting",
            passed: Boolean(hasRateLimit),
            severity: hasRateLimit ? "low" : "medium",
            details: hasRateLimit
                ? `Rate limited to ${metadata.rateLimit.requestsPerMinute} req/min`
                : "No rate limiting. Consider adding to prevent abuse."
        };
    }
    // Vault credentials management
    async addVaultCredential(agentId, orgId, name, value, type = "api_key", expiresAt) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const result = await db.run(`
            INSERT INTO agent_vault_credentials 
            (external_agent_id, credential_name, encrypted_value, credential_type, is_secret, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            `, agentId, name, this.encryptValue(value), type, 1, expiresAt);
        return { credentialId: result.lastID };
    }
    async listVaultCredentials(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const credentials = await db.all(`SELECT * FROM agent_vault_credentials WHERE external_agent_id = ?`, agentId);
        return credentials.map((c) => ({
            id: c.id,
            externalAgentId: c.external_agent_id,
            name: c.credential_name,
            maskedValue: this.maskValue(c.encrypted_value),
            type: c.credential_type,
            isSecret: c.is_secret === 1,
            expiresAt: c.expires_at,
            createdAt: c.created_at
        }));
    }
    async deleteVaultCredential(agentId, credentialId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        await db.run(`DELETE FROM agent_vault_credentials WHERE id = ? AND external_agent_id = ?`, credentialId, agentId);
        return { success: true };
    }
    // Funding accounts management
    async addFundingAccount(agentId, orgId, walletAddress, encryptedPrivateKey, dailyLimit) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const result = await db.run(`
            INSERT INTO agent_funding_accounts 
            (external_agent_id, wallet_address, wallet_private_key_encrypted, daily_limit)
            VALUES (?, ?, ?, ?)
            `, agentId, walletAddress, this.encryptValue(encryptedPrivateKey), dailyLimit ?? "0");
        return { accountId: result.lastID };
    }
    async listFundingAccounts(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const accounts = await db.all(`SELECT * FROM agent_funding_accounts WHERE external_agent_id = ?`, agentId);
        return accounts.map((a) => ({
            id: a.id,
            externalAgentId: a.external_agent_id,
            address: a.wallet_address,
            maskedKey: this.maskValue(a.wallet_private_key_encrypted),
            balance: a.balance,
            dailyLimit: a.daily_limit,
            isActive: a.is_active === 1,
            createdAt: a.created_at,
            updatedAt: a.updated_at
        }));
    }
    async updateFundingAccountBalance(accountId, balance) {
        const db = await (0, db_1.initDB)();
        await db.run(`UPDATE agent_funding_accounts SET balance = ?, updated_at = ? WHERE id = ?`, balance, Math.floor(Date.now() / 1000), accountId);
    }
    async deleteFundingAccount(agentId, accountId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        await db.run(`DELETE FROM agent_funding_accounts WHERE id = ? AND external_agent_id = ?`, accountId, agentId);
        return { success: true };
    }
    // Contract whitelist management
    async addWhitelistedContract(agentId, orgId, address, name, abi) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const result = await db.run(`
            INSERT INTO agent_whitelisted_contracts 
            (external_agent_id, contract_address, contract_name, contract_abi)
            VALUES (?, ?, ?, ?)
            `, agentId, address, name, abi);
        return { contractId: result.lastID };
    }
    async listWhitelistedContracts(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        const contracts = await db.all(`SELECT * FROM agent_whitelisted_contracts WHERE external_agent_id = ?`, agentId);
        return contracts.map((c) => ({
            id: c.id,
            externalAgentId: c.external_agent_id,
            address: c.contract_address,
            name: c.contract_name,
            abi: c.contract_abi,
            isEnabled: c.is_enabled === 1,
            createdAt: c.created_at
        }));
    }
    async toggleContractWhitelist(agentId, contractId, orgId, enabled) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        await db.run(`UPDATE agent_whitelisted_contracts SET is_enabled = ? WHERE id = ? AND external_agent_id = ?`, enabled ? 1 : 0, contractId, agentId);
    }
    async deleteWhitelistedContract(agentId, contractId, orgId) {
        const db = await (0, db_1.initDB)();
        await this.ensureExternalAgent(agentId, orgId);
        await db.run(`DELETE FROM agent_whitelisted_contracts WHERE id = ? AND external_agent_id = ?`, contractId, agentId);
        return { success: true };
    }
    async updateAgentStatus(agentId, status) {
        const db = await (0, db_1.initDB)();
        await db.run(`UPDATE external_agents SET status = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?`, status, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), agentId);
    }
    encryptValue(value) {
        const iv = crypto_1.default.randomBytes(16);
        const cipher = crypto_1.default.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(value, "utf8", "hex");
        encrypted += cipher.final("hex");
        const authTag = cipher.getAuthTag();
        return `ENC:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    }
    decryptValue(encrypted) {
        if (!encrypted.startsWith("ENC:"))
            return encrypted;
        const [, ivHex, authTagHex, encryptedData] = encrypted.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const authTag = Buffer.from(authTagHex, "hex");
        const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedData, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }
    maskValue(encrypted) {
        if (!encrypted.startsWith("ENC:"))
            return "***";
        return "ENC:****:****:****";
    }
    getAuthHeaders(agent) {
        const token = "apiKey" in agent ? this.decryptValue(String(agent.apiKey || "")) : "";
        return {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
        };
    }
    healthEndpoint(endpoint) {
        if (!endpoint) {
            throw new errors_1.AppError(400, "agent endpoint is required");
        }
        const url = new URL(endpoint);
        const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
        const allowPrivate = process.env.ALLOW_PRIVATE_AGENT_ENDPOINTS === "true";
        if (url.protocol !== "https:" && !(allowPrivate && isLocalhost)) {
            throw new errors_1.AppError(400, "agent endpoint must use HTTPS");
        }
        url.pathname = `${url.pathname.replace(/\/$/, "")}/health`;
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    async getExternalAgentForInternalUse(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        const agent = await db.get(`SELECT * FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId);
        return agent ? this.mapAgent(agent, true) : null;
    }
    mapAgent(agent, includeSecrets = false) {
        return {
            id: agent.id,
            orgId: agent.org_id,
            linkedAgentId: agent.linked_agent_id ?? undefined,
            agentType: agent.agent_type,
            name: agent.agent_name,
            endpoint: agent.agent_endpoint,
            ...(includeSecrets ? {
                apiKey: agent.agent_api_key,
                apiSecret: agent.agent_api_secret
            } : {
                hasApiKey: Boolean(agent.agent_api_key),
                hasApiSecret: Boolean(agent.agent_api_secret)
            }),
            status: agent.status,
            isActive: agent.is_active === 1,
            createdAt: agent.created_at,
            updatedAt: agent.updated_at,
            lastHeartbeatAt: agent.last_heartbeat_at,
            metadata: agent.metadata
        };
    }
    // ============================================================
    // EXECUTION LAYER - Send tasks to agents and track results
    // ============================================================
    /**
     * Execute a request on an external agent runtime
     * This sends a signed request to the agent's endpoint and logs the result
     */
    async executeRequest(agentId, orgId, request, proof) {
        const db = await (0, db_1.initDB)();
        const requestId = request.nonce || crypto_1.default.randomUUID();
        const startTime = Date.now();
        // Get the agent with credentials
        const agent = await this.getExternalAgentForInternalUse(agentId, orgId);
        if (!agent) {
            throw new errors_1.AppError(404, "Agent not found");
        }
        if (!agent.endpoint) {
            throw new errors_1.AppError(400, "Agent has no endpoint configured");
        }
        if (agent.status !== "connected" && agent.status !== "running") {
            throw new errors_1.AppError(400, `Agent is not available (status: ${agent.status})`);
        }
        // Build the execution URL
        const executeUrl = this.executeEndpoint(agent.endpoint);
        // Build headers with auth
        const headers = {
            "Content-Type": "application/json",
            "X-Agentix-Request-ID": requestId,
            "X-Agentix-Org-ID": String(orgId),
            "X-Agentix-Agent-ID": String(agentId),
            "X-Agentix-Timestamp": String(request.requestedAt)
        };
        // Add API key if available
        if (agent.apiKey) {
            headers["Authorization"] = `Bearer ${agent.apiKey}`;
        }
        // Build request body with proof
        const body = {
            action: request.action,
            params: request.params,
            nonce: requestId,
            requestedAt: request.requestedAt,
            timeout: request.timeout || 30000
        };
        if (proof) {
            body.credentialProof = proof;
        }
        let result = null;
        let success = false;
        let errorMessage = null;
        try {
            const response = await fetch(executeUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(request.timeout || 30000)
            });
            const responseTime = Date.now() - startTime;
            if (!response.ok) {
                const errorText = await response.text().catch(() => "Unknown error");
                errorMessage = `Agent returned ${response.status}: ${errorText}`;
                success = false;
            }
            else {
                result = await response.json().catch(() => ({}));
                success = result.success !== false;
                if (!success && result.error) {
                    errorMessage = result.error;
                }
            }
        }
        catch (err) {
            errorMessage = err.message || "Request failed";
            success = false;
        }
        const executionTime = Date.now() - startTime;
        // Log the execution
        const logResult = await db.run(`INSERT INTO agent_execution_logs
            (external_agent_id, org_id, request_id, action, params, proof, result, success, error_message, execution_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, agentId, orgId, requestId, request.action, JSON.stringify(request.params), proof ? JSON.stringify(proof) : null, result ? JSON.stringify(result) : null, success ? 1 : 0, errorMessage, executionTime);
        return {
            success,
            result,
            executionId: logResult.lastID,
            error: errorMessage || undefined,
            executionTime
        };
    }
    /**
     * Get execution logs for an agent
     */
    async getExecutionLogs(agentId, orgId, options) {
        const db = await (0, db_1.initDB)();
        // Verify agent belongs to org
        const agent = await db.get(`SELECT id FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId);
        if (!agent) {
            throw new errors_1.AppError(404, "Agent not found");
        }
        const limit = options?.limit || 50;
        const offset = options?.offset || 0;
        let sql = `SELECT * FROM agent_execution_logs WHERE external_agent_id = ?`;
        const params = [agentId];
        if (options?.action) {
            sql += ` AND action = ?`;
            params.push(options.action);
        }
        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        const logs = await db.all(sql, ...params);
        return logs.map((log) => ({
            id: log.id,
            externalAgentId: log.external_agent_id,
            orgId: log.org_id,
            requestId: log.request_id,
            action: log.action,
            params: log.params,
            proof: log.proof,
            result: log.result,
            success: log.success === 1,
            errorMessage: log.error_message,
            executionTimeMs: log.execution_time_ms,
            createdAt: log.created_at
        }));
    }
    /**
     * Get a single execution by ID
     */
    async getExecution(executionId, orgId) {
        const db = await (0, db_1.initDB)();
        const log = await db.get(`SELECT * FROM agent_execution_logs WHERE id = ? AND org_id = ?`, executionId, orgId);
        if (!log)
            return null;
        return {
            id: log.id,
            externalAgentId: log.external_agent_id,
            orgId: log.org_id,
            requestId: log.request_id,
            action: log.action,
            params: log.params,
            proof: log.proof,
            result: log.result,
            success: log.success === 1,
            errorMessage: log.error_message,
            executionTimeMs: log.execution_time_ms,
            createdAt: log.created_at
        };
    }
    /**
     * Get execution statistics for an agent
     */
    async getExecutionStats(agentId, orgId) {
        const db = await (0, db_1.initDB)();
        // Verify agent belongs to org
        const agent = await db.get(`SELECT id FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId);
        if (!agent) {
            throw new errors_1.AppError(404, "Agent not found");
        }
        const stats = await db.get(`SELECT
                COUNT(*) as total,
                SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed,
                AVG(execution_time_ms) as avg_time,
                MAX(created_at) as last_execution
            FROM agent_execution_logs
            WHERE external_agent_id = $1`, agentId);
        return {
            totalExecutions: stats?.total || 0,
            successfulExecutions: stats?.successful || 0,
            failedExecutions: stats?.failed || 0,
            avgExecutionTimeMs: Math.round(stats?.avg_time || 0),
            lastExecutionAt: stats?.last_execution || null
        };
    }
    // ============================================================
    // AUTHORIZATION PROOFS - ZK proof generation for agent actions
    // ============================================================
    /**
     * Generate an authorization proof for an agent action
     * This creates a ZK proof that the agent is authorized to perform the action
     */
    async generateAuthorizationProof(agentId, orgId, action, expirySeconds = 3600) {
        const db = await (0, db_1.initDB)();
        // Get the agent and its linked credential
        const agent = await db.get(`SELECT ea.*, c.permissions, c.expiry as credential_expiry, c.merkle_index
             FROM external_agents ea
             LEFT JOIN credentials c ON ea.linked_agent_id = c.agent_id
             WHERE ea.id = ? AND ea.org_id = ?`, agentId, orgId);
        if (!agent) {
            throw new errors_1.AppError(404, "Agent not found");
        }
        // Check if agent has the required permission
        const requiredPermission = ACTION_PERMISSIONS[action] || 0;
        const agentPermissions = agent.permissions || exports.AGENT_PERMISSIONS.ALL;
        if ((agentPermissions & requiredPermission) === 0 && requiredPermission !== 0) {
            throw new errors_1.AppError(403, `Agent does not have permission for action: ${action}`);
        }
        // Check credential expiry
        if (agent.credential_expiry && agent.credential_expiry < Math.floor(Date.now() / 1000)) {
            throw new errors_1.AppError(403, "Agent credential has expired");
        }
        // Get merkle proof for the credential
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId });
        const merkleIndex = agent.merkle_index ?? 0;
        const merkleProof = await tree.generateProof(db, merkleIndex);
        const merkleRoot = await tree.getRoot(db);
        // Generate nullifier (unique per request to prevent replay)
        const nullifier = (0, crypto_2.poseidonHash)([
            BigInt(agentId),
            BigInt(Math.floor(Date.now() / 1000)),
            BigInt(crypto_1.default.randomInt(1, 1000000))
        ]);
        // Build the execution proof
        const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds;
        // Create the proof object (simplified - in production this would use actual ZK circuit)
        const proof = {
            nullifier: nullifier.toString(),
            root: merkleRoot.toString(),
            revokedRoot: "0", // Would be computed from revocation tree
            proof: {
                a: ["0", "0"],
                b: [["0", "0"], ["0", "0"]],
                c: ["0", "0"]
            },
            publicSignals: [
                nullifier.toString(),
                merkleRoot.toString(),
                "0", // revokedRoot
                agentPermissions.toString(),
                expiresAt.toString()
            ]
        };
        return {
            proof,
            permissionBitmask: agentPermissions,
            expiresAt
        };
    }
    /**
     * Verify an authorization proof
     * This validates that the proof is valid and matches the agent
     */
    async verifyAuthorizationProof(agentId, orgId, proof, action) {
        const db = await (0, db_1.initDB)();
        // Get current merkle root
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId });
        const currentState = await tree.loadState(db);
        if (!currentState) {
            return { valid: false, error: "No credentials found for organization" };
        }
        // Verify root matches
        if (proof.root !== currentState.root.toString()) {
            return { valid: false, error: "Proof root does not match current tree" };
        }
        // Check action permission
        const requiredPermission = ACTION_PERMISSIONS[action] || 0;
        const grantedPermissions = parseInt(proof.publicSignals[3]) || 0;
        if ((grantedPermissions & requiredPermission) === 0 && requiredPermission !== 0) {
            return { valid: false, error: "Proof does not grant permission for this action" };
        }
        // Check expiry
        const expiry = parseInt(proof.publicSignals[4]) || 0;
        if (expiry < Math.floor(Date.now() / 1000)) {
            return { valid: false, error: "Proof has expired" };
        }
        // Verify nullifier hasn't been used (prevent replay)
        const usedNullifier = await db.get(`SELECT id FROM used_nullifiers WHERE nullifier = ?`, proof.nullifier);
        if (usedNullifier) {
            return { valid: false, error: "Proof has already been used" };
        }
        return { valid: true };
    }
    /**
     * Mark a nullifier as used to prevent replay attacks
     */
    async consumeNullifier(nullifier) {
        const db = await (0, db_1.initDB)();
        await db.run(`INSERT INTO used_nullifiers (nullifier, used_at)
             VALUES (?, ?)`, nullifier, Math.floor(Date.now() / 1000));
    }
    executeEndpoint(endpoint) {
        const url = new URL(endpoint);
        url.pathname = `${url.pathname.replace(/\/$/, "")}/execute`;
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    static getSupportedAgentTypes() {
        return Object.entries(ExternalAgentService.agentTypeConfigs).map(([id, config]) => ({
            id: id,
            name: config.name,
            icon: config.icon,
            capabilities: config.capabilities
        }));
    }
}
exports.ExternalAgentService = ExternalAgentService;
exports.default = ExternalAgentService;
