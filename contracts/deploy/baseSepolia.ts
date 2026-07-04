import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ENTRY_POINT = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const PLACEHOLDER = "0x0000000000000000000000000000000000000001";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface DeploymentOutput {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    groth16Verifier: string;
    credentialRegistry: { proxy: string; implementation: string };
    organizationCredentialAnchor: string;
    organizationRegistry: { proxy: string; implementation: string };
    agentWalletImplementation: string;
    sessionManager: { proxy: string; implementation: string };
    agentWalletFactory: { proxy: string; implementation: string };
    capabilityRegistry: { proxy: string; implementation: string };
    delegationManager: { proxy: string; implementation: string };
    entryPoint: string;
  };
  configuration: {
    credentialRegistrySessionManager: boolean;
    factoryWalletFactoryProposed: boolean;
  };
}

function loadExisting(): DeploymentOutput | null {
  const p = path.join(__dirname, "..", "deploy-output.json");
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
  }
  return null;
}

function saveOutput(output: DeploymentOutput) {
  const p = path.join(__dirname, "..", "deploy-output.json");
  fs.writeFileSync(p, JSON.stringify(output, null, 2));
}

async function deployContract(name: string, args: any[], delayMs = 3000): Promise<any> {
  const F = await ethers.getContractFactory(name);
  const contract = await F.deploy(...args);
  await contract.waitForDeployment();
  await sleep(delayMs);
  return contract;
}

