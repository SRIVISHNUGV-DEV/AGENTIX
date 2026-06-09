import axios from "axios"
// FLAW 2 FIX: Browser-compatible SDK
// Use conditional imports for Node.js-specific modules
import { buildPoseidon } from "circomlibjs"
import { Wallet } from "ethers"
import { AgentRegistrationInput, AgentRegistrationResponse, CredentialInput, WalletResponse } from "./types"
import { SessionManager } from "./SessionManager"
import { AuditClient } from "./AuditClient"

// Check if running in browser or Node.js
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined"

// FLAW 12 FIX: SDK backend URL configuration
// Default URL can be overridden via constructor or environment variable
const DEFAULT_BACKEND_URL = isBrowser
    ? (typeof process !== "undefined" && process.env?.AGENTIX_BACKEND_URL) || "http://127.0.0.1:3001"
    : process.env.AGENTIX_BACKEND_URL || "http://127.0.0.1:3001"

// Browser-compatible random bytes using Web Crypto API
async function getRandomBytes(length: number): Promise<Uint8Array> {
    if (isBrowser && window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(length)
        window.crypto.getRandomValues(bytes)
        return bytes
    }
    // Node.js fallback
    const { randomBytes } = await import("crypto")
    return new Uint8Array(randomBytes(length))
}

export class AgentClient {

    api: string
    secret: bigint
    poseidon: any
    audit: AuditClient

    constructor(api: string) {
        this.api = api
        this.audit = new AuditClient(api)
    }

    async init() {
        this.poseidon = await buildPoseidon()

        // FLAW 2 FIX: Use browser-compatible random bytes
        const randomBytes = await getRandomBytes(31)
        this.secret = BigInt(
            "0x" + Array.from(randomBytes)
                .map(b => b.toString(16).padStart(2, "0"))
                .join("")
        )

        this.audit.log({
            action: "agent.init",
            resourceType: "agent",
            details: { entropyBytes: 31 },
        })
    }

    getSecret() {
        return this.secret
    }

    computeCommitment(input: CredentialInput) {
        const commitment = this.poseidon([
            BigInt(input.agentId),
            BigInt(input.orgId),
            BigInt(input.permissions),
            BigInt(input.expiry),
            this.secret
        ])

        return BigInt(this.poseidon.F.toString(commitment))
    }

    computeSecretHash() {
        const secretHash = this.poseidon([
            this.secret,
            0n
        ])

        return BigInt(this.poseidon.F.toString(secretHash))
    }

    async registerCredential(input: CredentialInput) {
        const commitment = this.computeCommitment(input)

        await axios.post(`${this.api}/credentials`, {
            agentId: input.agentId,
            orgId: input.orgId,
            permissions: input.permissions,
            expiry: input.expiry,
            commitment: commitment.toString(),
            secretHash: this.computeSecretHash().toString()
        })

        this.audit.setContext(input.orgId, input.agentId)
        this.audit.log({
            action: "credential.register",
            resourceType: "credential",
            resourceId: commitment.toString(),
            agentId: input.agentId,
            orgId: input.orgId,
            details: { permissions: input.permissions, expiry: input.expiry },
        })
        this.audit.flush()

        return commitment
    }

    async registerAgent(input: AgentRegistrationInput): Promise<AgentRegistrationResponse> {
        const provision = await axios.post(`${this.api}/v1/agents/provision`, {
            orgId: input.orgId,
            orgName: input.orgName,
            agentName: input.agentName
        })

        const payload = provision.data as AgentRegistrationResponse
        this.audit.setContext(payload.orgId, payload.agentId)

        const commitment = this.computeCommitment({
            agentId: payload.agentId,
            orgId: payload.orgId,
            permissions: input.permissions,
            expiry: input.expiry
        })

        await axios.post(`${this.api}/credentials`, {
            agentId: payload.agentId,
            orgId: payload.orgId,
            permissions: input.permissions,
            expiry: input.expiry,
            commitment: commitment.toString(),
            secretHash: this.computeSecretHash().toString()
        })

        this.audit.log({
            action: "agent.register",
            resourceType: "agent",
            resourceId: String(payload.agentId),
            agentId: payload.agentId,
            orgId: payload.orgId,
            details: { agentName: input.agentName, orgName: input.orgName },
        })
        this.audit.flush()

        return payload
    }

    async createWallet(options?: {
        ownerAddress?: string
        agentId?: number
    }): Promise<WalletResponse & { ownerPrivateKey?: string }> {
        let owner = options?.ownerAddress
        let ownerPrivateKey: string | undefined

        if (!owner) {
            // FLAW 2 FIX: Use ethers browser-compatible wallet creation
            // Note: In production, recommend wallet extension (MetaMask) integration
            const wallet = Wallet.createRandom()
            owner = wallet.address
            ownerPrivateKey = wallet.privateKey
        }

        const res = await axios.post(`${this.api}/wallets`, {
            ownerAddress: owner,
            agentId: options?.agentId
        })

        this.audit.log({
            action: "wallet.create",
            resourceType: "wallet",
            resourceId: res.data?.walletAddress,
            agentId: options?.agentId,
            details: { ownerAddress: owner },
        })
        this.audit.flush()

        return {
            ...res.data,
            ownerPrivateKey
        }
    }

    async revokeAgent(agentId: number) {
        const res = await axios.post(`${this.api}/credentials/revoke`, {
            agentId,
            secretHash: this.computeSecretHash().toString()
        })

        this.audit.log({
            action: "credential.revoke",
            resourceType: "credential",
            agentId,
            resourceId: String(agentId),
        })
        this.audit.flush()

        return res.data
    }

    async getAgentState(agentId: number) {
        const res = await axios.get(`${this.api}/v1/agents/${agentId}/state`)
        return res.data
    }

