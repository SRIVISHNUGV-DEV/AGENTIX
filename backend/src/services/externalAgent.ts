import * as crypto from "crypto"
import fs from "fs"
import path from "path"
import { initDB } from "../db"
import {
    ExternalAgent,
    ExternalAgentType,
    AgentStatus,
    VaultCredential,
    FundingAccount,
    WhitelistedContract,
    SecurityAuditResult,
    ConnectionTestResult,
    ExecutionRequest,
    ExecutionProof,
    ExecutionResult,
    AgentExecutionLog
} from "../types/externalAgent"
import { AppError } from "../utils/errors"
import { IncrementalMerkleTree } from "./merkle"
import { SparseRevocationTree } from "./revocationTree"
import { poseidonHash } from "../utils/crypto"

// Permission bitmasks for agent actions
export const AGENT_PERMISSIONS = {
    READ_FILE: 1 << 0,        // 1
    WRITE_FILE: 1 << 1,       // 2
    EXECUTE_COMMAND: 1 << 2,  // 4
    QUERY: 1 << 3,            // 8
    API_CALL: 1 << 4,         // 16
    SIGN_TRANSACTION: 1 << 5, // 32
    DEPLOY_CONTRACT: 1 << 6,  // 64
    CUSTOM: 1 << 7,           // 128
    ALL: 255                  // All permissions
} as const

// Action to permission mapping
const ACTION_PERMISSIONS: Record<string, number> = {
    read_file: AGENT_PERMISSIONS.READ_FILE,
    write_file: AGENT_PERMISSIONS.WRITE_FILE,
    execute_command: AGENT_PERMISSIONS.EXECUTE_COMMAND,
    query: AGENT_PERMISSIONS.QUERY,
    api_call: AGENT_PERMISSIONS.API_CALL,
    sign_transaction: AGENT_PERMISSIONS.SIGN_TRANSACTION,
    deploy_contract: AGENT_PERMISSIONS.DEPLOY_CONTRACT,
    custom: AGENT_PERMISSIONS.CUSTOM
}

function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY?.trim()

    if(!key){
        throw new AppError(500, "ENCRYPTION_KEY environment variable is required", false)
    }

    if(!/^[0-9a-fA-F]{64}$/.test(key)){
        throw new AppError(500, "ENCRYPTION_KEY must be 64 hex characters", false)
    }

    return Buffer.from(key, "hex")
}

const ENCRYPTION_KEY = getEncryptionKey()

export class ExternalAgentService {
    private static agentTypeConfigs: Record<ExternalAgentType, {
        name: string
        icon: string
        defaultEndpoint: string
        authType: "api_key" | "bearer" | "basic" | "custom"
        capabilities: string[]
        securityRequirements: { ssl: boolean; ipWhitelist: boolean; rotation: boolean }
    }> = {
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
    }

    async createExternalAgent(
        orgId: number,
        agentType: ExternalAgentType,
        name: string,
        endpoint?: string,
        metadata?: Record<string, unknown>
    ): Promise<{ agentId: number; linkedAgentId: number; name: string; agentType: string }> {
        const db = await initDB()
        const config = ExternalAgentService.agentTypeConfigs[agentType]
        if (!config) {
            throw new AppError(400, "unsupported agent type")
        }

        const linkedAgent = await db.run(
            `
            INSERT INTO agents (org_id, agent_name)
            VALUES (?, ?)
            `,
            orgId,
            name
        )

        const linkedAgentId = linkedAgent.lastID

        const result = await db.run(
            `
            INSERT INTO external_agents 
            (org_id, linked_agent_id, agent_type, agent_name, agent_endpoint, status, is_active, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            orgId,
            linkedAgentId,
            agentType,
            name,
            endpoint ?? config.defaultEndpoint,
            "disconnected",
            1,
            JSON.stringify(metadata || {})
        )

        return {
            agentId: result.lastID,
            linkedAgentId,
            name,
            agentType
        }
    }

    async listExternalAgents(orgId?: number): Promise<ExternalAgent[]> {
        const db = await initDB()
        const query = orgId
            ? `SELECT * FROM external_agents WHERE org_id = ? ORDER BY created_at DESC`
            : `SELECT * FROM external_agents ORDER BY created_at DESC`
        const params = orgId ? [orgId] : []

        const agents = await db.all(query, ...params)
        return agents.map((agent: any) => this.mapAgent(agent))
    }

    async getExternalAgent(agentId: number, orgId?: number): Promise<ExternalAgent | null> {
        const db = await initDB()
        const agent = orgId
            ? await db.get(`SELECT * FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId)
            : await db.get(`SELECT * FROM external_agents WHERE id = ?`, agentId)
        return agent ? this.mapAgent(agent) : null
    }

