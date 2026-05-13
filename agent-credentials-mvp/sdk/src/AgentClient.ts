import axios from "axios"
// FLAW 2 FIX: Browser-compatible SDK
// Use conditional imports for Node.js-specific modules
import { buildPoseidon } from "circomlibjs"
import { Wallet } from "ethers"
import { AgentRegistrationInput, AgentRegistrationResponse, CredentialInput, WalletResponse } from "./types"
import { SessionManager } from "./SessionManager"

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

    constructor(api: string) {
        this.api = api
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

        return commitment
    }

    async registerAgent(input: AgentRegistrationInput): Promise<AgentRegistrationResponse> {
        const provision = await axios.post(`${this.api}/v1/agents/provision`, {
            orgId: input.orgId,
            orgName: input.orgName,
            agentName: input.agentName
        })

        const payload = provision.data as AgentRegistrationResponse
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

        const manager = this.sessionManager()
        const proofBundle = await manager.fetchMerkleProof(input.agentId)
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
        const session = await manager.submitSession(
            input.agentId,
            zk,
            sessionWallet.address
        )

        return {
            session,
            sessionKey: sessionWallet.address,
            sessionPrivateKey: "privateKey" in sessionWallet ? sessionWallet.privateKey : undefined,
            publicSignals: zk.publicSignals
        }
    }

    sessionManager() {
        return new SessionManager(
            this.api,
            this.secret
        )
    }
}
