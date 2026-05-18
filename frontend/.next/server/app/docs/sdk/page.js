"use strict";(()=>{var a={};a.id=2119,a.ids=[2119],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},2220:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("clock",[["path",{d:"M12 6v6l4 2",key:"mmk7yg"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]])},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},5849:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("wallet",[["path",{d:"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",key:"18etb6"}],["path",{d:"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",key:"xoc0q4"}]])},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},17891:a=>{a.exports=require("next/dist/shared/lib/router/utils/get-segment-param")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21053:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]])},26713:a=>{a.exports=require("next/dist/shared/lib/router/utils/is-bot")},28354:a=>{a.exports=require("util")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},41025:a=>{a.exports=require("next/dist/server/app-render/dynamic-access-async-storage.external.js")},42910:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("package",[["path",{d:"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",key:"1a0edw"}],["path",{d:"M12 22V12",key:"d0xqtd"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}]])},43954:a=>{a.exports=require("next/dist/shared/lib/router/utils/interception-routes")},55314:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("book-open",[["path",{d:"M12 7v14",key:"1akyts"}],["path",{d:"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",key:"ruj8y"}]])},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},63342:(a,b,c)=>{c.r(b),c.d(b,{default:()=>G,metadata:()=>t});var d=c(22037),e=c(89813),f=c.n(e),g=c(94413),h=c(56889),i=c(42910),j=c(21053),k=c(43202),l=c(20596);let m=(0,c(53712).A)("code-xml",[["path",{d:"m18 16 4-4-4-4",key:"1inbqp"}],["path",{d:"m6 8-4 4 4 4",key:"15zrgr"}],["path",{d:"m14.5 4-5 16",key:"e7oirm"}]]);var n=c(2149),o=c(5849),p=c(64301),q=c(2220),r=c(55314),s=c(88811);let t={title:"SDK Reference - Agentix",description:"Complete TypeScript SDK documentation for Agentix Protocol."},u=`npm install @agentix/sdk

# Or with yarn
yarn add @agentix/sdk

# Or with pnpm
pnpm add @agentix/sdk`,v=`import { AgentClient, AGENT_PERMISSIONS } from "@agentix/sdk"

// Step 1: Initialize the client
const client = new AgentClient("http://127.0.0.1:3001")
await client.init()

// Step 2: Register an agent
const registration = await client.registerAgent({
  orgId: 1,
  agentName: "Treasury Manager",
  permissions: AGENT_PERMISSIONS.ALL,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30  // 30 days
})

console.log("Agent ID:", registration.agentId)
// Agent ID: 42`,w=`import { AgentClient, AGENT_PERMISSIONS } from "@agentix/sdk"

async function main() {
  // ============================================
  // STEP 1: Initialize Client
  // ============================================
  const client = new AgentClient("http://127.0.0.1:3001")
  await client.init()  // Required: initializes Poseidon hash

  // ============================================
  // STEP 2: Register Agent
  // ============================================
  const registration = await client.registerAgent({
    orgId: 1,
    agentName: "My Production Agent",
    permissions: AGENT_PERMISSIONS.READ_FILE | AGENT_PERMISSIONS.WRITE_FILE,
    expiry: Math.floor(Date.now() / 1000) + 86400 * 30
  })

  const { agentId, orgId } = registration

  // ============================================
  // STEP 3: Create Wallet (ERC-4337)
  // ============================================
  const wallet = await client.createWallet({
    ownerAddress: "0xYourWalletAddress...",
    agentId: agentId
  })

  console.log("Wallet deployed:", wallet.walletAddress)

  // ============================================
  // STEP 4: Create On-Chain Session
  // ============================================
  const session = await client.createSession({
    agentId: agentId,
    orgId: orgId,
    expirySeconds: 3600  // 1 hour
  })

  console.log("Session created:", session.session.sessionId)

  // ============================================
  // STEP 5: Execute Actions
  // ============================================
  const result = await client.readFile(agentId, "/data/config.json")
  console.log("File contents:", result.execution.result)
}

main().catch(console.error)`,x=`import { AgentClient } from "@agentix/sdk"

const client = new AgentClient()
await client.init()

const agentId = 42

// ============================================
// READ FILE
// ============================================
const readResult = await client.readFile(agentId, "/data/config.json")
console.log(readResult.execution.result)
// { "content": "..." }

// ============================================
// WRITE FILE
// ============================================
const writeResult = await client.writeFile(
  agentId,
  "/data/output.json",
  JSON.stringify({ status: "complete", timestamp: Date.now() })
)
console.log(writeResult.execution.success)
// true

// ============================================
// EXECUTE COMMAND
// ============================================
const cmdResult = await client.executeCommand(
  agentId,
  "npm",
  ["run", "build"],
  "/project/path"
)
console.log(cmdResult.execution.result)

// ============================================
// API CALL
// ============================================
const apiResult = await client.apiCall(
  agentId,
  "https://api.example.com/users",
  "GET"
)
console.log(apiResult.execution.result)

// ============================================
// SIGN TRANSACTION
// ============================================
const txResult = await client.signTransaction(
  agentId,
  "0xRecipientAddress...",
  "1000000000000000000",  // 1 ETH in wei
  "0x"  // data
)

// ============================================
// CUSTOM ACTION
// ============================================
const customResult = await client.customAction(
  agentId,
  "my_custom_action",
  { param1: "value1", param2: "value2" }
)`,y=`import { AGENT_PERMISSIONS } from "@agentix/sdk"

// Individual permissions (bitmasks)
AGENT_PERMISSIONS.READ_FILE         // 1
AGENT_PERMISSIONS.WRITE_FILE        // 2
AGENT_PERMISSIONS.EXECUTE_COMMAND   // 4
AGENT_PERMISSIONS.QUERY             // 8
AGENT_PERMISSIONS.API_CALL          // 16
AGENT_PERMISSIONS.SIGN_TRANSACTION  // 32
AGENT_PERMISSIONS.DEPLOY_CONTRACT   // 64
AGENT_PERMISSIONS.CUSTOM            // 128
AGENT_PERMISSIONS.ALL               // 255

// Combine permissions with bitwise OR
const readWrite = AGENT_PERMISSIONS.READ_FILE | AGENT_PERMISSIONS.WRITE_FILE  // 3

// Check permission with bitwise AND
const canWrite = (permissions & AGENT_PERMISSIONS.WRITE_FILE) !== 0`,z=`// ============================================
// CREATE WALLET WITH AUTO-GENERATED OWNER
// ============================================
const wallet = await client.createWallet()

console.log("Wallet Address:", wallet.walletAddress)
console.log("Owner Address:", wallet.ownerAddress)
console.log("Private Key:", wallet.ownerPrivateKey)  // ⚠️ Store securely!

// ============================================
// CREATE WALLET WITH EXISTING OWNER
// ============================================
const wallet = await client.createWallet({
  ownerAddress: "0xMyExistingAddress..."
})

// ============================================
// CREATE WALLET FOR AGENT
// ============================================
const wallet = await client.createWallet({
  ownerAddress: "0x...",
  agentId: 42
})`,A=`// ============================================
// CREATE SESSION
// ============================================
const session = await client.createSession({
  agentId: 42,
  orgId: 1,
  expirySeconds: 7200  // 2 hours
})

console.log("Session ID:", session.session.sessionId)
console.log("Session Key:", session.sessionKey)
console.log("Expires:", new Date(session.session.expiresAt * 1000))

// ============================================
// LOW-LEVEL SESSION MANAGER
// ============================================
const manager = client.sessionManager()

// Fetch Merkle proof for agent
const proof = await manager.fetchMerkleProof(agentId)

// Generate ZK proof
const zkProof = await manager.generateProof(
  agentId,
  orgId,
  permissions,
  expiry,
  timestamp,
  proofBundle
)

// Submit session on-chain
const result = await manager.submitSession(
  agentId,
  zkProof,
  sessionKeyAddress
)`,B=`// ============================================
// GET EXECUTION HISTORY
// ============================================
const { executions } = await client.getExecutions(agentId, 50)

for (const exec of executions) {
  console.log(\`\${exec.action}: \${exec.status}\`)
}

// ============================================
// GET SPECIFIC EXECUTION
// ============================================
const execution = await client.getExecution(agentId, "execution-uuid")

// ============================================
// GET EXECUTION STATS
// ============================================
const { stats } = await client.getExecutionStats(agentId)

console.log("Total:", stats.totalExecutions)
console.log("Success Rate:", (stats.successfulExecutions / stats.totalExecutions * 100).toFixed(1) + "%")
console.log("Avg Time:", stats.avgExecutionTimeMs + "ms")`,C=`// Execution Types
type ExecutionAction =
  | "read_file"
  | "write_file"
  | "execute_command"
  | "query"
  | "api_call"
  | "sign_transaction"
  | "deploy_contract"
  | "custom"

type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "timeout"

// Agent Types
type AgentType =
  | "openclaude"
  | "langchain"
  | "claude_code"
  | "crewai"
  | "llama_index"
  | "autogen"
  | "smolagents"
  | "custom"

// Response Types
interface Execution {
  id: string
  externalAgentId: string
  orgId: string
  requestId: string
  action: ExecutionAction
  params: Record<string, unknown>
  proof: unknown | null
  result: unknown | null
  success: boolean
  errorMessage: string | null
  executionTimeMs: number
  createdAt: string
  status: ExecutionStatus
}

interface WalletResponse {
  success: boolean
  txHash: string
  walletAddress: string
  ownerAddress: string
  sessionManagerAddress: string
  walletKind: string
}`;function D({code:a,language:b="typescript"}){return(0,d.jsxs)("div",{className:"relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden",children:[(0,d.jsxs)("div",{className:"flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50",children:[(0,d.jsx)("span",{className:"text-xs text-zinc-500 font-mono",children:b}),(0,d.jsxs)("button",{className:"text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1",children:[(0,d.jsx)(g.A,{className:"h-3 w-3"}),"Copy"]})]}),(0,d.jsx)("pre",{className:"p-4 overflow-x-auto",children:(0,d.jsx)("code",{className:"text-sm font-mono text-zinc-300 whitespace-pre",children:a})})]})}function E({id:a,title:b,icon:c,children:e}){return(0,d.jsxs)("section",{id:a,className:"scroll-mt-20 mt-16 first:mt-0",children:[(0,d.jsxs)("div",{className:"flex items-center gap-3 mb-4",children:[(0,d.jsx)("div",{className:"flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10",children:(0,d.jsx)(c,{className:"h-5 w-5 text-emerald-400"})}),(0,d.jsx)("h2",{className:"text-2xl font-semibold",children:b})]}),e]})}function F({name:a,params:b,returns:c,description:e}){return(0,d.jsxs)("div",{className:"rounded-lg border border-zinc-800 bg-zinc-900/30 p-4",children:[(0,d.jsxs)("div",{className:"font-mono text-sm",children:[(0,d.jsx)("span",{className:"text-emerald-400",children:a}),(0,d.jsx)("span",{className:"text-zinc-500",children:"("}),(0,d.jsx)("span",{className:"text-zinc-300",children:b}),(0,d.jsx)("span",{className:"text-zinc-500",children:")"}),(0,d.jsx)("span",{className:"text-zinc-500",children:": "}),(0,d.jsx)("span",{className:"text-blue-400",children:c})]}),(0,d.jsx)("p",{className:"mt-2 text-sm text-zinc-500",children:e})]})}function G(){return(0,d.jsxs)("div",{className:"min-h-screen bg-zinc-950 text-zinc-100",children:[(0,d.jsx)("header",{className:"sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm",children:(0,d.jsxs)("div",{className:"mx-auto flex max-w-6xl items-center justify-between px-6 py-4",children:[(0,d.jsxs)("div",{className:"flex items-center gap-2",children:[(0,d.jsxs)(f(),{href:"/docs",className:"text-zinc-400 hover:text-zinc-200 flex items-center gap-1",children:[(0,d.jsx)(h.A,{className:"h-4 w-4"}),"Docs"]}),(0,d.jsx)("span",{className:"text-zinc-600",children:"/"}),(0,d.jsx)("span",{className:"text-zinc-100",children:"SDK Reference"})]}),(0,d.jsxs)("nav",{className:"flex items-center gap-6 text-sm",children:[(0,d.jsx)(f(),{href:"/docs/api",className:"text-zinc-400 hover:text-zinc-200",children:"API Reference"}),(0,d.jsx)(f(),{href:"/docs/mcp",className:"text-zinc-400 hover:text-zinc-200",children:"MCP Server"})]})]})}),(0,d.jsxs)("main",{className:"mx-auto max-w-6xl px-6 py-12",children:[(0,d.jsxs)("div",{className:"max-w-3xl mb-12",children:[(0,d.jsxs)("div",{className:"flex items-center gap-2 mb-4",children:[(0,d.jsx)("span",{className:"rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400",children:"TypeScript"}),(0,d.jsx)("span",{className:"rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-400",children:"v1.0.0"})]}),(0,d.jsx)("h1",{className:"text-4xl font-semibold tracking-tight",children:"SDK Reference"}),(0,d.jsx)("p",{className:"mt-4 text-lg text-zinc-400",children:"The official TypeScript SDK for integrating AI agents with the Agentix Protocol. Zero dependencies, fully typed, works in Node.js and browsers."})]}),(0,d.jsx)("div",{className:"grid gap-3 sm:grid-cols-4 mb-16",children:[{label:"Installation",id:"installation"},{label:"Quick Start",id:"quickstart"},{label:"AgentClient",id:"agentclient"},{label:"Executions",id:"executions"}].map(({label:a,id:b})=>(0,d.jsx)("a",{href:`#${b}`,className:"text-sm text-zinc-400 hover:text-zinc-200 text-center py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:a},b))}),(0,d.jsxs)(E,{id:"installation",title:"Installation",icon:i.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Install the SDK using your preferred package manager:"}),(0,d.jsx)(D,{code:u,language:"bash"})]}),(0,d.jsxs)(E,{id:"quickstart",title:"Quick Start",icon:j.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Get started in 5 minutes. This minimal example registers an agent and logs the ID:"}),(0,d.jsx)(D,{code:v})]}),(0,d.jsxs)("section",{id:"full-flow",className:"scroll-mt-20 mt-16",children:[(0,d.jsxs)("div",{className:"flex items-center gap-3 mb-4",children:[(0,d.jsx)("div",{className:"flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10",children:(0,d.jsx)(k.A,{className:"h-5 w-5 text-emerald-400"})}),(0,d.jsx)("h2",{className:"text-2xl font-semibold",children:"Complete Integration Flow"})]}),(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Follow these 5 steps to fully integrate an AI agent with Agentix:"}),(0,d.jsx)(D,{code:w})]}),(0,d.jsxs)(E,{id:"agentclient",title:"AgentClient Methods",icon:l.A,children:[(0,d.jsxs)("p",{className:"text-zinc-400 mb-6",children:["The ",(0,d.jsx)("code",{className:"text-emerald-400",children:"AgentClient"})," class is the main entry point. Here are all available methods:"]}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Initialization"}),(0,d.jsxs)("div",{className:"grid gap-3",children:[(0,d.jsx)(F,{name:"constructor",params:"backendUrl?: string",returns:"AgentClient",description:"Create a new client instance. Defaults to http://127.0.0.1:3001"}),(0,d.jsx)(F,{name:"init",params:"",returns:"Promise<void>",description:"Initialize Poseidon hash function. Must be called before other methods."})]}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Agent Registration"}),(0,d.jsxs)("div",{className:"grid gap-3",children:[(0,d.jsx)(F,{name:"registerAgent",params:"input: AgentRegistrationInput",returns:"Promise<AgentRegistrationResponse>",description:"Register a new agent with ZK credentials."}),(0,d.jsx)(F,{name:"registerCredential",params:"input: CredentialInput",returns:"Promise<any>",description:"Register credentials for an existing agent."}),(0,d.jsx)(F,{name:"revokeAgent",params:"agentId: number",returns:"Promise<any>",description:"Revoke agent credentials and deactivate."}),(0,d.jsx)(F,{name:"getAgentState",params:"agentId: number",returns:"Promise<any>",description:"Get full agent state including credentials, sessions, wallets."})]}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Wallet Operations"}),(0,d.jsxs)("div",{className:"grid gap-3",children:[(0,d.jsx)(F,{name:"createWallet",params:"options?: WalletOptions",returns:"Promise<WalletResponse>",description:"Deploy an ERC-4337 smart contract wallet for the agent."}),(0,d.jsx)(F,{name:"getWhitelist",params:"walletAddress: string",returns:"Promise<WhitelistResponse>",description:"Get whitelisted contracts for a wallet."}),(0,d.jsx)(F,{name:"addToWhitelist",params:"walletAddress, address, signature, nonce, requestedAt",returns:"Promise<any>",description:"Add contract to wallet whitelist."}),(0,d.jsx)(F,{name:"removeFromWhitelist",params:"walletAddress, address, signature, nonce, requestedAt",returns:"Promise<any>",description:"Remove contract from wallet whitelist."})]}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Session Management"}),(0,d.jsxs)("div",{className:"grid gap-3",children:[(0,d.jsx)(F,{name:"createSession",params:"input: SessionInput",returns:"Promise<SessionResponse>",description:"Create an on-chain session with ZK proof."}),(0,d.jsx)(F,{name:"getSessions",params:"orgId?: string",returns:"Promise<Session[]>",description:"List active sessions."})]})]}),(0,d.jsxs)(E,{id:"executions",title:"Execution Methods",icon:m,children:[(0,d.jsxs)("p",{className:"text-zinc-400 mb-6",children:["Execute actions on registered agents. Each method returns an ",(0,d.jsx)("code",{className:"text-blue-400",children:"Execution"})," object with the result:"]}),(0,d.jsx)(D,{code:x})]}),(0,d.jsxs)(E,{id:"permissions",title:"Permissions",icon:n.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Use bitmask constants to define agent capabilities. Combine with bitwise OR, check with bitwise AND:"}),(0,d.jsx)(D,{code:y}),(0,d.jsx)("div",{className:"mt-6 grid gap-2 sm:grid-cols-4",children:[{name:"READ_FILE",value:"1",desc:"Read file contents"},{name:"WRITE_FILE",value:"2",desc:"Write file contents"},{name:"EXECUTE_COMMAND",value:"4",desc:"Run shell commands"},{name:"QUERY",value:"8",desc:"Database queries"},{name:"API_CALL",value:"16",desc:"HTTP API calls"},{name:"SIGN_TRANSACTION",value:"32",desc:"Sign blockchain tx"},{name:"DEPLOY_CONTRACT",value:"64",desc:"Deploy smart contracts"},{name:"CUSTOM",value:"128",desc:"Custom actions"}].map(({name:a,value:b,desc:c})=>(0,d.jsxs)("div",{className:"rounded-lg border border-zinc-800 bg-zinc-900/30 p-3",children:[(0,d.jsxs)("div",{className:"font-mono text-sm",children:[(0,d.jsx)("span",{className:"text-emerald-400",children:a}),(0,d.jsxs)("span",{className:"text-zinc-600 ml-2",children:["= ",b]})]}),(0,d.jsx)("p",{className:"text-xs text-zinc-500 mt-1",children:c})]},a))})]}),(0,d.jsxs)(E,{id:"wallet",title:"Wallet Creation",icon:o.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Deploy ERC-4337 compliant smart contract wallets for your agents:"}),(0,d.jsx)(D,{code:z})]}),(0,d.jsxs)(E,{id:"session",title:"Session Management",icon:p.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Create on-chain sessions with ZK proofs for time-limited agent authorizations:"}),(0,d.jsx)(D,{code:A})]}),(0,d.jsxs)(E,{id:"stats",title:"Execution Stats",icon:q.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Monitor execution history and performance metrics:"}),(0,d.jsx)(D,{code:B})]}),(0,d.jsxs)(E,{id:"types",title:"TypeScript Types",icon:r.A,children:[(0,d.jsxs)("p",{className:"text-zinc-400 mb-6",children:["All types are exported from ",(0,d.jsx)("code",{className:"text-emerald-400",children:"@agentix/sdk"}),":"]}),(0,d.jsx)(D,{code:C})]}),(0,d.jsxs)("div",{className:"mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-8",children:[(0,d.jsx)("h3",{className:"text-xl font-semibold mb-4",children:"Next Steps"}),(0,d.jsxs)("div",{className:"grid gap-4 sm:grid-cols-2",children:[(0,d.jsxs)(f(),{href:"/docs/api",className:"flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:[(0,d.jsx)(s.A,{className:"h-5 w-5 text-blue-400"}),(0,d.jsxs)("div",{children:[(0,d.jsx)("div",{className:"font-medium",children:"API Reference"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"REST API endpoints"})]})]}),(0,d.jsxs)(f(),{href:"/docs/mcp",className:"flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:[(0,d.jsx)(i.A,{className:"h-5 w-5 text-pink-400"}),(0,d.jsxs)("div",{children:[(0,d.jsx)("div",{className:"font-medium",children:"MCP Server"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"Model Context Protocol"})]})]})]})]})]}),(0,d.jsx)("footer",{className:"border-t border-zinc-800 mt-20",children:(0,d.jsxs)("div",{className:"mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center",children:["Agentix Protocol • BUSR 1.1 License • ",(0,d.jsx)(f(),{href:"https://github.com/SRIVISHNUGV-DEV/AGENTIX",className:"hover:text-zinc-300",children:"GitHub"})]})})]})}},70722:a=>{a.exports=require("next/dist/shared/lib/invariant-error")},77068:a=>{a.exports=require("next/dist/shared/lib/size-limit")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},88811:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]])},93962:(a,b,c)=>{c.r(b),c.d(b,{__next_app__:()=>M,handler:()=>O,routeModule:()=>N});var d=c(31975),e=c(30600),f=c(66116),g=c(27321),h=c(42431),i=c(34935),j=c(57326),k=c(63459),l=c(8555),m=c(67401),n=c(75869),o=c(42417),p=c(44612),q=c(261),r=c(14220),s=c(37353),t=c(26713),u=c(99509),v=c(31310),w=c(85426),x=c(80463),y=c(83665),z=c(9071),A=c(62091),B=c(86439),C=c(77068),D=c(44303),E=c(18045),F=c(71860),G=c(70722),H=c(19995),I=c(43954),J=c(17891),K={};for(let a in E)0>["default","__next_app__","routeModule","handler"].indexOf(a)&&(K[a]=()=>E[a]);c.d(b,K);let L={children:["",{children:["docs",{children:["sdk",{children:["__PAGE__",{},{page:[()=>Promise.resolve().then(c.bind(c,63342)),"D:\\BLOCKCHAIN AND ZK PROJECTS\\AGENT_CREDENTIAL\\agent-credentials-mvp\\frontend\\app\\docs\\sdk\\page.tsx"]}]},{"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"]},[]]},{"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"]},[]]},{layout:[()=>Promise.resolve().then(c.bind(c,92564)),"D:\\BLOCKCHAIN AND ZK PROJECTS\\AGENT_CREDENTIAL\\agent-credentials-mvp\\frontend\\app\\layout.tsx"],"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"],"not-found":[()=>Promise.resolve().then(c.t.bind(c,13729,23)),"next/dist/client/components/builtin/not-found.js"],forbidden:[()=>Promise.resolve().then(c.t.bind(c,53532,23)),"next/dist/client/components/builtin/forbidden.js"],unauthorized:[()=>Promise.resolve().then(c.t.bind(c,4175,23)),"next/dist/client/components/builtin/unauthorized.js"]},[]]}.children,M={require:c,loadChunk:()=>Promise.resolve()},N=new d.AppPageRouteModule({definition:{kind:e.RouteKind.APP_PAGE,page:"/docs/sdk/page",pathname:"/docs/sdk",bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:L},distDir:".next",relativeProjectDir:""});async function O(a,b,d){var K,P,Q,R,S;d.requestMeta&&(0,h.setRequestMeta)(a,d.requestMeta),N.isDev&&(0,h.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let T=!!(0,h.getRequestMeta)(a,"minimalMode"),U="/docs/sdk/page";"/index"===U&&(U="/");let V=await N.prepare(a,b,{srcPage:U,multiZoneDraftMode:!1});if(!V)return b.statusCode=400,b.end("Bad Request"),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let{buildId:W,query:X,params:Y,pageIsDynamic:Z,buildManifest:$,nextFontManifest:_,reactLoadableManifest:aa,serverActionsManifest:ab,clientReferenceManifest:ac,subresourceIntegrityManifest:ad,prerenderManifest:ae,isDraftMode:af,resolvedPathname:ag,revalidateOnlyGenerated:ah,routerServerContext:ai,nextConfig:aj,parsedUrl:ak,interceptionRoutePatterns:al,deploymentId:am,clientAssetToken:an}=V,ao=(0,q.normalizeAppPath)(U),{isOnDemandRevalidate:ap}=V,aq=aj.experimental.ppr&&!aj.cacheComponents&&(0,I.isInterceptionRouteAppPath)(ag)?null:N.match(ag,ae),ar=(null==aq?void 0:aq.route)??null,as=!!ae.routes[ag],at=a.headers["user-agent"]||"",au=(0,t.getBotType)(at),av=(0,p.isHtmlBotRequest)(a),aw=(0,h.getRequestMeta)(a,"isPrefetchRSCRequest")??"1"===a.headers[s.NEXT_ROUTER_PREFETCH_HEADER],ax=(0,h.getRequestMeta)(a,"isRSCRequest")??!!a.headers[s.RSC_HEADER],ay=(0,r.getIsPossibleServerAction)(a),az=(0,m.checkIsAppPPREnabled)(aj.experimental.ppr),aA=a.headers[x.NEXT_RESUME_STATE_LENGTH_HEADER];if(!(0,h.getRequestMeta)(a,"postponed")&&T&&az&&ay&&aA&&"string"==typeof aA){let e=parseInt(aA,10),{maxPostponedStateSize:f,maxPostponedStateSizeBytes:g}=(0,D.getMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize);if(!isNaN(e)&&e>0){if(e>g)return b.statusCode=413,b.end((0,D.getPostponedStateExceededErrorMessage)(f)),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let i="1 MB",j=(null==(S=aj.experimental.serverActions)?void 0:S.bodySizeLimit)??i,k=e+(j!==i?c(66716).parse(j):1048576),l=await (0,D.readBodyWithSizeLimit)(a,k);if(null===l)return b.statusCode=413,b.end("Request body exceeded limit. To configure the body size limit for Server Actions, see: https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit"),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;if(l.length>=e){let b=l.subarray(0,e).toString("utf8");(0,h.addRequestMeta)(a,"postponed",b);let c=l.subarray(e);(0,h.addRequestMeta)(a,"actionBody",c)}else throw Object.defineProperty(Error(`invariant: expected ${e} bytes of postponed state but only received ${l.length} bytes`),"__NEXT_ERROR_CODE",{value:"E979",enumerable:!1,configurable:!0})}}if(!(0,h.getRequestMeta)(a,"postponed")&&az&&"1"===a.headers[x.NEXT_RESUME_HEADER]&&"POST"===a.method){let{maxPostponedStateSize:c,maxPostponedStateSizeBytes:e}=(0,D.getMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize),f=await (0,D.readBodyWithSizeLimit)(a,e);if(null===f)return b.statusCode=413,b.end((0,D.getPostponedStateExceededErrorMessage)(c)),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let g=f.toString("utf8");(0,h.addRequestMeta)(a,"postponed",g)}let aB=!0===N.isDev||!0===aj.experimental.exposeTestingApiInProductionBuild,aC=aB&&("1"===a.headers[s.NEXT_INSTANT_PREFETCH_HEADER]||void 0===a.headers[s.RSC_HEADER]&&"string"==typeof a.headers.cookie&&a.headers.cookie.includes(s.NEXT_INSTANT_TEST_COOKIE+"=")),aD=(az||aC)&&((null==(K=ae.routes[ao]??ae.dynamicRoutes[ao])?void 0:K.renderingMode)==="PARTIALLY_STATIC"||aC&&(aB||(null==ai?void 0:ai.experimentalTestProxy)===!0)),aE=aC&&aD,aF=aE&&!0===N.isDev,aG=!1,aH=aD?(0,h.getRequestMeta)(a,"postponed"):void 0,aI=null==(P=ae.routes[ag])?void 0:P.prefetchDataRoute,aJ=aD&&ax&&!aw&&!aI;T&&(aJ=aJ&&!!aH);let aK=(0,h.getRequestMeta)(a,"segmentPrefetchRSCRequest"),aL=(!au||!aD)&&(!at||(0,p.shouldServeStreamingMetadata)(at,aj.htmlLimitedBots)),aM=!!((ar||as||ae.routes[ao])&&!(au&&aD)),aN=aD&&!0===aj.cacheComponents,aO=!0===N.isDev||!aM||"string"==typeof aH||(aN&&(0,h.getRequestMeta)(a,"onCacheEntryV2")?aJ&&!T:aJ),aP=!!au&&aD,aQ=(null==ar?void 0:ar.remainingPrerenderableParams)??[],aR=(null==ar?void 0:ar.fallback)===null&&((null==(Q=ar.fallbackRootParams)?void 0:Q.length)??0)>0,aS=null;if(!af&&aM&&!aO&&!ay&&!aH&&!aJ){let a=aq?"string"==typeof(null==ar?void 0:ar.fallback)?ar.fallback:aq.source:null;if(!0===aj.experimental.partialFallbacks&&a&&(null==ar?void 0:ar.fallbackRouteParams)&&!aR){if(aQ.length>0){let b,c=(b=new Map(aQ.map(a=>[a.paramName,a])),a.split("/").map(a=>{let c=(0,J.getSegmentParam)(a);if(!c)return a;let d=b.get(c.paramName);if(!d)return a;let e=null==Y?void 0:Y[d.paramName];if(!e)return a;let f=Array.isArray(e)?e.map(a=>encodeURIComponent(a)).join("/"):encodeURIComponent(e);return a.replace(function(a){let{repeat:b,optional:c}=(0,J.getParamProperties)(a.paramType);return c?`[[...${a.paramName}]]`:b?`[...${a.paramName}]`:`[${a.paramName}]`}(d),f)}).join("/")||"/");aS=c!==a?c:null}}else aS=ag}let aT=aS;!aT&&(N.isDev||aM&&Z&&(null==ar?void 0:ar.fallbackRouteParams)&&!ay)&&(aT=ag),N.isDev||af||!aM||!ax||aJ||(0,k.d)(a.headers);let aU={...E,tree:L,handler:O,routeModule:N,__next_app__:M};ab&&ac&&(0,o.setManifestsSingleton)({page:U,clientReferenceManifest:ac,serverActionsManifest:ab});let aV=a.method||"GET",aW=(0,g.getTracer)(),aX=aW.getActiveScopeSpan(),aY=!!(null==ai?void 0:ai.isWrappedByNextServer),aZ=!0===aj.experimental.partialFallbacks&&aQ.length>0?(null==ar||null==(R=ar.fallbackRouteParams)?void 0:R.filter(a=>!aQ.some(b=>b.paramName===a.paramName)))??[]:[],a$=async()=>((null==ai?void 0:ai.render404)?await ai.render404(a,b,ak,!1):b.end("This page could not be found"),null);try{let k,m=N.getVaryHeader(ag,al);b.setHeader("Vary",m);let o=async(c,d)=>{let e=new l.NodeNextRequest(a),f=new l.NodeNextResponse(b);return N.render(e,f,d).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let a=aW.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==i.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let d=a.get("next.route");if(d){let a=`${aV} ${d}`;c.setAttributes({"next.route":d,"http.route":d,"next.span_name":a}),c.updateName(a),k&&k!==c&&(k.setAttribute("http.route",d),k.updateName(a))}else c.updateName(`${aV} ${U}`)})},p=(0,h.getRequestMeta)(a,"incrementalCache")||await N.getIncrementalCache(a,aj,ae,T);null==p||p.resetRequestCache(),globalThis.__incrementalCache=p;let q=async({span:e,postponed:f,fallbackRouteParams:g,forceStaticRender:i})=>{let k={query:X,params:Y,page:ao,sharedContext:{buildId:W,deploymentId:am,clientAssetToken:an},serverComponentsHmrCache:(0,h.getRequestMeta)(a,"serverComponentsHmrCache"),fallbackRouteParams:g,renderOpts:{App:()=>null,Document:()=>null,pageConfig:{},ComponentMod:aU,Component:(0,j.T)(aU),params:Y,routeModule:N,page:U,postponed:f,shouldWaitOnAllReady:aP,serveStreamingMetadata:aL,supportsDynamicResponse:"string"==typeof f||aO,buildManifest:$,nextFontManifest:_,reactLoadableManifest:aa,subresourceIntegrityManifest:ad,setCacheStatus:null==ai?void 0:ai.setCacheStatus,setIsrStatus:null==ai?void 0:ai.setIsrStatus,setReactDebugChannel:null==ai?void 0:ai.setReactDebugChannel,sendErrorsToBrowser:null==ai?void 0:ai.sendErrorsToBrowser,dir:c(33873).join(process.cwd(),N.relativeProjectDir),isDraftMode:af,botType:au,isOnDemandRevalidate:ap,isPossibleServerAction:ay,assetPrefix:aj.assetPrefix,nextConfigOutput:aj.output,crossOrigin:aj.crossOrigin,trailingSlash:aj.trailingSlash,images:aj.images,previewProps:ae.preview,enableTainting:aj.experimental.taint,htmlLimitedBots:aj.htmlLimitedBots,reactMaxHeadersLength:aj.reactMaxHeadersLength,multiZoneDraftMode:!1,incrementalCache:p,cacheLifeProfiles:aj.cacheLife,basePath:aj.basePath,serverActions:aj.experimental.serverActions,logServerFunctions:"object"==typeof aj.logging&&!!aj.logging.serverFunctions,...aE||aF||aG?{isBuildTimePrerendering:!0,supportsDynamicResponse:!1,isStaticGeneration:!0,isDebugDynamicAccesses:aF}:{},cacheComponents:!!aj.cacheComponents,experimental:{isRoutePPREnabled:aD,expireTime:aj.expireTime,staleTimes:aj.experimental.staleTimes,dynamicOnHover:!!aj.experimental.dynamicOnHover,optimisticRouting:!!aj.experimental.optimisticRouting,inlineCss:!!aj.experimental.inlineCss,prefetchInlining:aj.experimental.prefetchInlining??!1,authInterrupts:!!aj.experimental.authInterrupts,cachedNavigations:!!aj.experimental.cachedNavigations,clientTraceMetadata:aj.experimental.clientTraceMetadata||[],clientParamParsingOrigins:aj.experimental.clientParamParsingOrigins,maxPostponedStateSizeBytes:(0,C.parseMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize)},waitUntil:d.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:()=>{},onInstrumentationRequestError:(b,c,d,e)=>N.onRequestError(a,b,d,e,ai),err:(0,h.getRequestMeta)(a,"invokeError")}};i&&(k.renderOpts.supportsDynamicResponse=!1);let l=await o(e,k),{metadata:m}=l,{cacheControl:n,headers:q={},fetchTags:r,fetchMetrics:s}=m;if(r&&(q[x.NEXT_CACHE_TAGS_HEADER]=r),a.fetchMetrics=s,aM&&(null==n?void 0:n.revalidate)===0&&!N.isDev&&!aD){let a=m.staticBailoutInfo,b=Object.defineProperty(Error(`Page changed from static to dynamic at runtime ${ag}${(null==a?void 0:a.description)?`, reason: ${a.description}`:""}
see more here https://nextjs.org/docs/messages/app-static-to-dynamic-error`),"__NEXT_ERROR_CODE",{value:"E132",enumerable:!1,configurable:!0});if(null==a?void 0:a.stack){let c=a.stack;b.stack=b.message+c.substring(c.indexOf("\n"))}throw b}return{value:{kind:u.CachedRouteKind.APP_PAGE,html:l,headers:q,rscData:m.flightData,postponed:m.postponed,status:m.statusCode,segmentData:m.segmentData},cacheControl:n}},r=async({hasResolved:c,previousCacheEntry:g,isRevalidating:i,span:j,forceStaticRender:k=!1})=>{let l=!1===N.isDev,m=c||b.writableEnded;try{let f;if(ap&&ah&&!g&&!T)return(null==ai?void 0:ai.render404)?await ai.render404(a,b):(b.statusCode=404,b.end("This page could not be found")),null;if(ar&&(f=(0,v.parseFallbackField)(ar.fallback)),!0===aj.experimental.partialFallbacks&&(null==ar?void 0:ar.fallback)===null&&!aR&&aQ.length>0&&(f=v.FallbackMode.PRERENDER),f===v.FallbackMode.PRERENDER&&(0,t.isBot)(at)&&(!aD||av)&&(f=v.FallbackMode.BLOCKING_STATIC_RENDER),(null==g?void 0:g.isStale)===-1&&(ap=!0),ap&&(f!==v.FallbackMode.NOT_FOUND||g)&&(f=v.FallbackMode.BLOCKING_STATIC_RENDER),!T&&f!==v.FallbackMode.BLOCKING_STATIC_RENDER&&aT&&!m&&!af&&Z&&(l||!as)){if((l||ar)&&f===v.FallbackMode.NOT_FOUND){if(aj.adapterPath)return await a$();throw new B.NoFallbackError}if(aD&&(aj.cacheComponents?!aJ:!ax)){let b=l&&"string"==typeof(null==ar?void 0:ar.fallback)?ar.fallback:ao,f=(l||aE)&&(null==ar?void 0:ar.fallbackRouteParams)?(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams):aG?(0,n.getFallbackRouteParams)(ao,N):null;aE&&f&&(0,h.addRequestMeta)(a,"fallbackParams",f);let g=await N.handleResponse({cacheKey:b,req:a,nextConfig:aj,routeKind:e.RouteKind.APP_PAGE,isFallback:!0,prerenderManifest:ae,isRoutePPREnabled:aD,responseGenerator:async()=>q({span:j,postponed:void 0,fallbackRouteParams:f,forceStaticRender:!0}),waitUntil:d.waitUntil,isMinimalMode:T});if(null===g)return null;if(g)return T||!aD||!(aQ.length>0)||!0!==aj.experimental.partialFallbacks||!aS||!p||ap||aG||aB||aC||aw||(0,H.scheduleOnNextTick)(async()=>{let b=N.getResponseCache(a);try{await b.revalidate(aS,p,aD,!1,a=>q({span:a.span,postponed:void 0,fallbackRouteParams:aZ.length>0?(0,n.createOpaqueFallbackRouteParams)(aZ):null,forceStaticRender:!0}),null,c,d.waitUntil)}catch(a){console.error("Error revalidating the page in the background",a)}}),delete g.cacheControl,g}}let o=ap||i||!aH?void 0:aH;if(aN&&!T&&p&&(aJ||ay)&&!k){let b=await p.get(ag,{kind:u.IncrementalCacheKind.APP_PAGE,isRoutePPREnabled:!0,isFallback:!1});b&&b.value&&b.value.kind===u.CachedRouteKind.APP_PAGE&&(o=b.value.postponed,b&&(-1===b.isStale||!0===b.isStale)&&(0,H.scheduleOnNextTick)(async()=>{let b=N.getResponseCache(a);try{await b.revalidate(ag,p,aD,!1,a=>r({...a,forceStaticRender:!0}),null,c,d.waitUntil)}catch(a){console.error("Error revalidating the page in the background",a)}}))}if((aE||aF)&&void 0!==o)return{cacheControl:{revalidate:1,expire:void 0},value:{kind:u.CachedRouteKind.PAGES,html:w.default.EMPTY,pageData:{},headers:void 0,status:void 0}};let s=(l&&(0,h.getRequestMeta)(a,"renderFallbackShell")||aE&&!as)&&(null==ar?void 0:ar.fallbackRouteParams)?(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams):aG?(0,n.getFallbackRouteParams)(ao,N):null;if((l||aE)&&aj.cacheComponents&&!as&&(null==ar?void 0:ar.fallbackRouteParams)){let b=(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams);b&&(0,h.addRequestMeta)(a,"fallbackParams",b)}return q({span:j,postponed:o,fallbackRouteParams:s,forceStaticRender:k})}catch(b){throw(null==g?void 0:g.isStale)&&await N.onRequestError(a,b,{routerKind:"App Router",routePath:U,routeType:"render",revalidateReason:(0,f.c)({isStaticGeneration:aM,isOnDemandRevalidate:ap})},!1,ai),b}},D=async c=>{var f,g,i,j,k;let l,m=await N.handleResponse({cacheKey:aS,responseGenerator:a=>r({span:c,...a}),routeKind:e.RouteKind.APP_PAGE,isOnDemandRevalidate:ap,isRoutePPREnabled:aD,req:a,nextConfig:aj,prerenderManifest:ae,waitUntil:d.waitUntil,isMinimalMode:T});if(af&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate"),N.isDev&&b.setHeader("Cache-Control","no-cache, must-revalidate"),!m){if(aS)throw Object.defineProperty(Error("invariant: cache entry required but not generated"),"__NEXT_ERROR_CODE",{value:"E62",enumerable:!1,configurable:!0});return null}if((null==(f=m.value)?void 0:f.kind)!==u.CachedRouteKind.APP_PAGE)throw Object.defineProperty(Error(`Invariant app-page handler received invalid cache entry ${null==(i=m.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E707",enumerable:!1,configurable:!0});let n="string"==typeof m.value.postponed;ax&&!ay&&am&&b.setHeader(x.NEXT_NAV_DEPLOYMENT_ID_HEADER,am),aM&&!aJ&&(!n||aw)&&(T||b.setHeader("x-nextjs-cache",ap?"REVALIDATED":m.isMiss?"MISS":m.isStale?"STALE":"HIT"),b.setHeader(s.NEXT_IS_PRERENDER_HEADER,"1"));let{value:o}=m;if(aH)l={revalidate:0,expire:void 0};else if(aJ)l={revalidate:0,expire:void 0};else if(!N.isDev)if(af)l={revalidate:0,expire:void 0};else if(aM){if(m.cacheControl)if("number"==typeof m.cacheControl.revalidate){if(m.cacheControl.revalidate<1)throw Object.defineProperty(Error(`Invalid revalidate configuration provided: ${m.cacheControl.revalidate} < 1`),"__NEXT_ERROR_CODE",{value:"E22",enumerable:!1,configurable:!0});l={revalidate:m.cacheControl.revalidate,expire:(null==(j=m.cacheControl)?void 0:j.expire)??aj.expireTime}}else l={revalidate:x.CACHE_ONE_YEAR_SECONDS,expire:void 0}}else b.getHeader("Cache-Control")||(l={revalidate:0,expire:void 0});if(m.cacheControl=l,"string"==typeof aK&&(null==o?void 0:o.kind)===u.CachedRouteKind.APP_PAGE&&o.segmentData){b.setHeader(s.NEXT_DID_POSTPONE_HEADER,"2");let c=null==(k=o.headers)?void 0:k[x.NEXT_CACHE_TAGS_HEADER];T&&aM&&c&&"string"==typeof c&&b.setHeader(x.NEXT_CACHE_TAGS_HEADER,c);let d=o.segmentData.get(aK);return void 0!==d?(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.fromStatic(d,s.RSC_CONTENT_TYPE_HEADER),cacheControl:m.cacheControl}):(b.statusCode=204,(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.EMPTY,cacheControl:m.cacheControl}))}let p=aN?(0,h.getRequestMeta)(a,"onCacheEntryV2")??(0,h.getRequestMeta)(a,"onCacheEntry"):(0,h.getRequestMeta)(a,"onCacheEntry");if(p&&await p(m,{url:(0,h.getRequestMeta)(a,"initURL")??a.url}))return null;if(o.headers){let a={...o.headers};for(let[c,d]of(T&&aM||delete a[x.NEXT_CACHE_TAGS_HEADER],Object.entries(a)))if(void 0!==d)if(Array.isArray(d))for(let a of d)b.appendHeader(c,a);else"number"==typeof d&&(d=d.toString()),b.appendHeader(c,d)}let t=null==(g=o.headers)?void 0:g[x.NEXT_CACHE_TAGS_HEADER];if(T&&aM&&t&&"string"==typeof t&&b.setHeader(x.NEXT_CACHE_TAGS_HEADER,t),!o.status||ax&&aD||(b.statusCode=o.status),!T&&o.status&&F.RedirectStatusCode[o.status]&&ax&&(b.statusCode=200),n&&!aJ&&b.setHeader(s.NEXT_DID_POSTPONE_HEADER,"1"),ax&&!af){if(void 0===o.rscData){if(o.html.contentType!==s.RSC_CONTENT_TYPE_HEADER)if(aj.cacheComponents)return b.statusCode=404,(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.EMPTY,cacheControl:m.cacheControl});else throw Object.defineProperty(new G.InvariantError(`Expected RSC response, got ${o.html.contentType}`),"__NEXT_ERROR_CODE",{value:"E789",enumerable:!1,configurable:!0});return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:o.html,cacheControl:m.cacheControl})}return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.fromStatic(o.rscData,s.RSC_CONTENT_TYPE_HEADER),cacheControl:m.cacheControl})}let v=o.html;if(aC&&aE){let c=!0===N.isDev?crypto.randomUUID():null;return v.pipeThrough((0,z.createInstantTestScriptInsertionTransformStream)(c)),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}})}if(!n||T||ax)return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:m.cacheControl});if(aE||aF)return v.push(new ReadableStream({start(a){a.enqueue(y.ENCODED_TAGS.CLOSED.BODY_AND_HTML),a.close()}})),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}});let B=new TransformStream;return v.push(B.readable),q({span:c,postponed:o.postponed,fallbackRouteParams:null,forceStaticRender:!1}).then(async a=>{var b,c;if(!a)throw Object.defineProperty(Error("Invariant: expected a result to be returned"),"__NEXT_ERROR_CODE",{value:"E463",enumerable:!1,configurable:!0});if((null==(b=a.value)?void 0:b.kind)!==u.CachedRouteKind.APP_PAGE)throw Object.defineProperty(Error(`Invariant: expected a page response, got ${null==(c=a.value)?void 0:c.kind}`),"__NEXT_ERROR_CODE",{value:"E305",enumerable:!1,configurable:!0});await a.value.html.pipeTo(B.writable)}).catch(a=>{B.writable.abort(a).catch(a=>{console.error("couldn't abort transformer",a)})}),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}})};if(!aY||!aX)return k=aW.getActiveScopeSpan(),await aW.withPropagatedContext(a.headers,()=>aW.trace(i.BaseServerSpan.handleRequest,{spanName:`${aV} ${U}`,kind:g.SpanKind.SERVER,attributes:{"http.method":aV,"http.target":a.url}},D),void 0,!aY);await D(aX)}catch(b){throw b instanceof B.NoFallbackError||await N.onRequestError(a,b,{routerKind:"App Router",routePath:U,routeType:"render",revalidateReason:(0,f.c)({isStaticGeneration:aM,isOnDemandRevalidate:ap})},!1,ai),b}}}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[1042,375,8672,978,2114],()=>b(b.s=93962));module.exports=c})();