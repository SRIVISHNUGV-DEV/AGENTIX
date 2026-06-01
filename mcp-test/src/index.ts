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
import { createMCPServer, TOOL_DEFS } from "./server.js"
import { getProverStatus } from "./circuits.js"

let connected = false

function showConnectionBanner(mode: string) {
  if (connected) return
  connected = true
  const status = getProverStatus()
  console.error("")
  console.error("╔══════════════════════════════════════════════════════╗")
  console.error("║        AGENTIX MCP TEST SERVER — CONNECTED         ║")
  console.error("╠══════════════════════════════════════════════════════╣")
  console.error(`║  Mode:  ${mode.padEnd(39)}║`)
  console.error(`║  Transport:  ${(mode === "HTTP" ? "Streamable HTTP" : "Stdio").padEnd(34)}║`)
  console.error(`║  Prover:  ${(status.available ? "Groth16 (snarkjs) ✓" : "Simulated (circuit files missing) ⚡").padEnd(34)}║`)
  console.error(`║  Tools:  ${TOOL_DEFS.length.toString().padEnd(38)}║`)
  console.error(`║  Clients:  ${"All MCP-compatible (Claude, Cursor, VS Code, etc.)".padEnd(15)}║`)
  console.error("╚══════════════════════════════════════════════════════╝")
  console.error("")
}

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
    const isBun = typeof (globalThis as any).Bun !== "undefined"
    await (isBun ? serveHttpWithBun(server, port) : serveHttpWithNode(server, port))

    console.error(`[agentix-mcp-test] HTTP server listening on port ${port}`)
    console.error(`[agentix-mcp-test] Connect your MCP client to http://localhost:${port}/mcp`)
    console.error(`[agentix-mcp-test] Waiting for client connection...`)
  } else {
    // Stdio transport (for Claude Desktop, Cline, etc.)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    showConnectionBanner("Stdio")
  }
}

async function serveHttpWithNode(server: Server, port: number) {
  const http = await import("http")
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js")

  let firstRequest = true

  const httpServer = http.createServer(async (req: any, res: any) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", prover: getProverStatus() }))
      return
    }

    if (firstRequest) {
      firstRequest = false
      showConnectionBanner("HTTP")
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

  let firstRequest = true

  ;(globalThis as any).Bun.serve({
    port,
    async fetch(req: Request) {
      if (req.method === "GET" && new URL(req.url).pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", prover: getProverStatus() }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      if (firstRequest) {
        firstRequest = false
        showConnectionBanner("HTTP")
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
