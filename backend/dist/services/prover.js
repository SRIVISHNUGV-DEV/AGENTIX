"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProverAvailable = isProverAvailable;
exports.getProverStatus = getProverStatus;
exports.generateProof = generateProof;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const snarkjs_1 = require("snarkjs");
// FLAW 4 FIX: Graceful circuit fallback
// Circuit files are checked lazily at proof generation time, not at startup
// This allows the backend to start without circuit files installed
const CIRCUIT_WASM_PATH = path_1.default.resolve(__dirname, "../../../circuits/build/credential_js/credential.wasm");
// Cache for resolved paths - null until first proof generation
let circuitZkeyPath = null;
let checkedCircuitFiles = false;
function resolveZkeyPath() {
    const buildDir = path_1.default.resolve(__dirname, "../../../circuits/build");
    if (!fs_1.default.existsSync(buildDir)) {
        return "";
    }
    const zkey = fs_1.default.readdirSync(buildDir).find((file) => file.endsWith(".zkey"));
    if (!zkey) {
        return "";
    }
    return path_1.default.join(buildDir, zkey);
}
function checkCircuitFiles() {
    const wasmExists = fs_1.default.existsSync(CIRCUIT_WASM_PATH);
    if (!circuitZkeyPath) {
        circuitZkeyPath = resolveZkeyPath();
    }
    return {
        wasm: wasmExists,
        zkey: !!circuitZkeyPath
    };
}
function isProverAvailable() {
    if (!checkedCircuitFiles) {
        const { wasm, zkey } = checkCircuitFiles();
        checkedCircuitFiles = true;
        return wasm && zkey;
    }
    return !!(circuitZkeyPath && fs_1.default.existsSync(CIRCUIT_WASM_PATH));
}
function getProverStatus() {
    return {
        available: isProverAvailable(),
        wasmPath: CIRCUIT_WASM_PATH,
        zkeyPath: circuitZkeyPath
    };
}
async function generateProof(db, input) {
    // Check circuit files lazily when proof is requested
    const { wasm, zkey } = checkCircuitFiles();
    if (!wasm) {
        throw new Error(`Circuit WASM file not found at ${CIRCUIT_WASM_PATH}. Run 'npm run build' in circuits/ directory.`);
    }
    if (!zkey || !circuitZkeyPath) {
        throw new Error(`No .zkey file found. Run 'npm run build' in circuits/ directory to generate proving key.`);
    }
    const cacheKey = JSON.stringify(input);
    const cached = await db.get(`
        SELECT *
        FROM proof_cache
        WHERE key = $1 AND expires_at > EXTRACT(EPOCH FROM NOW())::INTEGER
        `, cacheKey);
    if (cached) {
        return {
            proof: JSON.parse(cached.proof),
            publicSignals: JSON.parse(cached.public_signals)
        };
    }
    const { proof, publicSignals } = await snarkjs_1.groth16.fullProve(input, CIRCUIT_WASM_PATH, circuitZkeyPath);
    await db.run(`
        INSERT INTO proof_cache
        (key, proof, public_signals, created_at, expires_at)
        VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::INTEGER, EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::INTEGER)
        `, cacheKey, JSON.stringify(proof), JSON.stringify(publicSignals));
    return { proof, publicSignals };
}
