import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ─── Configuration ──────────────────────────────────────────────────────────
const ENTRY_POINT = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const TIMELOCK_DELAY = 24 * 60 * 60; // 24 hours in seconds
const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

// ─── Types ──────────────────────────────────────────────────────────────────
interface ContractDeployment {
  name: string;
  address: string;
  implementation?: string;
  constructorArgs?: unknown[];
  initArgs?: Record<string, unknown>;
}

interface DeploymentState {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  phase1: Record<string, ContractDeployment>;
  phase2: Record<string, ContractDeployment>;
  phase3: Record<string, ContractDeployment>;
  phase4: Record<string, ContractDeployment>;
  phase5: Record<string, ContractDeployment>;
  configuration: {
    factorySessionManagerLinked: boolean;
    factorySessionManagerActivationTime?: number;
    credentialRegistrySessionManagerLinked: boolean;
    agentIdentityLinked: boolean;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function getProxyFactory() {
  return ethers.getContractFactory("ERC1967Proxy");
}

async function deployUUPS(
  contractName: string,
  initArgs: unknown[],
  label: string
): Promise<{ proxy: string; implementation: string }> {
  const ImplFactory = await ethers.getContractFactory(contractName);
  const impl = await ImplFactory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`  [${label}] Implementation: ${implAddr}`);

  const ProxyFactory = await getProxyFactory();
  const proxy = await ProxyFactory.deploy(
    implAddr,
    impl.interface.encodeFunctionData("initialize", initArgs)
  );
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`  [${label}] Proxy: ${proxyAddr}`);

  await sleep(3000);
  return { proxy: proxyAddr, implementation: implAddr };
}

async function deployImpl(
  contractName: string,
  label: string
): Promise<string> {
  const Factory = await ethers.getContractFactory(contractName);
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const addr = await impl.getAddress();
  console.log(`  [${label}] Implementation: ${addr}`);
  await sleep(3000);
  return addr;
}

