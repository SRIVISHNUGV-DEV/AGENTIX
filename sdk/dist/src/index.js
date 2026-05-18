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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_PERMISSIONS = exports.SessionManager = exports.AgentClient = void 0;
var AgentClient_1 = require("./AgentClient");
Object.defineProperty(exports, "AgentClient", { enumerable: true, get: function () { return AgentClient_1.AgentClient; } });
var SessionManager_1 = require("./SessionManager");
Object.defineProperty(exports, "SessionManager", { enumerable: true, get: function () { return SessionManager_1.SessionManager; } });
__exportStar(require("./types"), exports);
// Re-export AGENT_PERMISSIONS constants
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