async function deployProxy(implAddr: string, initData: string, delayMs = 3000): Promise<any> {
  const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ProxyF.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  await sleep(delayMs);
  return proxy;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  const networkInfo = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("  AGENTIX V1 — BASE SEPOLIA DEPLOYMENT");
  console.log("=".repeat(60));
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(bal)} ETH`);
  console.log(`Chain ID:  ${networkInfo.chainId}\n`);

  const existing = loadExisting();
  const output: DeploymentOutput = existing || {
    network: network.name,
    chainId: Number(networkInfo.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {} as any,
    configuration: {
      credentialRegistrySessionManager: false,
      factoryWalletFactoryProposed: false,
    },
  };

  const c = output.contracts;

  // 1. Groth16Verifier
  if (!c.groth16Verifier) {
    console.log("[1/10] Groth16Verifier...");
    const v = await deployContract("Groth16Verifier", []);
    c.groth16Verifier = await v.getAddress();
    saveOutput(output);
  }
  console.log(`  ✓ Groth16Verifier: ${c.groth16Verifier}\n`);

  // 2. CredentialRegistry
  if (!c.credentialRegistry?.proxy) {
    console.log("[2/10] CredentialRegistry (UUPS)...");
    const impl = await deployContract("CredentialRegistry", []);
    const initData = impl.interface.encodeFunctionData("initialize", [deployer.address]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.credentialRegistry = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  console.log(`  ✓ CredentialRegistry Proxy: ${c.credentialRegistry.proxy}\n`);

  // 3. OrganizationCredentialAnchor
  if (!c.organizationCredentialAnchor) {
    console.log("[3/10] OrganizationCredentialAnchor (impl)...");
    const a = await deployContract("OrganizationCredentialAnchor", []);
    c.organizationCredentialAnchor = await a.getAddress();
    saveOutput(output);
  }
  console.log(`  ✓ OrgCredentialAnchor: ${c.organizationCredentialAnchor}\n`);

  // 4. OrganizationRegistry
  if (!c.organizationRegistry?.proxy) {
    console.log("[4/10] OrganizationRegistry (UUPS)...");
    const impl = await deployContract("OrganizationRegistry", []);
    const initData = impl.interface.encodeFunctionData("initialize", [
      deployer.address, c.organizationCredentialAnchor
    ]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.organizationRegistry = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  console.log(`  ✓ OrganizationRegistry Proxy: ${c.organizationRegistry.proxy}\n`);

  // 5. AgentWallet implementation
  if (!c.agentWalletImplementation) {
    console.log("[5/10] AgentWallet (impl)...");
    const w = await deployContract("AgentWallet", []);
    c.agentWalletImplementation = await w.getAddress();
    saveOutput(output);
  }
  console.log(`  ✓ AgentWallet Impl: ${c.agentWalletImplementation}\n`);

  // 6. SessionManager
  if (!c.sessionManager?.proxy) {
    console.log("[6/10] SessionManager (UUPS)...");
    const impl = await deployContract("SessionManager", []);
    const initData = impl.interface.encodeFunctionData("initialize", [
      c.groth16Verifier, c.credentialRegistry.proxy, PLACEHOLDER
    ]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.sessionManager = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  console.log(`  ✓ SessionManager Proxy: ${c.sessionManager.proxy}\n`);

  // 7. AgentWalletFactory
  if (!c.agentWalletFactory?.proxy) {
    console.log("[7/10] AgentWalletFactory (UUPS)...");
    const impl = await deployContract("AgentWalletFactory", []);
    const initData = impl.interface.encodeFunctionData("initialize", [
      c.agentWalletImplementation, c.sessionManager.proxy, ENTRY_POINT
    ]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.agentWalletFactory = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  console.log(`  ✓ AgentWalletFactory Proxy: ${c.agentWalletFactory.proxy}\n`);

  // 8. CapabilityRegistry
  if (!c.capabilityRegistry?.proxy) {
    console.log("[8/10] CapabilityRegistry (UUPS)...");
    const impl = await deployContract("CapabilityRegistry", []);
    const initData = impl.interface.encodeFunctionData("initialize", [deployer.address]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.capabilityRegistry = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  console.log(`  ✓ CapabilityRegistry Proxy: ${c.capabilityRegistry.proxy}\n`);

  // 9. DelegationManager
  if (!c.delegationManager?.proxy) {
    console.log("[9/10] DelegationManager (UUPS)...");
    const impl = await deployContract("DelegationManager", []);
    const initData = impl.interface.encodeFunctionData("initialize", [deployer.address]);
    const proxy = await deployProxy(await impl.getAddress(), initData);
    c.delegationManager = { proxy: await proxy.getAddress(), implementation: await impl.getAddress() };
    saveOutput(output);
  }
  c.entryPoint = ENTRY_POINT;
  console.log(`  ✓ DelegationManager Proxy: ${c.delegationManager.proxy}\n`);

  // 10. Configure CredentialRegistry
  if (!output.configuration.credentialRegistrySessionManager) {
    console.log("[10/10] Configuring CredentialRegistry...");
    const credReg = await ethers.getContractAt("CredentialRegistry", c.credentialRegistry.proxy);
    const tx = await credReg.setSessionManager(c.sessionManager.proxy, true);
    await tx.wait();
    await sleep(2000);
    output.configuration.credentialRegistrySessionManager = true;
    saveOutput(output);
    console.log("  ✓ setSessionManager done\n");
  } else {
    console.log("  ✓ CredentialRegistry already configured\n");
  }

  // Propose walletFactory on SessionManager (24h timelock)
  if (!output.configuration.factoryWalletFactoryProposed) {
    console.log("Proposing SessionManager walletFactory (24h timelock)...");
    const sm = await ethers.getContractAt("SessionManager", c.sessionManager.proxy);
    const tx = await sm.proposeWalletFactory(c.agentWalletFactory.proxy);
    await tx.wait();
    await sleep(2000);
    output.configuration.factoryWalletFactoryProposed = true;
    output.timestamp = new Date().toISOString();
    saveOutput(output);
    console.log("  ✓ proposeWalletFactory done");
    console.log(`  ⚠ Accept after 24h: sm.acceptWalletFactory()\n`);
  }

  // Final report
  console.log("=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE — ADDRESS MAP");
  console.log("=".repeat(60));
  console.log(`Groth16Verifier:            ${c.groth16Verifier}`);
  console.log(`CredentialRegistry:         ${c.credentialRegistry.proxy}`);
  console.log(`  └─ Impl:                  ${c.credentialRegistry.implementation}`);
  console.log(`OrgCredentialAnchor (impl): ${c.organizationCredentialAnchor}`);
  console.log(`OrganizationRegistry:       ${c.organizationRegistry.proxy}`);
  console.log(`  └─ Impl:                  ${c.organizationRegistry.implementation}`);
  console.log(`SessionManager:             ${c.sessionManager.proxy}`);
  console.log(`  └─ Impl:                  ${c.sessionManager.implementation}`);
  console.log(`AgentWallet (impl):         ${c.agentWalletImplementation}`);
  console.log(`AgentWalletFactory:         ${c.agentWalletFactory.proxy}`);
  console.log(`  └─ Impl:                  ${c.agentWalletFactory.implementation}`);
  console.log(`CapabilityRegistry:         ${c.capabilityRegistry.proxy}`);
  console.log(`  └─ Impl:                  ${c.capabilityRegistry.implementation}`);
  console.log(`DelegationManager:          ${c.delegationManager.proxy}`);
  console.log(`  └─ Impl:                  ${c.delegationManager.implementation}`);
  console.log(`EntryPoint:                 ${ENTRY_POINT}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
