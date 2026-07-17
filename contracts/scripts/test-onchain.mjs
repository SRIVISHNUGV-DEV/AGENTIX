import { ethers } from "ethers"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import crypto from "crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")

const deployPath = path.resolve(__dirname, "..", "deploy-output.json")
const envPath = path.resolve(__dirname, "..", ".env")

const env = fs.readFileSync(envPath, "utf-8").split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=")
  if (k && v.length) acc[k.trim()] = v.join("=").trim()
  return acc
}, {})

const { RPC_URL, PRIVATE_KEY } = env
const deployData = JSON.parse(fs.readFileSync(deployPath, "utf-8"))
const contracts = deployData.contracts

const provider = new ethers.JsonRpcProvider(RPC_URL)
const signer = new ethers.Wallet(PRIVATE_KEY, provider)

const registryABI = [
  "function activeRoot() view returns (bytes32)",
  "function revokedSecretRoot() view returns (bytes32)",
  "function updateActiveRoot(bytes32) external",
  "function updateRevokedSecretRoot(bytes32) external",
  "function markNullifierUsed(bytes32) external",
  "function isNullifierUsed(bytes32) view returns (bool)",
  "function issuers(address) view returns (bool)",
  "function sessionManagers(address) view returns (bool)",
  "function setSessionManager(address,bool) external",
]
const sessionABI = [
  "function createSession(bytes32,address,address,uint128,uint64,uint256[2],uint256[2][2],uint256[2],uint256[7]) external",
  "function sessions(bytes32) view returns (address,address,uint256,uint256,uint64,bool)",
]

