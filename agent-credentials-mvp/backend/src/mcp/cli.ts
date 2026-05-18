#!/usr/bin/env node
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

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMCPServer } from "./server.js"

async function main() {
  const server = createMCPServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  console.error("Agentix MCP Server running on stdio")
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