// ─── Main Deployment ────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Contract Deployment v5");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${networkInfo.name} (chainId: ${networkInfo.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${ethers.formatEther(bal)} ETH`);
  console.log(`  EntryPoint: ${ENTRY_POINT}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const state: DeploymentState = {
    network: networkInfo.name,
    chainId: Number(networkInfo.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    phase1: {},
    phase2: {},
    phase3: {},
    phase4: {},
    phase5: {},
    configuration: {
      factorySessionManagerLinked: false,
      credentialRegistrySessionManagerLinked: false,
      agentIdentityLinked: false,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Independent Contracts (no cross-dependencies)
  // These can be deployed in any order or in parallel.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("─── Phase 1: Independent Contracts ───────────────────\n");

  // 1a. Groth16Verifier (standalone, non-upgradeable)
  console.log("[1a] Groth16Verifier");
  const verifierAddr = await deployImpl("Groth16Verifier", "Groth16Verifier");
  state.phase1.groth16Verifier = { name: "Groth16Verifier", address: verifierAddr };

  // 1b. CapabilityRegistry (standalone, no cross-contract deps)
  console.log("\n[1b] CapabilityRegistry");
  const capReg = await deployUUPS("CapabilityRegistry", [deployer.address], "CapabilityRegistry");
  state.phase1.capabilityRegistry = { name: "CapabilityRegistry", ...capReg };

  // 1c. DelegationManager (standalone, no cross-contract deps)
  console.log("\n[1c] DelegationManager");
  const delMgr = await deployUUPS("DelegationManager", [deployer.address], "DelegationManager");
  state.phase1.delegationManager = { name: "DelegationManager", ...delMgr };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Foundation Layer (depends on nothing or Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n─── Phase 2: Foundation Layer ────────────────────────\n");

  // 2a. CredentialRegistry (standalone, but will be wired to SessionManager later)
  console.log("[2a] CredentialRegistry");
  const credReg = await deployUUPS("CredentialRegistry", [deployer.address], "CredentialRegistry");
  state.phase2.credentialRegistry = { name: "CredentialRegistry", ...credReg };

  // 2b. OrganizationCredentialAnchor (implementation only — cloned per-org)
  console.log("\n[2b] OrganizationCredentialAnchor (implementation)");
  const anchorAddr = await deployImpl("OrganizationCredentialAnchor", "OrgCredentialAnchor");
  state.phase2.organizationCredentialAnchor = { name: "OrganizationCredentialAnchor", address: anchorAddr };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Core Infrastructure (depends on Phase 2)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n─── Phase 3: Core Infrastructure ─────────────────────\n");

  // 3a. OrganizationRegistry (needs anchor implementation)
  console.log("[3a] OrganizationRegistry");
  const orgReg = await deployUUPS(
    "OrganizationRegistry",
    [deployer.address, anchorAddr],
    "OrganizationRegistry"
  );
  state.phase3.organizationRegistry = { name: "OrganizationRegistry", ...orgReg };

  // 3b. AgentWallet implementation (non-upgradeable, used by factory)
  console.log("\n[3b] AgentWallet (implementation)");
  const walletImplAddr = await deployImpl("AgentWallet", "AgentWallet");
  state.phase3.agentWalletImplementation = { name: "AgentWallet", address: walletImplAddr };

  // 3c. AgentWalletFactory (needs wallet impl + placeholder SM + entry point)
  //     SessionManager doesn't exist yet, so we use a placeholder address.
  //     The real SM address is set via proposeSessionManager + timelock.
  console.log("\n[3c] AgentWalletFactory");
  const PLACEHOLDER_SM = "0x0000000000000000000000000000000000000001";
  const factory = await deployUUPS(
    "AgentWalletFactory",
    [walletImplAddr, PLACEHOLDER_SM, ENTRY_POINT],
    "AgentWalletFactory"
  );
  state.phase3.agentWalletFactory = {
    name: "AgentWalletFactory",
    ...factory,
    initArgs: { implementation: walletImplAddr, sessionManager: PLACEHOLDER_SM, entryPoint: ENTRY_POINT },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: Session Layer (depends on Phase 2 + Phase 3)
  // SessionManager is the hub — it reads from CredentialRegistry and
  // validates wallets via AgentWalletFactory.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n─── Phase 4: Session Layer ───────────────────────────\n");

  // 4a. SessionManager (needs: verifier, credentialRegistry, walletFactory)
  console.log("[4a] SessionManager");
  const sessMgr = await deployUUPS(
    "SessionManager",
    [verifierAddr, credReg.proxy, factory.proxy],
    "SessionManager"
  );
  state.phase4.sessionManager = {
    name: "SessionManager",
    ...sessMgr,
    initArgs: { verifier: verifierAddr, registry: credReg.proxy, walletFactory: factory.proxy },
  };

  await sleep(5000);
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: Identity Layer (depends on Phase 3)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n─── Phase 5: Identity Layer ──────────────────────────\n");

  // 5a. AgentIdentity (needs walletFactory for onlyFactory modifier)
  console.log("[5a] AgentIdentity");
  const agentIdentity = await deployUUPS(
    "AgentIdentity",
    [deployer.address, factory.proxy],
    "AgentIdentity"
  );
  state.phase5.agentIdentity = {
    name: "AgentIdentity",
    ...agentIdentity,
    initArgs: { owner: deployer.address, walletFactory: factory.proxy },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: Wiring & Configuration
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n─── Phase 6: Wiring & Configuration ─────────────────\n");

  // 6a. CredentialRegistry → authorize SessionManager as nullifier consumer
  console.log("[6a] CredentialRegistry.setSessionManager(SM, true)");
  const credRegContract = await ethers.getContractAt("CredentialRegistry", credReg.proxy);
  let tx = await credRegContract.setSessionManager(sessMgr.proxy, true);
  await tx.wait();
  state.configuration.credentialRegistrySessionManagerLinked = true;
  console.log("  ✓ SessionManager authorized on CredentialRegistry\n");

  // 6b. AgentWalletFactory → link AgentIdentity
  console.log("[6b] AgentWalletFactory.setAgentIdentity(identity)");
  const factoryContract = await ethers.getContractAt("AgentWalletFactory", factory.proxy);
  tx = await factoryContract.setAgentIdentity(agentIdentity.proxy);
  await tx.wait();
  state.configuration.agentIdentityLinked = true;
  console.log("  ✓ AgentIdentity linked to Factory\n");

  // 6c. AgentWalletFactory → propose SessionManager (starts 24h timelock)
  console.log("[6c] AgentWalletFactory.proposeSessionManager(SM)");
  tx = await factoryContract.proposeSessionManager(sessMgr.proxy);
  await tx.wait();
  const block = await ethers.provider.getBlock("latest");
  state.configuration.factorySessionManagerActivationTime = block!.timestamp + TIMELOCK_DELAY;
  state.configuration.factorySessionManagerLinked = false;
  console.log(`  ✓ SessionManager proposed — activates at ${new Date(state.configuration.factorySessionManagerActivationTime * 1000).toISOString()}`);
  console.log(`  ⏳ Run "npx hardhat run scripts/activate-factory-sm.ts --network ${network.name}" after timelock\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Save deployment state
  // ═══════════════════════════════════════════════════════════════════════════
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  const outputPath = path.join(DEPLOYMENTS_DIR, `${networkInfo.name}-${networkInfo.chainId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2));
  console.log(`─── Deployment state saved to ${outputPath} ──────────\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Deployment Summary");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Groth16Verifier:          ${verifierAddr}`);
  console.log(`  CredentialRegistry:       ${credReg.proxy}`);
  console.log(`  OrgCredentialAnchor:      ${anchorAddr}`);
  console.log(`  OrganizationRegistry:     ${orgReg.proxy}`);
  console.log(`  SessionManager:           ${sessMgr.proxy}`);
  console.log(`  AgentWallet (impl):       ${walletImplAddr}`);
  console.log(`  AgentWalletFactory:       ${factory.proxy}`);
  console.log(`  CapabilityRegistry:       ${capReg.proxy}`);
  console.log(`  DelegationManager:        ${delMgr.proxy}`);
  console.log(`  AgentIdentity:            ${agentIdentity.proxy}`);
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ⚠️  Factory SessionManager: PENDING (24h timelock)");
  console.log("  ⚠️  Run activate-factory-sm.ts after timelock");
  console.log("═══════════════════════════════════════════════════════\n");

  return state;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