async function main() {
  console.log("=== On-Chain Verification Test ===\n")

  // Load circomlibjs
  const circomlibjs = await import("circomlibjs")
  const { buildPoseidon, newMemEmptyTrie } = circomlibjs
  const snarkjs = await import("snarkjs")
  const { groth16 } = snarkjs

  const poseidon = await buildPoseidon()
  const F = poseidon.F

  // --- 1. Generate test credential ---
  const agentId = 1n
  const orgId = 1n
  const permissions = 255n
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + 86400n // 24h
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex"))
  const sessionNonce = BigInt(Math.floor(Date.now() / 1000))
  const maxValue = 100n
  const sessionExpiry = expiry

  const commitment = BigInt(F.toString(poseidon([agentId, orgId, permissions, expiry, secret])))
  const secretHash = BigInt(F.toString(poseidon([secret, 0n])))
  const revocationKey = secretHash % (1n << 20n)

  console.log("Credential:")
  console.log("  agentId:", agentId.toString())
  console.log("  orgId:", orgId.toString())
  console.log("  commitment:", commitment.toString())
  console.log("  secretHash:", secretHash.toString())
  console.log("  revocationKey:", revocationKey.toString())

  // --- 2. Build Merkle tree (matching circuit test convention) ---
  const depth = 20
  let current = commitment
  const pathElements = []
  const pathIndices = []

  for (let i = 0; i < depth; i++) {
    pathElements.push("0")
    pathIndices.push(0)
    current = BigInt(F.toString(poseidon([current, 0n])))
  }
  const activeRoot = current

  console.log("\nMerkle Tree:")
  console.log("  root:", activeRoot.toString())

  // --- 3. Build empty SMT ---
  const revokedTree = await newMemEmptyTrie()
  const revokedResult = await revokedTree.find(revocationKey)
  const revokedSiblings = revokedResult.siblings.map((sibling) =>
    revokedTree.F.toString(sibling)
  )
  while (revokedSiblings.length < depth) {
    revokedSiblings.push("0")
  }
  const revokedRoot = BigInt(revokedTree.F.toString(revokedTree.root))

  console.log("Revocation Tree:")
  console.log("  root:", revokedRoot.toString())

  // --- 4. Generate real Groth16 proof ---
  const circuitDir = path.resolve(ROOT, "mcp-test", "circuits")
  const wasmPath = path.resolve(circuitDir, "credential_js", "credential.wasm")
  const zkeyPath = path.resolve(circuitDir, "credential_final.zkey")

  if (!fs.existsSync(wasmPath)) throw new Error("WASM not found at " + wasmPath)
  if (!fs.existsSync(zkeyPath)) throw new Error("ZKEY not found at " + zkeyPath)

  const input = {
    agentId: agentId.toString(),
    orgId: orgId.toString(),
    permissions: permissions.toString(),
    expiry: expiry.toString(),
    secret: secret.toString(),
    sessionNonce: sessionNonce.toString(),
    activePathElements: pathElements,
    activePathIndices: pathIndices,
    revokedSiblings,
    revokedOldKey: revokedResult.isOld0 ? "0" : revokedTree.F.toString(revokedResult.notFoundKey),
    revokedOldValue: revokedResult.isOld0 ? "0" : revokedTree.F.toString(revokedResult.notFoundValue),
    revokedIsOld0: revokedResult.isOld0 ? 1 : 0,
    activeRoot: activeRoot.toString(),
    revokedRoot: revokedRoot.toString(),
    maxValue: maxValue.toString(),
    sessionExpiry: sessionExpiry.toString(),
  }

  console.log("\nGenerating proof...")
  const startTime = Date.now()
  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath)
  const proofTime = Date.now() - startTime
  console.log(`Proof generated in ${proofTime}ms`)
  console.log("Public signals:", publicSignals)

  // publicSignals layout: [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier]
  const nullifier = publicSignals[6]
  console.log("Nullifier:", nullifier)

  // --- 5. Verify off-chain with snarkjs ---
  const vkPath = path.resolve(ROOT, "circuits", "build", "verification_key.json")
  const vk = JSON.parse(fs.readFileSync(vkPath, "utf-8"))
  const valid = await groth16.verify(vk, publicSignals, proof)
  console.log("\nOff-chain verification:", valid ? "PASSED" : "FAILED")
  if (!valid) throw new Error("Proof does not verify off-chain")

  // --- 6. Check on-chain state ---
  const registry = new ethers.Contract(contracts.credentialRegistry.proxy, registryABI, signer)
  const sessionMgr = new ethers.Contract(contracts.sessionManager.proxy, sessionABI, signer)

  const [onChainActiveRoot, onChainRevokedRoot] = await Promise.all([
    registry.activeRoot(),
    registry.revokedSecretRoot(),
  ])

  console.log("\nOn-chain state:")
  console.log("  Active root:", onChainActiveRoot)
  console.log("  Revoked root:", onChainRevokedRoot)

  // --- 7. Update on-chain roots ---
  const activeRootHex = ethers.toBeHex(activeRoot, 32)
  const revokedRootHex = ethers.toBeHex(revokedRoot, 32)

  if (onChainActiveRoot !== activeRootHex) {
    console.log("\nUpdating activeRoot on-chain...")
    const tx1 = await registry.updateActiveRoot(activeRootHex)
    const r1 = await tx1.wait()
    console.log("  tx:", r1.hash, "block:", r1.blockNumber)
  } else {
    console.log("\nActive root already matches")
  }

  if (onChainRevokedRoot !== revokedRootHex) {
    console.log("Updating revokedSecretRoot on-chain...")
    const tx2 = await registry.updateRevokedSecretRoot(revokedRootHex)
    const r2 = await tx2.wait()
    console.log("  tx:", r2.hash, "block:", r2.blockNumber)
  } else {
    console.log("Revoked root already matches")
  }

  // --- 8. Create wallet and submit session on-chain ---
  const factoryABI = [
    "function createWallet(address) external returns (address)",
    "function isAgentWallet(address) view returns (bool)",
  ]
  const factory = new ethers.Contract(contracts.agentWalletFactory.proxy, factoryABI, signer)

  console.log("\nCreating wallet...")
  const walletTx = await factory.createWallet(signer.address)
  const walletReceipt = await walletTx.wait()
  // Parse WalletCreated event to get wallet address
  let walletAddress = ""
  for (const log of walletReceipt.logs) {
    try {
      const parsed = factory.interface.parseLog(log)
      if (parsed?.name === "WalletCreated") {
        walletAddress = parsed.args.wallet
        break
      }
    } catch {}
  }
  if (!walletAddress) throw new Error("WalletCreated event not found")
  console.log("  Wallet:", walletAddress)

  // Build publicSignals[5] = wallet address (as uint160 cast to uint256)
  const walletAsSignal = BigInt(walletAddress)

  const sessionId = ethers.hexlify(ethers.randomBytes(32))
  const sessionKey = ethers.Wallet.createRandom().address

  // Format proof for Solidity — publicSignals must be [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier]
  const a = [proof.pi_a[0], proof.pi_a[1]]
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ]
  const c = [proof.pi_c[0], proof.pi_c[1]]

  // Reconstruct publicSignals with wallet address injected at index 4
  const fullPublicSignals = [
    BigInt(publicSignals[0]), // activeRoot
    BigInt(publicSignals[1]), // revokedRoot
    maxValue,                // maxValue
    sessionExpiry,           // sessionExpiry
    walletAsSignal,          // wallet
    1n,                      // credentialVersion
    BigInt(nullifier),       // nullifier
  ]

  console.log("\nSubmitting session on-chain...")
  console.log("  sessionId:", sessionId)
  console.log("  wallet:", walletAddress)
  console.log("  sessionKey:", sessionKey)
  console.log("  maxValue:", maxValue.toString())
  console.log("  expiry:", sessionExpiry.toString())
  console.log("  nullifier:", ethers.toBeHex(BigInt(nullifier), 32))

  // createSession(sessionId, wallet, sessionKey, maxValue, expiry, a, b, c, publicSignals)
  const gasLimit = 500000n
  const tx3 = await sessionMgr.createSession(
    sessionId,
    walletAddress,
    sessionKey,
    maxValue,
    sessionExpiry,
    a, b, c,
    fullPublicSignals,
    { gasLimit }
  )
  const r3 = await tx3.wait()
  console.log("\nSession submitted!")
  console.log("  tx:", r3.hash)
  console.log("  block:", r3.blockNumber)
  console.log("  gasUsed:", r3.gasUsed.toString())

  // --- 9. Verify session exists ---
  const session = await sessionMgr.sessions(sessionId)
  console.log("\nSession on-chain:")
  console.log("  wallet:", session[0])
  console.log("  sessionKey:", session[1])
  console.log("  valueUsed:", session[2].toString())
  console.log("  maxValue:", session[3].toString())
  console.log("  expiry:", session[4].toString())
  console.log("  revoked:", session[5])

  if (!session[5] && session[1] !== ethers.ZeroAddress) {
    console.log("\nON-CHAIN VERIFICATION PASSED!")
  } else {
    console.log("\nSession not active on-chain")
  }

  // --- 10. Verify nullifier is marked used ---
  const nullifierHex = ethers.toBeHex(BigInt(nullifier), 32)
  const nullifierUsed = await registry.isNullifierUsed(nullifierHex)
  console.log("\nNullifier used:", nullifierUsed)
}

main().catch((e) => {
  console.error("\nError:", e.message)
  process.exit(1)
})
