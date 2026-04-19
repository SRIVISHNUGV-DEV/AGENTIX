const fs = require("fs");
const path = require("path");
const { ContractFactory, JsonRpcProvider, Wallet } = require("ethers");
const CHAIN_ID = Number(process.env.CHAIN_ID || "11155111");
const NETWORK_NAME = process.env.NETWORK_NAME || "sepolia";
const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../../backend/.env");
  const env = {};
  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }

  return env;
}

function artifact(name) {
  const hardhatArtifactPath = resolveHardhatArtifactPath(name);
  const directAbiPath = path.resolve(__dirname, `../${name}.abi`);
  const directBinPath = path.resolve(__dirname, `../${name}.bin`);
  const nestedAbiPath = path.resolve(__dirname, `../contracts_${name}.abi`);
  const nestedBinPath = path.resolve(__dirname, `../contracts_${name}.bin`);

  if (hardhatArtifactPath && fs.existsSync(hardhatArtifactPath)) {
    const compiled = JSON.parse(fs.readFileSync(hardhatArtifactPath, "utf8"));
    return {
      abi: compiled.abi,
      bytecode: compiled.bytecode
    };
  }

  const abiPath = fs.existsSync(directAbiPath) ? directAbiPath : nestedAbiPath;
  const binPath = fs.existsSync(directBinPath) ? directBinPath : nestedBinPath;

  return {
    abi: JSON.parse(fs.readFileSync(abiPath, "utf8")),
    bytecode: `0x${fs.readFileSync(binPath, "utf8").trim()}`
  };
}

function resolveHardhatArtifactPath(name) {
  const match = /^(.+)_([^_]+)_sol_(.+)$/.exec(name);
  if (!match) {
    return null;
  }

  const [, sourceGroup, sourceName, contractName] = match;
  return path.resolve(__dirname, `../artifacts/${sourceGroup}/${sourceName}.sol/${contractName}.json`);
}

async function deploy(contractName, signer, args = []) {
  const { abi, bytecode } = artifact(contractName);
  const factory = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function main() {
  const env = loadEnv();
  const provider = new JsonRpcProvider(
    env.RPC_URL,
    { chainId: CHAIN_ID, name: NETWORK_NAME },
    { staticNetwork: true }
  );
  const signer = new Wallet(env.PRIVATE_KEY, provider);

  const verifier = await deploy("src_Verifier_sol_Groth16Verifier", signer);
  const registry = await deploy("src_CredentialRegistry_sol_CredentialRegistry", signer);
  const sessionManager = await deploy(
    "src_SessionManager_sol_SessionManager",
    signer,
    [await verifier.getAddress(), await registry.getAddress()]
  );
  const walletImplementation = await deploy("src_AgentWallet_sol_AgentWallet", signer);
  const walletFactory = await deploy(
    "src_AgentWalletFactory_sol_AgentWalletFactory",
    signer,
    [await walletImplementation.getAddress(), await sessionManager.getAddress(), ENTRY_POINT_ADDRESS]
  );

  const registryWithSigner = new (require("ethers").Contract)(
    await registry.getAddress(),
    artifact("src_CredentialRegistry_sol_CredentialRegistry").abi,
    signer
  );

  await (await registryWithSigner.setSessionManager(
    await sessionManager.getAddress(),
    true
  )).wait();

  console.log(JSON.stringify({
    deployer: signer.address,
    verifier: await verifier.getAddress(),
    credentialRegistry: await registry.getAddress(),
    sessionManager: await sessionManager.getAddress(),
    agentWalletImplementation: await walletImplementation.getAddress(),
    agentWalletFactory: await walletFactory.getAddress(),
    entryPoint: ENTRY_POINT_ADDRESS
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
