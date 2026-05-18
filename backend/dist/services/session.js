"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionId = createSessionId;
const crypto_1 = __importDefault(require("crypto"));
function createSessionId(agentId, sessionKey, nonce) {
    const seed = nonce ?? `${Date.now()}`;
    return `0x${crypto_1.default
        .createHash("sha256")
        .update(`${agentId}:${sessionKey}:${seed}`)
        .digest("hex")}`;
}
