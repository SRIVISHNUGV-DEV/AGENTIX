#!/usr/bin/env node
"use strict";
/**
 * Agentix MCP Server CLI Entry Point
 *
 * Run this for stdio-based MCP connections (e.g., Claude Desktop)
 *
 * Usage:
 *   node dist/mcp/cli.js
 *
 * Or add to Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "agentix": {
 *         "command": "node",
 *         "args": ["/path/to/agent-credentials-mvp/backend/dist/mcp/cli.js"]
 *       }
 *     }
 *   }
 */
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const server_js_1 = require("./server.js");
async function main() {
    const server = (0, server_js_1.createMCPServer)();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Agentix MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
