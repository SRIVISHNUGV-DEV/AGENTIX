"use strict";
/**
 * Agentix MCP Module Entry Point
 *
 * Exports the MCP server components for Agentix.
 */
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
exports.getTransportEvents = exports.getActiveTransportCount = exports.createMCPRouter = exports.createMCPServer = void 0;
var server_1 = require("./server");
Object.defineProperty(exports, "createMCPServer", { enumerable: true, get: function () { return server_1.createMCPServer; } });
Object.defineProperty(exports, "createMCPRouter", { enumerable: true, get: function () { return server_1.createMCPRouter; } });
Object.defineProperty(exports, "getActiveTransportCount", { enumerable: true, get: function () { return server_1.getActiveTransportCount; } });
Object.defineProperty(exports, "getTransportEvents", { enumerable: true, get: function () { return server_1.getTransportEvents; } });
__exportStar(require("./types"), exports);
