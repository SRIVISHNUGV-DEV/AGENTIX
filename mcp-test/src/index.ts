#!/usr/bin/env node

/**
 * agentix-mcp-test — standalone testnet MCP server
 *
 * Usage:
 *   agentix-mcp-test                          # stdio transport (for Claude Desktop)
 *   agentix-mcp-test --http                   # HTTP transport on port 3100
 *   agentix-mcp-test --http --port 8080       # custom port
 *
 * Env vars:
 *   CHAIN_ID, RPC_URL, NETWORK_NAME          — testnet config (default: Sepolia)
 *   VERIFIER_ADDRESS, ...                    — contract addresses
 *   PORT                                      — HTTP port (default: 3100)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMCPServer } from "./server.js"
import { getProverStatus } from "./circuits.js"

const args = process.argv.slice(2)
const useHttp = args.includes("--http")
const port = (() => {
  const idx = args.indexOf("--port")
  return idx >= 0 && idx + 1 < args.length ? parseInt(args[idx + 1], 10) : 3100
})()

async function main() {
  const status = getProverStatus()
  console.error(`[agentix-mcp-test] Circuit status: WASM=${status.wasmPath} ${status.wasmPath ? "✓" : "✗"}, Zkey=${status.zkeyPath ? "✓" : "✗"}`)
  console.error(`[agentix-mcp-test] Prover available: ${status.available}`)

  const server = createMCPServer()

  if (useHttp) {
    // Streamable HTTP transport
    const { WebStandardStreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")
    const transport = new WebStandardStreamableHTTPServerTransport()

    const isBun = typeof (globalThis as any).Bun !== "undefined"
    await (isBun ? serveHttpWithBun(server, port) : serveHttpWithNode(server, port))

    console.error(`[agentix-mcp-test] HTTP server listening on port ${port}`)
    console.error(`[agentix-mcp-test] Connect your MCP client to http://localhost:${port}/mcp`)
  } else {
    // Stdio transport (for Claude Desktop, Cline, etc.)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error(`[agentix-mcp-test] Running in stdio mode — connect via MCP client`)
  }
}

async function serveHttpWithNode(server: Server, port: number) {
  const http = await import("http")
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")

  const httpServer = http.createServer(async (req: any, res: any) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", prover: getProverStatus() }))
      return
    }

    const transport = new WebStandardStreamableHTTPServerTransport()
    await server.connect(transport)

    const bodyBuffer = req.method !== "GET" && req.method !== "HEAD"
      ? await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = []
          req.on("data", (c: Buffer) => chunks.push(c))
          req.on("end", () => resolve(Buffer.concat(chunks)))
        })
      : null

    const mockReq = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).reduce((acc, [k, v]) => {
        if (v) acc[k] = Array.isArray(v) ? v[0] : v
        return acc
      }, {} as Record<string, string>),
      body: bodyBuffer?.toString() || undefined,
    })

    const response = await transport.handleRequest(mockReq)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(await response.text())
  })

  httpServer.listen(port)
  return httpServer
}

async function serveHttpWithBun(server: Server, port: number) {
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")

  ;(globalThis as any).Bun.serve({
    port,
    async fetch(req: Request) {
      if (req.method === "GET" && new URL(req.url).pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", prover: getProverStatus() }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      const transport = new WebStandardStreamableHTTPServerTransport()
      await server.connect(transport)
      return transport.handleRequest(req)
    },
  })
}

main().catch((err) => {
  console.error("[agentix-mcp-test] Fatal:", err)
  process.exit(1)
})