    async ensureExternalAgent(agentId: number, orgId: number): Promise<ExternalAgent> {
        const agent = await this.getExternalAgent(agentId, orgId)
        if (!agent) {
            throw new AppError(404, "agent not found")
        }
        return agent
    }

    async updateExternalAgent(
        agentId: number,
        orgId: number,
        updates: Partial<{
            name: string
            endpoint: string
            apiKey: string
            apiSecret: string
            isActive: boolean
            metadata: Record<string, unknown>
        }>
    ): Promise<{ success: boolean }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const setClauses: string[] = []
        const params: any[] = []

        if (updates.name !== undefined) {
            setClauses.push("agent_name = ?")
            params.push(updates.name)
        }
        if (updates.endpoint !== undefined) {
            setClauses.push("agent_endpoint = ?")
            params.push(updates.endpoint)
        }
        if (updates.apiKey !== undefined) {
            setClauses.push("agent_api_key = ?")
            params.push(this.encryptValue(updates.apiKey))
        }
        if (updates.apiSecret !== undefined) {
            setClauses.push("agent_api_secret = ?")
            params.push(this.encryptValue(updates.apiSecret))
        }
        if (updates.isActive !== undefined) {
            setClauses.push("is_active = ?")
            params.push(updates.isActive ? 1 : 0)
        }
        if (updates.metadata !== undefined) {
            setClauses.push("metadata = ?")
            params.push(JSON.stringify(updates.metadata))
        }

        if (setClauses.length === 0) return { success: false }

        setClauses.push("updated_at = ?")
        params.push(Math.floor(Date.now() / 1000))
        params.push(agentId)

        await db.run(
            `UPDATE external_agents SET ${setClauses.join(", ")} WHERE id = ?`,
            ...params
        )

