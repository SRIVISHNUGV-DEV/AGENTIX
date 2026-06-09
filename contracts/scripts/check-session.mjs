import { ethers } from "ethers"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "..", ".env")
const deployPath = path.resolve(__dirname, "..", "deploy-output.json")

const env = fs.readFileSync(envPath, "utf-8").split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=")
  if (k && v.length) acc[k.trim()] = v.join("=").trim()
  return acc
}, {})
const deployData = JSON.parse(fs.readFileSync(deployPath, "utf-8"))

const provider = new ethers.JsonRpcProvider(env.RPC_URL)
const signer = new ethers.Wallet(env.PRIVATE_KEY, provider)

const sessionABI = [
  "function sessions(bytes32) view returns (address,uint256,uint256,uint64,bool)",
]
const registryABI = [
  "function activeRoot() view returns (bytes32)",
  "function isNullifierUsed(bytes32) view returns (bool)",
]

async function main() {
  const sessionMgr = new ethers.Contract(deployData.sessionManager, sessionABI, provider)
  const registry = new ethers.Contract(deployData.credentialRegistry, registryABI, provider)

  const sessionId = "0xd41289eec5b6364d4987c12fcd6077408a388dce6d814fe2b8fb97c7b39625f7"
  const nullifierHex = "0x210f103ade26ba0bb09cbbcde421e279fd30497ebf7bdc1621ffabbf9f262da2"

  const [session, nullifierUsed, activeRoot] = await Promise.all([
    sessionMgr.sessions(sessionId),
    registry.isNullifierUsed(nullifierHex),
    registry.activeRoot(),
  ])

  console.log("Active root:", activeRoot)
  console.log("Session:", session)
  console.log("  sessionKey:", session[0])
  console.log("  valueUsed:", session[1].toString())
  console.log("  maxValue:", session[2].toString())
  console.log("  expiry:", session[3].toString())
  console.log("  revoked:", session[4])
  console.log("Nullifier used:", nullifierUsed)
}

main().catch(console.error)
