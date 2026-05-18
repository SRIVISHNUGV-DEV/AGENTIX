"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ethers_1 = require("ethers");
const snarkjs_1 = require("snarkjs");
const CIRCUIT_WASM_PATH = path_1.default.resolve(__dirname, "../../../circuits/build/credential_js/credential.wasm");
const CIRCUIT_ZKEY_PATH = resolveZkeyPath();
function resolveZkeyPath() {
    const buildDir = path_1.default.resolve(__dirname, "../../../circuits/build");
    const zkey = fs_1.default.readdirSync(buildDir).find((file) => file.endsWith(".zkey"));
    if (!zkey) {
        throw new Error(`No .zkey file found in ${buildDir}`);
    }
    return path_1.default.join(buildDir, zkey);
}
class SessionManager {
    api;
    secret;
    constructor(api, secret) {
        this.api = api;
        this.secret = secret;
    }
    async fetchMerkleProof(agentId) {
        const res = await axios_1.default.get(`${this.api}/proofs/${agentId}`);
        return res.data;
    }
    async generateProof(agentId, orgId, permissions, expiry, sessionNonce, proof) {
        const input = {
            agentId: agentId.toString(),
            orgId: orgId.toString(),
            permissions: permissions.toString(),
            expiry: expiry.toString(),
            secret: this.secret.toString(),
            sessionNonce: sessionNonce.toString(),
            activePathElements: proof.activePathElements,
            activePathIndices: proof.activePathIndices,
            revokedSiblings: proof.revokedSiblings,
            revokedOldKey: proof.revokedOldKey,
            revokedOldValue: proof.revokedOldValue,
            revokedIsOld0: proof.revokedIsOld0,
            activeRoot: proof.activeRoot,
            revokedRoot: proof.revokedRoot,
            maxValue: permissions.toString(),
            sessionExpiry: Math.floor(Date.now() / 1000 + 604800).toString()
        };
        const { proof: zkProof, publicSignals } = await snarkjs_1.groth16.fullProve(input, CIRCUIT_WASM_PATH, CIRCUIT_ZKEY_PATH);
        return {
            proof: zkProof,
            publicSignals
        };
    }
    createSessionWallet() {
        return ethers_1.Wallet.createRandom();
    }
    async submitSession(agentId, zk, sessionKey, sessionId) {
        const normalizedProof = this.normalizeScalars(zk.proof);
        const normalizedPublicSignals = this.normalizeScalars(zk.publicSignals);
        const expiry = Number(zk.publicSignals[4]);
        const request = {
            agentId,
            sessionId: sessionId ?? this.createSessionId(agentId, sessionKey),
            sessionKey,
            maxValue: Number(zk.publicSignals[3]),
            expiry,
            proof: normalizedProof,
            publicSignals: normalizedPublicSignals
        };
        const res = await axios_1.default.post(`${this.api}/sessions`, request);
        return res.data;
    }
    createSessionId(agentId, sessionKey) {
        return `0x${crypto_1.default
            .createHash("sha256")
            .update(`${agentId}:${sessionKey}:${Date.now()}`)
            .digest("hex")}`;
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
}
exports.SessionManager = SessionManager;
