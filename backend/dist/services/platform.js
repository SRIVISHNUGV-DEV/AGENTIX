"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ethers_1 = require("ethers");
const snarkjs_1 = require("snarkjs");
const crypto_2 = require("../utils/crypto");
const merkle_1 = require("./merkle");
const revocationTree_1 = require("./revocationTree");
const blockchain_1 = require("./blockchain");
const CIRCUIT_WASM_PATH = path_1.default.resolve(__dirname, "../../../circuits/build/credential_js/credential.wasm");
// FLAW 4 FIX: Lazy circuit resolution handled in prover.ts
// This file re-exports for compatibility
const CIRCUIT_ZKEY_PATH = resolveZkeyPath();
function resolveZkeyPath() {
    const buildDir = path_1.default.resolve(__dirname, "../../../circuits/build");
    if (!fs_1.default.existsSync(buildDir)) {
        return null;
    }
    const zkey = fs_1.default.readdirSync(buildDir).find((file) => file.endsWith(".zkey"));
    if (!zkey) {
        return null;
    }
    return path_1.default.join(buildDir, zkey);
}
class PlatformService {
    blockchain;
    constructor() {
        // FLAW 10 FIX: Use singleton blockchain service
        this.blockchain = (0, blockchain_1.getBlockchainService)();
    }
    normalizeScalars(value) {
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (typeof value === "number") {
            return Math.trunc(value).toString();
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeScalars(item));
        }
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.normalizeScalars(item)]));
        }
        return value;
    }
    /**
     * @deprecated FLAW 1 FIX: Secrets should be generated client-side.
     * The backend should NEVER have access to the raw secret.
     * Use frontend/lib/credential-client.ts to generate secrets on the client.
     * This method is kept only for backward compatibility during migration.
     */
    createManagedSecret() {
        console.warn("[DEPRECATED] createManagedSecret: Secrets should be generated client-side");
        return BigInt(`0x${crypto_1.default.randomBytes(31).toString("hex")}`);
    }
    async getAgentWithSecret(db, agentId) {
        const agent = await db.get(`
            SELECT *
            FROM agents
            WHERE id = ?
            `, agentId);
        if (!agent) {
            throw new Error("agent not found");
        }
        if (!agent.managed_secret) {
            const secret = this.createManagedSecret().toString();
            await db.run(`
                UPDATE agents
                SET managed_secret = ?
                WHERE id = ?
                `, secret, agentId);
            agent.managed_secret = secret;
        }
        return {
            ...agent,
            managedSecret: BigInt(agent.managed_secret)
        };
    }
    computeCommitment(agentId, orgId, permissions, expiry, secret) {
        return (0, crypto_2.poseidonHash)([
            BigInt(agentId),
            BigInt(orgId),
            BigInt(permissions),
            BigInt(expiry),
            secret
        ]);
    }
    computeSecretHash(secret) {
        return (0, crypto_2.poseidonHash)([secret, 0n]);
    }
    async issueCredential(db, agentId, permissions, expiry) {
        const agent = await this.getAgentWithSecret(db, agentId);
        const existing = await db.get(`
            SELECT *
            FROM credentials
            WHERE agent_id = ?
            `, agentId);
        if (existing) {
            throw new Error("credential already exists for agent");
        }
        const commitment = this.computeCommitment(agentId, agent.org_id, permissions, expiry, agent.managedSecret);
        const secretHash = this.computeSecretHash(agent.managedSecret);
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId: agent.org_id });
        const leafIndex = await tree.getNextLeafIndex(db);
        await db.run(`
            INSERT INTO credentials
            (agent_id,org_id,permissions,expiry,commitment,secret_hash,leaf_index)
            VALUES (?,?,?,?,?,?,?)
            `, agentId, agent.org_id, permissions, expiry, commitment.toString(), secretHash.toString(), leafIndex);
        await tree.insert(db, commitment, leafIndex);
        await tree.rebuildFromCredentials(db);
        const root = await tree.getRoot(db);
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`;
        const chain = await this.blockchain.updateActiveRootForOrg(db, agent.org_id, rootHex);
        return {
            success: true,
            agentId,
            orgId: agent.org_id,
            rootHex,
            chain
        };
    }
    async createWallet(db, agentId, ownerAddress) {
        const agent = await this.getAgentWithSecret(db, agentId);
        const ownerWallet = ownerAddress ? null : ethers_1.Wallet.createRandom();
        const owner = ownerAddress ?? ownerWallet.address;
        const wallet = await this.blockchain.createWalletForOrg(db, agent.org_id, owner);
        await db.run(`
            INSERT INTO wallets
            (
                agent_id,
                org_id,
                owner_address,
                wallet_address,
                session_manager_address,
                implementation_address,
                entry_point_address,
                factory_salt,
                wallet_kind
            )
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                agent_id = COALESCE(wallets.agent_id, excluded.agent_id),
                org_id = COALESCE(wallets.org_id, excluded.org_id),
                owner_address = excluded.owner_address,
                session_manager_address = excluded.session_manager_address,
                implementation_address = COALESCE(excluded.implementation_address, wallets.implementation_address),
                entry_point_address = COALESCE(excluded.entry_point_address, wallets.entry_point_address),
                factory_salt = COALESCE(excluded.factory_salt, wallets.factory_salt),
                wallet_kind = COALESCE(excluded.wallet_kind, wallets.wallet_kind)
            `, agentId, agent.org_id, owner, wallet.walletAddress, wallet.sessionManagerAddress, wallet.implementationAddress ?? null, wallet.entryPointAddress ?? null, wallet.factorySalt ?? null, wallet.walletKind ?? "erc4337");
        return {
            success: true,
            ...wallet
        };
    }
    async revokeCredential(db, agentId) {
        const agent = await this.getAgentWithSecret(db, agentId);
        const secretHash = this.computeSecretHash(agent.managedSecret);
        const revocationTree = new revocationTree_1.SparseRevocationTree(agent.org_id);
        const existing = await db.get(`
            SELECT id
            FROM revoked_secrets
            WHERE org_id = ? AND secret_hash = ?
            `, agent.org_id, secretHash.toString());
        if (existing) {
            throw new Error("secret already revoked");
        }
        const smtKey = (0, revocationTree_1.toRevocationKey)(secretHash).toString();
        const leafIndex = (await db.get(`
                SELECT COALESCE(MAX(leaf_index), -1) + 1 as c
                FROM revoked_secrets
                WHERE org_id = ?
                `, agent.org_id)).c;
        await db.run(`
            INSERT INTO revoked_secrets
            (agent_id,org_id,secret_hash,smt_key,revoked_value,leaf_index)
            VALUES (?,?,?,?,?,?)
            `, agentId, agent.org_id, secretHash.toString(), smtKey, 1, leafIndex);
        const root = await revocationTree.getRoot(db);
        const rootHex = `0x${root.toString(16).padStart(64, "0")}`;
        const chain = await this.blockchain.updateRevokedRootForOrg(db, agent.org_id, rootHex);
        return {
            success: true,
            agentId,
            orgId: agent.org_id,
            rootHex,
            chain
        };
    }
    async createSession(db, agentId, overrides) {
        const agent = await this.getAgentWithSecret(db, agentId);
        const credential = await db.get(`
            SELECT *
            FROM credentials
            WHERE agent_id = ?
            `, agentId);
        if (!credential) {
            throw new Error("credential not found");
        }
        const tree = new merkle_1.IncrementalMerkleTree(20, { orgId: agent.org_id });
        await tree.rebuildFromCredentials(db);
        const activeProof = await tree.generateProof(db, credential.leaf_index);
        const activeRoot = await tree.getRoot(db);
        const revokedProof = await new revocationTree_1.SparseRevocationTree(agent.org_id).generateProof(db, BigInt(credential.secret_hash));
        const sessionWallet = ethers_1.Wallet.createRandom();
        const sessionId = `0x${crypto_1.default
            .createHash("sha256")
            .update(`${agentId}:${sessionWallet.address}:${Date.now()}`)
            .digest("hex")}`;
        const maxValue = overrides?.maxValue ?? Number(credential.permissions);
        const expiry = overrides?.expiry ?? Math.min(Number(credential.expiry), Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
        const sessionNonce = Date.now();
        const input = {
            agentId: agentId.toString(),
            orgId: agent.org_id.toString(),
            permissions: credential.permissions.toString(),
            expiry: credential.expiry.toString(),
            secret: agent.managedSecret.toString(),
            sessionNonce: sessionNonce.toString(),
            activePathElements: activeProof.pathElements,
            activePathIndices: activeProof.pathIndices,
            revokedSiblings: revokedProof.siblings,
            revokedOldKey: revokedProof.oldKey,
            revokedOldValue: revokedProof.oldValue,
            revokedIsOld0: revokedProof.isOld0,
            activeRoot: activeRoot.toString(),
            revokedRoot: revokedProof.root,
            maxValue: maxValue.toString(),
            sessionExpiry: expiry.toString()
        };
        const { proof, publicSignals } = await snarkjs_1.groth16.fullProve(input, CIRCUIT_WASM_PATH, CIRCUIT_ZKEY_PATH);
        const normalizedProof = this.normalizeScalars(proof);
        const normalizedPublicSignals = this.normalizeScalars(publicSignals);
        const chain = await this.blockchain.submitSessionForOrg(db, agent.org_id, sessionId, sessionWallet.address, maxValue, expiry, normalizedProof, normalizedPublicSignals);
        await db.run(`
            INSERT INTO sessions
            (agent_id,session_id,nullifier,proof,public_signals,tx_hash)
            VALUES (?,?,?,?,?,?)
            `, agentId, sessionId, String(normalizedPublicSignals[0]), JSON.stringify(normalizedProof), JSON.stringify({
            sessionId,
            sessionKey: sessionWallet.address,
            maxValue,
            expiry,
            publicSignals: normalizedPublicSignals
        }), chain.txHash);
        return {
            success: true,
            agentId,
            orgId: agent.org_id,
            txHash: chain.txHash,
            sessionId,
            sessionKey: sessionWallet.address,
            contractAddress: chain.contractAddress
        };
    }
    async fundAgent(db, agentId, amountEth) {
        const wallet = await db.get(`
            SELECT *
            FROM wallets
            WHERE agent_id = ?
            ORDER BY id DESC
            `, agentId);
        if (!wallet) {
            throw new Error("wallet not found for agent");
        }
        return this.blockchain.fundAddress(wallet.wallet_address, amountEth);
    }
    async fundOrganization(db, orgId, amountEth) {
        const wallets = await db.all(`
            SELECT wallet_address, agent_id
            FROM wallets
            WHERE org_id = ?
            ORDER BY id ASC
            `, orgId);
        if (wallets.length === 0) {
            throw new Error("no wallets found for organization");
        }
        const transfers = [];
        for (const wallet of wallets) {
            const transfer = await this.blockchain.fundAddress(wallet.wallet_address, amountEth);
            transfers.push({
                ...transfer,
                agentId: wallet.agent_id
            });
        }
        return {
            success: true,
            orgId,
            amountEth,
            transfers
        };
    }
}
exports.PlatformService = PlatformService;
