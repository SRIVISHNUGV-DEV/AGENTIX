import { ethers } from "ethers"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "..", ".env")
const deployPath = path.resolve(__dirname, "..", "deploy-output.json")

// Load env
const env = fs.readFileSync(envPath, "utf-8").split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=")
  if (k && v.length) acc[k.trim()] = v.join("=").trim()
  return acc
}, {})

const { RPC_URL, PRIVATE_KEY } = env
const deployData = JSON.parse(fs.readFileSync(deployPath, "utf-8"))

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer = new ethers.Wallet(PRIVATE_KEY, provider)

  const registryABI = [
    "function activeRoot() view returns (bytes32)",
    "function revokedSecretRoot() view returns (bytes32)",
    "function issuer() view returns (address)",
    "function nullifierUsed(bytes32) view returns (bool)",
    "function updateActiveRoot(bytes32) external",
    "function updateRevokedSecretRoot(bytes32) external",
    "function setSessionManager(address,bool) external",
  ]
  const verifierABI = [
    "function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[5]) view returns (bool)",
  ]
  const sessionABI = [
    "function createSession(bytes32,address,uint128,uint64,bytes32,uint256[2],uint256[2][2],uint256[2],uint256[5]) external",
    "function sessions(bytes32) view returns (address,uint128,uint64,address,bool)",
  ]

  const registry = new ethers.Contract(deployData.credentialRegistry, registryABI, signer)
  const verifier = new ethers.Contract(deployData.verifier, verifierABI, provider)
  const sessionMgr = new ethers.Contract(deployData.sessionManager, sessionABI, signer)

  const [activeRoot, revokedRoot, issuer] = await Promise.all([
    registry.activeRoot(),
    registry.revokedSecretRoot(),
    registry.issuer(),
  ])

  console.log("Deployer:", deployData.deployer)
  console.log("Signer:", await signer.getAddress())
  console.log("Issuer:", issuer)
  console.log("Active root:", activeRoot)
  console.log("Revoked root:", revokedRoot)
  console.log("Active root is zero:", activeRoot === ethers.ZeroHash)
  console.log("Revoked root is zero:", revokedRoot === ethers.ZeroHash)

  // Check deployer balance
  const bal = await provider.getBalance(deployData.deployer)
  console.log("Balance:", ethers.formatEther(bal), "ETH")

  // Also query the sessions mapping for a dummy sessionId
  const dummyId = ethers.hexlify(ethers.randomBytes(32))
  const session = await sessionMgr.sessions(dummyId)
  console.log("Dummy session (should be empty):", session)
}

main().catch(console.error)