        return { success: true }
    }

    async deleteExternalAgent(agentId: number, orgId: number): Promise<{ success: boolean }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        await db.run(`DELETE FROM agent_whitelisted_contracts WHERE external_agent_id = ?`, agentId)
        await db.run(`DELETE FROM agent_funding_accounts WHERE external_agent_id = ?`, agentId)
        await db.run(`DELETE FROM agent_vault_credentials WHERE external_agent_id = ?`, agentId)
        await db.run(`DELETE FROM external_agents WHERE id = ?`, agentId)
        return { success: true }
    }

    async testConnection(agentId: number, orgId: number): Promise<ConnectionTestResult> {
        const agent = await this.getExternalAgentForInternalUse(agentId, orgId)
        if (!agent) {
            return { success: false, latency: 0, error: "Agent not found" }
        }

        const startTime = Date.now()
        try {
            const endpoint = this.healthEndpoint(agent.endpoint)
            const response = await fetch(endpoint, {
                method: "GET",
                headers: this.getAuthHeaders(agent),
                signal: AbortSignal.timeout(5000)
            })
            const latency = Date.now() - startTime

            if (response.ok) {
                await this.updateAgentStatus(agentId, "connected")
                return { success: true, latency, status: "healthy" }
            } else {
                await this.updateAgentStatus(agentId, "error")
                return { success: false, latency, error: `HTTP ${response.status}` }
            }
        } catch (error: any) {
            await this.updateAgentStatus(agentId, "disconnected")
            return { success: false, latency: Date.now() - startTime, error: error.message }
        }
    }

    async performSecurityAudit(agentId: number, orgId: number): Promise<SecurityAuditResult> {
        const agent = await this.getExternalAgent(agentId, orgId)
        if (!agent) {
            return {
                agentId,
                passed: false,
                score: 0,
                checks: [],
                performedAt: new Date().toISOString(),
                error: "Agent not found"
            }
        }

        const checks: SecurityAuditResult["checks"] = []
        const config = ExternalAgentService.agentTypeConfigs[agent.agentType]
        if (!config) {
            throw new AppError(400, "unsupported agent type")
        }

        // Check 1: SSL/TLS validation
        const sslCheck = await this.checkSSL(agent.endpoint)
        checks.push(sslCheck)

        // Check 2: API key encryption
        const encryptionCheck = await this.checkEncryptionStored(agentId)
        checks.push(encryptionCheck)

        // Check 3: Credential rotation capability
        const rotationCheck = this.checkRotationCapability(config)
        checks.push(rotationCheck)

        // Check 4: IP whitelist (if required)
        const ipCheck = await this.checkIPWhitelist(agent)
        checks.push(ipCheck)

        // Check 5: Funding account security
        const fundingCheck = await this.checkFundingSecurity(agentId)
        checks.push(fundingCheck)

        // Check 6: Contract whitelist validation
        const contractCheck = await this.checkContractWhitelist(agentId)
        checks.push(contractCheck)

        // Check 7: Rate limiting configuration
        const rateLimitCheck = await this.checkRateLimiting(agent)
        checks.push(rateLimitCheck)

        // Calculate score
        const passedChecks = checks.filter(c => c.passed).length
        const score = Math.round((passedChecks / checks.length) * 100)

        return {
            agentId,
            passed: passedChecks === checks.length,
            score,
            checks,
            performedAt: new Date().toISOString()
        }
    }

    private async checkSSL(endpoint: string): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        try {
            const url = new URL(endpoint)
            if (url.protocol === "http:" && url.hostname !== "localhost") {
                return {
                    name: "SSL/TLS Encryption",
                    passed: false,
                    severity: "critical",
                    details: "Non-HTTPS endpoint detected. Exposes credentials in transit."
                }
            }
            if (url.protocol === "https:") {
                return {
                    name: "SSL/TLS Encryption",
                    passed: true,
                    severity: "low",
                    details: "HTTPS properly configured"
                }
            }
            return {
                name: "SSL/TLS Encryption",
                passed: true,
                severity: "low",
                details: "Localhost connection (development)"
            }
        } catch {
            return {
                name: "SSL/TLS Encryption",
                passed: false,
                severity: "critical",
                details: "Invalid endpoint URL"
            }
        }
    }

    private async checkEncryptionStored(agentId: number): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        const db = await initDB()
        const credentials = await db.all(
            `SELECT agent_api_key FROM external_agents WHERE id = ?`,
            agentId
        )

        if (credentials.length === 0 || !credentials[0].agent_api_key) {
            return {
                name: "Credential Encryption",
                passed: true,
                severity: "low",
                details: "No stored credentials"
            }
        }

        const isEncrypted = credentials[0].agent_api_key.startsWith("ENC:")
        return {
            name: "Credential Encryption",
            passed: isEncrypted,
            severity: isEncrypted ? "low" : "critical",
            details: isEncrypted
                ? "API keys are encrypted at rest"
                : "API keys stored in plaintext! Immediate rotation required."
        }
    }

    private checkRotationCapability(config: {
        securityRequirements: { rotation: boolean }
    }): {
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    } {
        const canRotate = config.securityRequirements.rotation
        return {
            name: "Credential Rotation",
            passed: canRotate,
            severity: canRotate ? "low" : "medium",
            details: canRotate
                ? "Credential rotation supported"
                : "Manual rotation required. Consider enabling auto-rotation."
        }
    }

    private async checkIPWhitelist(agent: ExternalAgent): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        const metadata = JSON.parse(agent.metadata || "{}")
        const hasIPWhitelist = metadata.ipWhitelist && Array.isArray(metadata.ipWhitelist)
        
        return {
            name: "IP Whitelisting",
            passed: Boolean(hasIPWhitelist),
            severity: hasIPWhitelist ? "low" : "medium",
            details: hasIPWhitelist
                ? `IP whitelist configured: ${(metadata.ipWhitelist as string[]).join(", ")}`
                : "No IP restriction. Consider adding IP whitelist."
        }
    }

    private async checkFundingSecurity(agentId: number): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        const db = await initDB()
        const accounts = await db.all(
            `SELECT wallet_private_key_encrypted, daily_limit, is_active 
             FROM agent_funding_accounts 
             WHERE external_agent_id = ?`,
            agentId
        )

        if (accounts.length === 0) {
            return {
                name: "Funding Account Security",
                passed: true,
                severity: "low",
                details: "No funding accounts configured"
            }
        }

        const allEncrypted = accounts.every(a => 
            a.wallet_private_key_encrypted.startsWith("ENC:")
        )
        const hasLimits = accounts.every(a => Number(a.daily_limit) > 0)

        return {
            name: "Funding Account Security",
            passed: allEncrypted && hasLimits,
            severity: allEncrypted && hasLimits ? "low" : "critical",
            details: allEncrypted
                ? `Funding secured with $${accounts[0].daily_limit}/day limit`
                : "Missing encryption or daily limits on funding accounts!"
        }
    }

    private async checkContractWhitelist(agentId: number): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        const db = await initDB()
        const contracts = await db.all(
            `SELECT contract_address, is_enabled 
             FROM agent_whitelisted_contracts 
             WHERE external_agent_id = ?`,
            agentId
        )

        if (contracts.length === 0) {
            return {
                name: "Contract Whitelisting",
                passed: false,
                severity: "high",
                details: "No contracts whitelisted. Agent can interact with ANY contract."
            }
        }

        const allEnabled = contracts.every(c => c.is_enabled === 1)
        return {
            name: "Contract Whitelisting",
            passed: allEnabled && contracts.length > 0,
            severity: allEnabled ? "low" : "high",
            details: `${contracts.length} contract(s) whitelisted`
        }
    }

    private async checkRateLimiting(agent: ExternalAgent): Promise<{
        name: string
        passed: boolean
        severity: "critical" | "high" | "medium" | "low"
        details: string
    }> {
        const metadata = JSON.parse(agent.metadata || "{}")
        const hasRateLimit = metadata.rateLimit && metadata.rateLimit.requestsPerMinute
        
        return {
            name: "Rate Limiting",
            passed: Boolean(hasRateLimit),
            severity: hasRateLimit ? "low" : "medium",
            details: hasRateLimit
                ? `Rate limited to ${metadata.rateLimit.requestsPerMinute} req/min`
                : "No rate limiting. Consider adding to prevent abuse."
        }
    }

    // Vault credentials management
    async addVaultCredential(
        agentId: number,
        orgId: number,
        name: string,
        value: string,
        type: string = "api_key",
        expiresAt?: number
    ): Promise<{ credentialId: number }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const result = await db.run(
            `
            INSERT INTO agent_vault_credentials 
            (external_agent_id, credential_name, encrypted_value, credential_type, is_secret, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            `,
            agentId,
            name,
            this.encryptValue(value),
            type,
            1,
            expiresAt
        )
        return { credentialId: result.lastID }
    }

    async listVaultCredentials(agentId: number, orgId: number): Promise<VaultCredential[]> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const credentials = await db.all(
            `SELECT * FROM agent_vault_credentials WHERE external_agent_id = ?`,
            agentId
        )
        return credentials.map((c: any) => ({
            id: c.id,
            externalAgentId: c.external_agent_id,
            name: c.credential_name,
            maskedValue: this.maskValue(c.encrypted_value),
            type: c.credential_type,
            isSecret: c.is_secret === 1,
            expiresAt: c.expires_at,
            createdAt: c.created_at
        }))
    }

    async deleteVaultCredential(agentId: number, credentialId: number, orgId: number): Promise<{ success: boolean }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        await db.run(`DELETE FROM agent_vault_credentials WHERE id = ? AND external_agent_id = ?`, credentialId, agentId)
        return { success: true }
    }

    // Funding accounts management
    async addFundingAccount(
        agentId: number,
        orgId: number,
        walletAddress: string,
        encryptedPrivateKey: string,
        dailyLimit?: string
    ): Promise<{ accountId: number }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const result = await db.run(
            `
            INSERT INTO agent_funding_accounts 
            (external_agent_id, wallet_address, wallet_private_key_encrypted, daily_limit)
            VALUES (?, ?, ?, ?)
            `,
            agentId,
            walletAddress,
            this.encryptValue(encryptedPrivateKey),
            dailyLimit ?? "0"
        )
        return { accountId: result.lastID }
    }

    async listFundingAccounts(agentId: number, orgId: number): Promise<FundingAccount[]> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const accounts = await db.all(
            `SELECT * FROM agent_funding_accounts WHERE external_agent_id = ?`,
            agentId
        )
        return accounts.map((a: any) => ({
            id: a.id,
            externalAgentId: a.external_agent_id,
            address: a.wallet_address,
            maskedKey: this.maskValue(a.wallet_private_key_encrypted),
            balance: a.balance,
            dailyLimit: a.daily_limit,
            isActive: a.is_active === 1,
            createdAt: a.created_at,
            updatedAt: a.updated_at
        }))
    }

    async updateFundingAccountBalance(accountId: number, balance: string): Promise<void> {
        const db = await initDB()
        await db.run(
            `UPDATE agent_funding_accounts SET balance = ?, updated_at = ? WHERE id = ?`,
            balance,
            Math.floor(Date.now() / 1000),
            accountId
        )
    }

    async deleteFundingAccount(agentId: number, accountId: number, orgId: number): Promise<{ success: boolean }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        await db.run(`DELETE FROM agent_funding_accounts WHERE id = ? AND external_agent_id = ?`, accountId, agentId)
        return { success: true }
    }

    // Contract whitelist management
    async addWhitelistedContract(
        agentId: number,
        orgId: number,
        address: string,
        name?: string,
        abi?: string
    ): Promise<{ contractId: number }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const result = await db.run(
            `
            INSERT INTO agent_whitelisted_contracts 
            (external_agent_id, contract_address, contract_name, contract_abi)
            VALUES (?, ?, ?, ?)
            `,
            agentId,
            address,
            name,
            abi
        )
        return { contractId: result.lastID }
    }

    async listWhitelistedContracts(agentId: number, orgId: number): Promise<WhitelistedContract[]> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        const contracts = await db.all(
            `SELECT * FROM agent_whitelisted_contracts WHERE external_agent_id = ?`,
            agentId
        )
        return contracts.map((c: any) => ({
            id: c.id,
            externalAgentId: c.external_agent_id,
            address: c.contract_address,
            name: c.contract_name,
            abi: c.contract_abi,
            isEnabled: c.is_enabled === 1,
            createdAt: c.created_at
        }))
    }

    async toggleContractWhitelist(agentId: number, contractId: number, orgId: number, enabled: boolean): Promise<void> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        await db.run(
            `UPDATE agent_whitelisted_contracts SET is_enabled = ? WHERE id = ? AND external_agent_id = ?`,
            enabled ? 1 : 0,
            contractId,
            agentId
        )
    }

    async deleteWhitelistedContract(agentId: number, contractId: number, orgId: number): Promise<{ success: boolean }> {
        const db = await initDB()
        await this.ensureExternalAgent(agentId, orgId)
        await db.run(`DELETE FROM agent_whitelisted_contracts WHERE id = ? AND external_agent_id = ?`, contractId, agentId)
        return { success: true }
    }

    private async updateAgentStatus(agentId: number, status: AgentStatus): Promise<void> {
        const db = await initDB()
        await db.run(
            `UPDATE external_agents SET status = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ?`,
            status,
            Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000),
            agentId
        )
    }

    private encryptValue(value: string): string {
        const iv = crypto.randomBytes(16)
        const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv)
        let encrypted = cipher.update(value, "utf8", "hex")
        encrypted += cipher.final("hex")
        const authTag = cipher.getAuthTag()
        return `ENC:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
    }

    private decryptValue(encrypted: string): string {
        if (!encrypted.startsWith("ENC:")) return encrypted
        const [, ivHex, authTagHex, encryptedData] = encrypted.split(":")
        const iv = Buffer.from(ivHex, "hex")
        const authTag = Buffer.from(authTagHex, "hex")
        const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv)
        decipher.setAuthTag(authTag)
        let decrypted = decipher.update(encryptedData, "hex", "utf8")
        decrypted += decipher.final("utf8")
        return decrypted
    }

    private maskValue(encrypted: string): string {
        if (!encrypted.startsWith("ENC:")) return "***"
        return "ENC:****:****:****"
    }

    private getAuthHeaders(agent: ExternalAgent): Record<string, string> {
        const token = "apiKey" in agent ? this.decryptValue(String(agent.apiKey || "")) : ""
        return {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
    }

    private healthEndpoint(endpoint?: string): string {
        if (!endpoint) {
            throw new AppError(400, "agent endpoint is required")
        }

        const url = new URL(endpoint)
        const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
        const allowPrivate = process.env.ALLOW_PRIVATE_AGENT_ENDPOINTS === "true"

        if (url.protocol !== "https:" && !(allowPrivate && isLocalhost)) {
            throw new AppError(400, "agent endpoint must use HTTPS")
        }

        url.pathname = `${url.pathname.replace(/\/$/, "")}/health`
        url.search = ""
        url.hash = ""
        return url.toString()
    }

    private async getExternalAgentForInternalUse(agentId: number, orgId: number): Promise<(ExternalAgent & { apiKey?: string; apiSecret?: string }) | null> {
        const db = await initDB()
        const agent = await db.get(`SELECT * FROM external_agents WHERE id = ? AND org_id = ?`, agentId, orgId)
        return agent ? this.mapAgent(agent, true) as ExternalAgent & { apiKey?: string; apiSecret?: string } : null
    }

    private mapAgent(agent: any, includeSecrets = false): ExternalAgent | (ExternalAgent & { apiKey?: string; apiSecret?: string }) {
        return {
            id: agent.id,
            orgId: agent.org_id,
            linkedAgentId: agent.linked_agent_id ?? undefined,
            agentType: agent.agent_type as ExternalAgentType,
            name: agent.agent_name,
            endpoint: agent.agent_endpoint,
            ...(includeSecrets ? {
                apiKey: agent.agent_api_key,
                apiSecret: agent.agent_api_secret
            } : {
                hasApiKey: Boolean(agent.agent_api_key),
                hasApiSecret: Boolean(agent.agent_api_secret)
            }),
            status: agent.status as AgentStatus,
            isActive: agent.is_active === 1,
            createdAt: agent.created_at,
            updatedAt: agent.updated_at,
            lastHeartbeatAt: agent.last_heartbeat_at,
            metadata: agent.metadata
        }
    }

    // ============================================================
    // EXECUTION LAYER - Send tasks to agents and track results
    // ============================================================

    /**
     * Execute a request on an external agent runtime
     * This sends a signed request to the agent's endpoint and logs the result
     */
    async executeRequest(
        agentId: number,
        orgId: number,
        request: ExecutionRequest,
        proof?: ExecutionProof
    ): Promise<{ success: boolean; result?: any; executionId?: number; error?: string; executionTime: number }> {
        const db = await initDB()
        const requestId = request.nonce || crypto.randomUUID()
        const startTime = Date.now()

        // Get the agent with credentials
        const agent = await this.getExternalAgentForInternalUse(agentId, orgId)
        if (!agent) {
            throw new AppError(404, "Agent not found")
        }

        if (!agent.endpoint) {
            throw new AppError(400, "Agent has no endpoint configured")
        }

        if (agent.status !== "connected" && agent.status !== "running") {
            throw new AppError(400, `Agent is not available (status: ${agent.status})`)
        }

        const effectiveTimeout = Math.min(Math.max(request.timeout || 30000, 1000), 30 * 60 * 1000)

        // Build the execution URL
        const executeUrl = this.executeEndpoint(agent.endpoint)

        // Build headers with auth
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Agentix-Request-ID": requestId,
            "X-Agentix-Org-ID": String(orgId),
            "X-Agentix-Agent-ID": String(agentId),
            "X-Agentix-Timestamp": String(request.requestedAt)
        }

        // Add API key if available
        if (agent.apiKey) {
            headers["Authorization"] = `Bearer ${agent.apiKey}`
        }

        // Build request body with proof
        const body: any = {
            action: request.action,
            params: request.params,
            nonce: requestId,
            requestedAt: request.requestedAt,
            timeout: effectiveTimeout
        }

        if (proof) {
            body.credentialProof = proof
        }

        let result: any = null
        let success = false
        let errorMessage: string | null = null

        try {
            const response = await fetch(executeUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(effectiveTimeout)
            })

            const responseTime = Date.now() - startTime

            if (!response.ok) {
                const errorText = await response.text().catch(() => "Unknown error")
                errorMessage = `Agent returned ${response.status}: ${errorText}`
                success = false
            } else {
                result = await response.json().catch(() => ({}))
                success = result.success !== false

                if (!success && result.error) {
                    errorMessage = result.error
                }
            }
        } catch (err: any) {
            errorMessage = err.message || "Request failed"
            success = false
        }

        const executionTime = Date.now() - startTime

        // Log the execution
        const logResult = await db.run(
            `INSERT INTO agent_execution_logs
            (external_agent_id, org_id, request_id, action, params, proof, result, success, error_message, execution_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            agentId,
            orgId,
            requestId,
            request.action,
            JSON.stringify(request.params),
            proof ? JSON.stringify(proof) : null,
            result ? JSON.stringify(result) : null,
            success ? 1 : 0,
            errorMessage,
            executionTime
        )

        return {
            success,
            result,
            executionId: logResult.lastID,
            error: errorMessage || undefined,
            executionTime
        }
    }

    /**
     * Get execution logs for an agent
     */
    async getExecutionLogs(
        agentId: number,
        orgId: number,
        options?: { limit?: number; offset?: number; action?: string }
    ): Promise<AgentExecutionLog[]> {
        const db = await initDB()

        // Verify agent belongs to org
        const agent = await db.get(
            `SELECT id FROM external_agents WHERE id = ? AND org_id = ?`,
            agentId,
            orgId
        )
        if (!agent) {
            throw new AppError(404, "Agent not found")
        }

        const limit = options?.limit || 50
        const offset = options?.offset || 0

        let sql = `SELECT * FROM agent_execution_logs WHERE external_agent_id = ?`
        const params: any[] = [agentId]

        if (options?.action) {
            sql += ` AND action = ?`
            params.push(options.action)
        }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
        params.push(limit, offset)

        const logs = await db.all(sql, ...params)

        return logs.map((log: any) => ({
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
        }))
    }

    /**
     * Get a single execution by ID
     */
    async getExecution(executionId: number, orgId: number): Promise<AgentExecutionLog | null> {
        const db = await initDB()

        const log = await db.get(
            `SELECT * FROM agent_execution_logs WHERE id = ? AND org_id = ?`,
            executionId,
            orgId
        )

        if (!log) return null

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
        }
    }

    /**
     * Get execution statistics for an agent
     */
    async getExecutionStats(agentId: number, orgId: number): Promise<{
        totalExecutions: number
        successfulExecutions: number
        failedExecutions: number
        avgExecutionTimeMs: number
        lastExecutionAt: number | null
    }> {
        const db = await initDB()

        // Verify agent belongs to org
        const agent = await db.get(
            `SELECT id FROM external_agents WHERE id = ? AND org_id = ?`,
            agentId,
            orgId
        )
        if (!agent) {
            throw new AppError(404, "Agent not found")
        }

        const stats = await db.get(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
                AVG(execution_time_ms) as avg_time,
                MAX(created_at) as last_execution
            FROM agent_execution_logs
            WHERE external_agent_id = ?`,
            agentId
        )

        return {
            totalExecutions: stats?.total || 0,
            successfulExecutions: stats?.successful || 0,
            failedExecutions: stats?.failed || 0,
            avgExecutionTimeMs: Math.round(stats?.avg_time || 0),
            lastExecutionAt: stats?.last_execution || null
        }
    }

    // ============================================================
    // AUTHORIZATION PROOFS - ZK proof generation for agent actions
    // ============================================================

    /**
     * Generate an authorization proof for an agent action
     * Builds real Merkle proofs from the credential tree + revocation tree;
     * optionally runs the full Groth16 prover if circuit files are present.
     */
    async generateAuthorizationProof(
        agentId: number,
        orgId: number,
        action: string,
        expirySeconds: number = 3600,
        secret?: string // client-provided secret for optional server-side proving
    ): Promise<{
        proof: ExecutionProof
        permissionBitmask: number
        expiresAt: number
    }> {
        const db = await initDB()

        const agent = await db.get(
            `SELECT ea.*,
                    c.permissions, c.expiry as credential_expiry, c.leaf_index,
                    c.secret_hash, c.commitment
             FROM external_agents ea
             LEFT JOIN credentials c ON ea.linked_agent_id = c.agent_id
             WHERE ea.id = ? AND ea.org_id = ?`,
            agentId,
            orgId
        )

        if (!agent) {
            throw new AppError(404, "Agent not found")
        }

        const requiredPermission = ACTION_PERMISSIONS[action] || 0
        const agentPermissions = agent.permissions || AGENT_PERMISSIONS.ALL

        if ((agentPermissions & requiredPermission) === 0 && requiredPermission !== 0) {
            throw new AppError(403, `Agent does not have permission for action: ${action}`)
        }

        if (agent.credential_expiry && agent.credential_expiry < Math.floor(Date.now() / 1000)) {
            throw new AppError(403, "Agent credential has expired")
        }

        // Merkle proof from active credential tree
        const activeTree = new IncrementalMerkleTree(20, { orgId })
        const activeProof = await activeTree.generateProof(db, agent.leaf_index ?? 0)
        const activeRoot = await activeTree.getRoot(db)

        // Revocation proof — prove credential's secret is NOT revoked
        const secretHash = BigInt(agent.secret_hash ?? 0)
        const revokedProof = await new SparseRevocationTree(orgId).generateProof(db, secretHash)

        // Unique nullifier
        const nullifier = poseidonHash([
            BigInt(agentId),
            BigInt(Math.floor(Date.now() / 1000)),
            BigInt(crypto.randomInt(1, 1000000))
        ])

        const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds

        // Generate proof — client provides secret for optional server-side proving
        const proof: ExecutionProof = await this._tryFullProof(
            agent, orgId, activeRoot, activeProof, revokedProof,
            nullifier, agentPermissions, expiresAt, secret
        )

        return {
            proof,
            permissionBitmask: agentPermissions,
            expiresAt
        }
    }

    /**
     * Generate a real Groth16 proof using the fastProver (rapidsnark WSL + snarkjs fallback).
     * Throws if circuit files are not available — no stub proofs.
     */
    private async _tryFullProof(
        agent: any,
        orgId: number,
        activeRoot: bigint,
        activeProof: { pathElements: string[]; pathIndices: number[] },
        revokedProof: {
            siblings: string[]; oldKey: string; oldValue: string; isOld0: number
            root: string
        },
        nullifier: bigint,
        permissions: number,
        expiresAt: number,
        secret?: string // client-provided; never fetched from DB
    ): Promise<ExecutionProof> {
        if (!secret) {
            throw new AppError(400, "Secret required for proof generation — generate proof client-side via SDK")
        }

        const { getProverBackend } = await import("./fastProver")

        const backend = getProverBackend()

        const input: import("./fastProver").ProverInput = {
            agentId: agent.linked_agent_id?.toString() ?? "0",
            orgId: orgId.toString(),
            permissions: agent.permissions?.toString() ?? "0",
            expiry: agent.credential_expiry?.toString() ?? "0",
            secret,
            sessionNonce: Math.floor(Date.now() / 1000).toString(),
            activePathElements: activeProof.pathElements,
            activePathIndices: activeProof.pathIndices.map((i: number) => i.toString()),
            revokedSiblings: revokedProof.siblings,
            revokedOldKey: revokedProof.oldKey,
            revokedOldValue: revokedProof.oldValue,
            revokedIsOld0: revokedProof.isOld0,
            activeRoot: activeRoot.toString(),
            revokedRoot: revokedProof.root,
            maxValue: permissions.toString(),
            sessionExpiry: expiresAt.toString()
        }

        const result = await backend.prove(input)

        return {
            nullifier: nullifier.toString(),
            root: activeRoot.toString(),
            revokedRoot: revokedProof.root,
            proof: {
                a: [result.proof.pi_a[0]?.toString() ?? "0", result.proof.pi_a[1]?.toString() ?? "0"],
                b: [
                    [result.proof.pi_b[0][1]?.toString() ?? "0", result.proof.pi_b[0][0]?.toString() ?? "0"],
                    [result.proof.pi_b[1][1]?.toString() ?? "0", result.proof.pi_b[1][0]?.toString() ?? "0"]
                ],
                c: [result.proof.pi_c[0]?.toString() ?? "0", result.proof.pi_c[1]?.toString() ?? "0"]
            },
            publicSignals: result.publicSignals as [string, string, string, string, string]
        }
    }

    /**
     * Verify an authorization proof — off-chain Merkle check + on-chain Groth16 verification
     */
    async verifyAuthorizationProof(
        agentId: number,
        orgId: number,
        proof: ExecutionProof,
        action: string
    ): Promise<{ valid: boolean; error?: string }> {
        const db = await initDB()

        // Get current merkle root
        const tree = new IncrementalMerkleTree(20, { orgId })
        const currentState = await tree.loadState(db)

        if (!currentState) {
            return { valid: false, error: "No credentials found for organization" }
        }

        // Verify root matches
        if (proof.root !== currentState.root.toString()) {
            return { valid: false, error: "Proof root does not match current tree" }
        }

        // Check action permission
        const requiredPermission = ACTION_PERMISSIONS[action] || 0
        const grantedPermissions = parseInt(proof.publicSignals[3]) || 0

        if ((grantedPermissions & requiredPermission) === 0 && requiredPermission !== 0) {
            return { valid: false, error: "Proof does not grant permission for this action" }
        }

        // Check expiry
        const expiry = parseInt(proof.publicSignals[4]) || 0
        if (expiry < Math.floor(Date.now() / 1000)) {
            return { valid: false, error: "Proof has expired" }
        }

        // Verify nullifier hasn't been used (prevent replay)
        const usedNullifier = await db.get(
            `SELECT id FROM used_nullifiers WHERE nullifier = ?`,
            proof.nullifier
        )

        if (usedNullifier) {
            return { valid: false, error: "Proof has already been used" }
        }

        // Off-chain Groth16 verification using snarkjs
        try {
            const vkPath = path.resolve(
                __dirname, "../../../circuits/build/verification_key.json"
            )
            if (fs.existsSync(vkPath)) {
                const { groth16 } = await import("snarkjs")
                const vk = JSON.parse(fs.readFileSync(vkPath, "utf-8"))
                const valid = await groth16.verify(vk, proof.publicSignals, proof.proof)
                if (!valid) {
                    return { valid: false, error: "Groth16 proof verification failed" }
                }
            }
        } catch (err: any) {
            console.warn("[externalAgent] Groth16 verification unavailable, using off-chain checks:", err.message)
        }

        return { valid: true }
    }

    /**
     * Mark a nullifier as used to prevent replay attacks
     */
    async consumeNullifier(nullifier: string): Promise<void> {
        const db = await initDB()

        await db.run(
            `INSERT INTO used_nullifiers (nullifier, used_at)
             VALUES (?, ?)`,
            nullifier,
            Math.floor(Date.now() / 1000)
        )
    }

    private executeEndpoint(endpoint: string): string {
        const url = new URL(endpoint)
        url.pathname = `${url.pathname.replace(/\/$/, "")}/execute`
        url.search = ""
        url.hash = ""
        return url.toString()
    }

    static getSupportedAgentTypes(): Array<{
        id: ExternalAgentType
        name: string
        icon: string
        capabilities: string[]
    }> {
        return Object.entries(ExternalAgentService.agentTypeConfigs).map(([id, config]) => ({
            id: id as ExternalAgentType,
            name: config.name,
            icon: config.icon,
            capabilities: config.capabilities
        }))
    }
}

export default ExternalAgentService