    async getEvents(params?: {
        contractName?: string
        sessionId?: string
        walletAddress?: string
        limit?: number
    }) {
        const res = await axios.get(`${this.api}/events`, {
            params
        })

        return res.data
    }

    async syncEvents() {
        const res = await axios.post(`${this.api}/events/sync`)
        return res.data
    }

    async queryAuditLogs(params?: {
        orgId?: number
        action?: string
        userId?: number
        resourceType?: string
        limit?: number
        offset?: number
        search?: string
    }): Promise<any> {
        const res = await axios.get(`${this.api}/audit`, { params })
        return res.data
    }

    async getAuditStats(orgId?: number): Promise<any> {
        const res = await axios.get(`${this.api}/audit/stats`, { params: { orgId } })
        return res.data
    }

    async fetchCircuitConfig(): Promise<import("./types").CircuitConfig> {
        const res = await axios.get(`${this.api}/circuit/config`)
        return res.data
    }

    async generateProofRemote(
        agentId: number,
        orgId: number,
        action: string,
        expirySeconds?: number
    ): Promise<import("./types").RemoteProofResponse> {
        this.audit.setContext(orgId, agentId)
        const res = await axios.post(`${this.api}/external/agents/${agentId}/proof`, {
            orgId,
            action,
            expirySeconds: expirySeconds ?? 3600,
            secret: this.secret.toString()
        })

        this.audit.log({
            action: "proof.generate.remote",
            resourceType: "proof",
            agentId,
            orgId,
            details: { action, expirySeconds: expirySeconds ?? 3600 },
        })
        this.audit.flush()

        return res.data
    }

    async verifyProof(proof: {
        proof: { a: string[]; b: string[][]; c: string[] }
        publicSignals: string[]
    }): Promise<boolean> {
        const config = await this.fetchCircuitConfig()
        if (!config.verificationKey) {
            throw new Error("Verification key not available from backend")
        }
        const { groth16 } = await import("snarkjs")
        const result = await groth16.verify(config.verificationKey, proof.publicSignals, proof.proof)

        this.audit.log({
            action: "proof.verify.local",
            resourceType: "proof",
            details: { valid: result, publicSignals: proof.publicSignals[0]?.slice(0, 16) },
        })
        this.audit.flush()

        return result
    }

    async createSession(input: {
        agentId: number
        orgId?: number
        permissions?: number
        expiry?: number
        sessionKey?: string
    }) {
        const state = (
            input.orgId === undefined ||
            input.permissions === undefined ||
            input.expiry === undefined
        )
            ? await this.getAgentState(input.agentId)
            : null

        const orgId = input.orgId ?? Number(state?.agent?.org_id)
        const permissions = input.permissions ?? Number(state?.credential?.permissions)
        const expiry = input.expiry ?? Number(state?.credential?.expiry)

        this.audit.setContext(orgId, input.agentId)

        const manager = this.sessionManager()
        const proofBundle = await manager.fetchMerkleProof(input.agentId)
        this.audit.log({ action: "proof.fetch.merkle", resourceType: "merkle-proof", agentId: input.agentId, orgId })
        const sessionWallet = input.sessionKey
            ? { address: input.sessionKey }
            : manager.createSessionWallet()
        const zk = await manager.generateProof(
            input.agentId,
            orgId,
            permissions,
            expiry,
            Date.now(),
            proofBundle
        )
        this.audit.log({ action: "proof.generate.local", resourceType: "proof", agentId: input.agentId, orgId, details: { permissions, expiry } })
        const session = await manager.submitSession(
            input.agentId,
            zk,
            sessionWallet.address
        )

        this.audit.log({
            action: "session.create.local",
            resourceType: "session",
            resourceId: session?.sessionId,
            agentId: input.agentId,
            orgId,
            details: { sessionKey: sessionWallet.address.slice(0, 10) },
        })
        this.audit.flush()

        return {
            session,
            sessionKey: sessionWallet.address,
            sessionPrivateKey: "privateKey" in sessionWallet ? sessionWallet.privateKey : undefined,
            publicSignals: zk.publicSignals
        }
    }

    async createSessionRemote(input: {
        agentId: number
        orgId?: number
        action?: string
        sessionKey?: string
    }) {
        const state = input.orgId === undefined
            ? await this.getAgentState(input.agentId)
            : null
        const orgId = input.orgId ?? Number(state?.agent?.org_id)

        this.audit.setContext(orgId, input.agentId)

        const manager = this.sessionManager()
        const proofBundle = await manager.fetchMerkleProof(input.agentId)
        this.audit.log({ action: "proof.fetch.merkle", resourceType: "merkle-proof", agentId: input.agentId, orgId })
        const sessionWallet = input.sessionKey
            ? { address: input.sessionKey }
            : manager.createSessionWallet()

        const remote = await this.generateProofRemote(
            input.agentId,
            orgId,
            input.action ?? "create_session",
            604800
        )

        const zk = {
            proof: remote.proof.proof,
            publicSignals: remote.proof.publicSignals,
        }
        const session = await manager.submitSession(
            input.agentId,
            zk,
            sessionWallet.address
        )

        this.audit.log({
            action: "session.create.remote",
            resourceType: "session",
            resourceId: session?.sessionId,
            agentId: input.agentId,
            orgId,
            details: { sessionKey: sessionWallet.address.slice(0, 10) },
        })
        this.audit.flush()

        return {
            session,
            sessionKey: sessionWallet.address,
            sessionPrivateKey: "privateKey" in sessionWallet ? sessionWallet.privateKey : undefined,
            publicSignals: remote.proof.publicSignals
        }
    }

    sessionManager() {
        return new SessionManager(
            this.api,
            this.secret
        )
    }
}
