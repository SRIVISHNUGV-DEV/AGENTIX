const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.resolve(__dirname, "../artifacts/src");
const OUTPUT_DIR = path.resolve(__dirname, "../abis");

const PRODUCTION_CONTRACTS = [
  "AgentIdentity",
  "AgentWallet",
  "AgentWalletFactory",
  "CapabilityRegistry",
  "CredentialRegistry",
  "DelegationManager",
  "Groth16Verifier",
  "OrganizationCredentialAnchor",
  "OrganizationRegistry",
  "SessionManager",
];

// Interfaces defined inline in contracts — hardhat generates artifacts for these
const INTERFACES = [
  "IAgentWallet",
  "ICredentialRegistry",
  "IAgentWalletFactory",
  "ISessionManager",
  "IVerifier",
  "IEntryPoint",
];

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function findArtifact(name) {
  for (const dir of fs.readdirSync(ARTIFACTS_DIR)) {
    const contractPath = path.join(ARTIFACTS_DIR, dir, `${name}.json`);
    if (fs.existsSync(contractPath)) {
      return contractPath;
    }
  }
  return null;
}

function extractAbi(contractName) {
  const artifactPath = findArtifact(contractName);
  if (!artifactPath) {
    console.error(`  SKIP: ${contractName} — artifact not found`);
    return null;
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

console.log("Extracting ABIs...\n");

const allAbis = {};

for (const name of PRODUCTION_CONTRACTS) {
  const abi = extractAbi(name);
  if (abi) {
    const outPath = path.join(OUTPUT_DIR, `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(abi, null, 2));
    console.log(`  ✓ ${name}.json (${abi.length} entries)`);
    allAbis[name] = { path: `abis/${name}.json`, entries: abi.length };
  }
}

console.log("\nExtracting interface ABIs...\n");

for (const name of INTERFACES) {
  const abi = extractAbi(name);
  if (abi) {
    const outPath = path.join(OUTPUT_DIR, `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(abi, null, 2));
    console.log(`  ✓ ${name}.json (${abi.length} entries)`);
    allAbis[name] = { path: `abis/${name}.json`, entries: abi.length };
  }
}

// Read OZ version from package.json to stay in sync
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const ozVersion = pkg.dependencies["@openzeppelin/contracts"];

const manifest = {
  generated: new Date().toISOString(),
  solcVersion: "0.8.24",
  openZeppelin: ozVersion,
  evmTarget: "paris",
  optimizer: { enabled: true, runs: 200 },
  contracts: allAbis,
};
fs.writeFileSync(
  path.join(OUTPUT_DIR, "MANIFEST.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(`\nDone — ${PRODUCTION_CONTRACTS.length} contracts + ${INTERFACES.length} interfaces`);
console.log(`Manifest: abis/MANIFEST.json`);
