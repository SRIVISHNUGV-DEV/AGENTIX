#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMCPServer, TOOL_DEFS } from "./server.js"
import { getProverStatus } from "./circuits.js"
import { HTTP_PORT, PACKAGE_NAME, PACKAGE_VERSION, CLI_NAME } from "./config.js"
import { addCommand, removeCommand, statusCommand, helpCommand } from "./cli.js"

let connected = false

function showConnectionBanner(mode: string) {
  if (connected) return
  connected = true
  const status = getProverStatus()
  console.error("")
  console.error("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")
  console.error(`\u2551  ${PACKAGE_NAME} v${PACKAGE_VERSION} ${" ".repeat(30 - PACKAGE_NAME.length - PACKAGE_VERSION.length)}\u2551`)
  console.error("\u2551  CONNECTED" + " ".repeat(42) + "\u2551")
  console.error(`\u2551  Mode: ${mode.padEnd(45)}\u2551`)
  console.error(`\u2551  Transport: ${(mode === "HTTP" ? "Streamable HTTP" : "Stdio").padEnd(39)}\u2551`)
  console.error(`\u2551  Prover: ${(status.available ? "Groth16 (snarkjs)" : "Simulated").padEnd(40)}\u2551`)
  console.error(`\u2551  Tools: ${String(TOOL_DEFS.length).padEnd(43)}\u2551`)
  console.error("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d")
  console.error("")
}

function showBanner() {
  console.error("")
  console.error("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")
  console.error(`\u2551  ${PACKAGE_NAME} v${PACKAGE_VERSION}${" ".repeat(31 - String(PACKAGE_VERSION).length)}\u2551`)
  console.error("\u2551" + " ".repeat(55) + "\u2551")
  console.error("\u2551  Compatible with: Claude Desktop, Claude Code, OpenCode," + " ".repeat(6) + "\u2551")
  console.error("\u2551  Cursor, VS Code, Windsurf, JetBrains, Cline" + " ".repeat(18) + "\u2551")
  console.error("\u2551" + " ".repeat(55) + "\u2551")
  console.error(`\u2551  ${C.cyan}${CLI_NAME} add${C.reset} ${C.dim}- auto-install for all clients${C.reset}${" ".repeat(5)}\u2551`.replace(/\x1b\[\d+m/g, ""))
  console.error("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d")
  console.error("")
}

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === "add" || command === "install") {
    const target = args[1]
    addCommand(target)
    return
  }

  if (command === "remove" || command === "uninstall") {
    removeCommand()
    return
  }

  if (command === "status" || command === "check") {
    statusCommand()
    return
  }

  if (command === "help" || command === "--help" || command === "-h") {
    helpCommand()
    return
  }

  if (command === "server" || command === "start") {
    const remaining = args.slice(1)
    await startServer(remaining)
    return
  }

  await startServer(args)
}

async function startServer(args: string[]) {
  const useHttp = args.includes("--http")
  const port = (() => {
    const idx = args.indexOf("--port")
    return idx >= 0 && idx + 1 < args.length ? parseInt(args[idx + 1], 10) : HTTP_PORT
  })()

  const status = getProverStatus()
  console.error(`[${CLI_NAME}] Prover: ${status.available ? "Groth16 (snarkjs)" : "Simulated"}${status.wasmPath !== "(not found)" ? " (" + status.wasmPath + ")" : ""}`)

  const server = createMCPServer()

  if (useHttp) {
    const isBun = typeof (globalThis as any).Bun !== "undefined"
    await (isBun ? serveHttpWithBun(server, port) : serveHttpWithNode(server, port))
    console.error(`[${CLI_NAME}] HTTP server on port ${port}`)
    console.error(`[${CLI_NAME}] Endpoint: http://localhost:${port}/mcp`)
  } else {
    showBanner()
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
    if (firstRequest) { firstRequest = false; showConnectionBanner("HTTP") }
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
      if (firstRequest) { firstRequest = false; showConnectionBanner("HTTP") }
      const transport = new WebStandardStreamableHTTPServerTransport()
      await server.connect(transport)
      return transport.handleRequest(req)
    },
  })
}

main().catch((err) => {
  console.error(`[${CLI_NAME}] Fatal:`, err)
  process.exit(1)
})
