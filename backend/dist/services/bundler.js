"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BundlerService = void 0;
const ethers_1 = require("ethers");
const errors_1 = require("../utils/errors");
const BUNDLER_URLS = parseUrlList(process.env.BUNDLER_URLS || process.env.BUNDLER_URL || "");
const DEFAULT_ENTRY_POINT_ADDRESS = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const ENTRY_POINT_ABI = [
    "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
    "function getNonce(address sender, uint192 key) view returns (uint256)"
];
class BundlerService {
    provider;
    entryPoint;
    constructor(provider, entryPointAddress = DEFAULT_ENTRY_POINT_ADDRESS) {
        this.provider = provider;
        this.entryPoint = new ethers_1.ethers.Contract(entryPointAddress, ENTRY_POINT_ABI, provider);
    }
    isConfigured() {
        return BUNDLER_URLS.length > 0;
    }
    async getNonce(sender) {
        return this.entryPoint.getNonce(sender, 0);
    }
    async getUserOpHash(userOp) {
        return this.entryPoint.getUserOpHash(userOp);
    }
    async estimateUserOperationGas(userOp, entryPointAddress = DEFAULT_ENTRY_POINT_ADDRESS) {
        return this.rpc("eth_estimateUserOperationGas", [userOp, entryPointAddress]);
    }
    async sendUserOperation(userOp, entryPointAddress = DEFAULT_ENTRY_POINT_ADDRESS) {
        return this.rpc("eth_sendUserOperation", [userOp, entryPointAddress]);
    }
    async getUserOperationReceipt(userOpHash) {
        return this.rpc("eth_getUserOperationReceipt", [userOpHash]);
    }
    buildPackedGasLimits(verificationGasLimit, callGasLimit) {
        return ethers_1.ethers.toBeHex((verificationGasLimit << 128n) | callGasLimit, 32);
    }
    buildPackedGasFees(maxPriorityFeePerGas, maxFeePerGas) {
        return ethers_1.ethers.toBeHex((maxPriorityFeePerGas << 128n) | maxFeePerGas, 32);
    }
    async rpc(method, params) {
        if (BUNDLER_URLS.length === 0) {
            throw new errors_1.AppError(400, "bundler is not configured");
        }
        let lastError = null;
        for (const bundlerUrl of BUNDLER_URLS) {
            try {
                const response = await fetch(bundlerUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: Date.now(),
                        method,
                        params
                    })
                });
                if (!response.ok) {
                    lastError = new errors_1.AppError(502, `bundler request failed with status ${response.status}`);
                    continue;
                }
                const payload = await response.json();
                if (payload.error) {
                    lastError = new errors_1.AppError(502, payload.error.message || "bundler request failed");
                    continue;
                }
                return payload.result;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (lastError instanceof errors_1.AppError) {
            throw lastError;
        }
        throw new errors_1.AppError(502, "all bundler endpoints failed");
    }
}
exports.BundlerService = BundlerService;
function parseUrlList(value) {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
