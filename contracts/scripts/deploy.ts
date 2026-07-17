import { ethers } from "hardhat";

// ─── Config ───────────────────────────────────────────────────────────────────
const ENTRY_POINT = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const TX_DELAY_MS = 5000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (msg: string) => console.log(`  ${msg}`);
const hr = () => console.log("─".repeat(55));

async function deployImpl(name: string): Promise<string> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  return await contract.getAddress();
}

async function deployProxy(impl: string): Promise<string> {
  const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await proxyFactory.deploy(impl, "0x"); // empty init data — initialize later
  await proxy.waitForDeployment();
  return await proxy.getAddress();
}

async function tx(hash: string, label: string) {
  log(`  tx: ${label}`);
  await sleep(TX_DELAY_MS);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  AgentIX — Fresh Deployment (deferred init)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:    ${network.name} (${network.chainId})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Balance:    ${ethers.formatEther(bal)} ETH`);
  console.log(`  EntryPoint: ${ENTRY_POINT}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const r: Record<string, string> = {};

  // ════════════════════════════════════════════════════════
  //  PHASE 1 — Deploy all implementations + proxies (no init)
  // ════════════════════════════════════════════════════════
  log("Phase 1: Deploy implementations + proxies (no init)");

  // 1a. Standalone implementations (non-upgradeable or clone source)
  log("\n  Standalone implementations:");
  r.groth16Verifier   = await deployImpl("Groth16Verifier");
  log(`  Groth16Verifier:            ${r.groth16Verifier}`);
  await sleep(TX_DELAY_MS);

  r.agentWalletImpl   = await deployImpl("AgentWallet");
  log(`  AgentWallet (impl):         ${r.agentWalletImpl}`);
  await sleep(TX_DELAY_MS);

  r.anchorImpl        = await deployImpl("OrganizationCredentialAnchor");
  log(`  OrgCredentialAnchor (impl): ${r.anchorImpl}`);
  await sleep(TX_DELAY_MS);

  // 1b. UUPS proxies — deployed with empty init data
  log("\n  UUPS proxies (deferred init):");

  const uupsContracts = [
    "CredentialRegistry",
    "SessionManager",
    "AgentWalletFactory",
    "CapabilityRegistry",
    "DelegationManager",
    "OrganizationRegistry",
    "AgentIdentity",
  ];

  for (const name of uupsContracts) {
    const impl = await deployImpl(name);
    const proxy = await deployProxy(impl);
    r[name] = proxy;
    log(`  ${name.padEnd(28)} ${proxy}`);
    await sleep(TX_DELAY_MS);
  }

  // ════════════════════════════════════════════════════════
  //  PHASE 2 — Initialize all contracts
  // ════════════════════════════════════════════════════════
  log("\nPhase 2: Initialize all contracts");

  // 2a. Independent inits (no cross-deps)
  log("\n  Independent initializations:");
  let contract = await ethers.getContractAt("CredentialRegistry", r.CredentialRegistry);
  let initTx = await contract.initialize(deployer.address);
  await initTx.wait();
  log("  CredentialRegistry.initialize(owner)");
  await sleep(TX_DELAY_MS);

  contract = await ethers.getContractAt("CapabilityRegistry", r.CapabilityRegistry);
  initTx = await contract.initialize(deployer.address);
  await initTx.wait();
  log("  CapabilityRegistry.initialize(owner)");
  await sleep(TX_DELAY_MS);

  contract = await ethers.getContractAt("DelegationManager", r.DelegationManager);
  initTx = await contract.initialize(deployer.address);
  await initTx.wait();
  log("  DelegationManager.initialize(owner)");
  await sleep(TX_DELAY_MS);

  contract = await ethers.getContractAt("OrganizationRegistry", r.OrganizationRegistry);
  initTx = await contract.initialize(deployer.address, r.anchorImpl);
  await initTx.wait();
  log("  OrganizationRegistry.initialize(owner, anchorImpl)");
  await sleep(TX_DELAY_MS);

  // 2b. Circular pair — init SessionManager with address(0) for factory, then Factory, then set factory
  log("\n  Circular dependency wiring (SessionManager ↔ Factory):");

  // Step A: Init SessionManager with address(0) for walletFactory (will set real one later)
  contract = await ethers.getContractAt("SessionManager", r.SessionManager);
  initTx = await contract.initialize(r.groth16Verifier, r.CredentialRegistry, ethers.ZeroAddress);
  await initTx.wait();
  log("  SessionManager.init(verifier, registry, address(0))");
  await sleep(TX_DELAY_MS);

  // Step B: Init Factory with SessionManager already known
  contract = await ethers.getContractAt("AgentWalletFactory", r.AgentWalletFactory);
  initTx = await contract.initialize(r.agentWalletImpl, r.SessionManager, ENTRY_POINT);
  await initTx.wait();
  log("  AgentWalletFactory.init(walletImpl, sessionManager, entryPoint)");
  await sleep(TX_DELAY_MS);

  // Step C: Init AgentIdentity (needs Factory address)
  contract = await ethers.getContractAt("AgentIdentity", r.AgentIdentity);
  initTx = await contract.initialize(deployer.address, r.AgentWalletFactory);
  await initTx.wait();
  log("  AgentIdentity.init(owner, walletFactory)");
  await sleep(TX_DELAY_MS);

  // ════════════════════════════════════════════════════════
  //  PHASE 3 — Wire cross-contract references
  // ════════════════════════════════════════════════════════
  log("\nPhase 3: Wire cross-contract references");

  // 3a. SessionManager → set real walletFactory (one-time, no timelock for initial set)
  contract = await ethers.getContractAt("SessionManager", r.SessionManager);
  let wireTx = await contract.setInitialWalletFactory(r.AgentWalletFactory);
  await wireTx.wait();
  log("  SessionManager.setInitialWalletFactory(factory)  ✓ real factory wired (no timelock)");
  await sleep(TX_DELAY_MS);

  // 3b. CredentialRegistry → authorize SessionManager as nullifier spender
  contract = await ethers.getContractAt("CredentialRegistry", r.CredentialRegistry);
  wireTx = await contract.setSessionManager(r.SessionManager, true);
  await wireTx.wait();
  log("  CredentialRegistry.setSessionManager(sm, true)");
  await sleep(TX_DELAY_MS);

  // 3c. AgentWalletFactory → link AgentIdentity
  contract = await ethers.getContractAt("AgentWalletFactory", r.AgentWalletFactory);
  wireTx = await contract.setAgentIdentity(r.AgentIdentity);
  await wireTx.wait();
  log("  AgentWalletFactory.setAgentIdentity(identity)");
  await sleep(TX_DELAY_MS);

  // ════════════════════════════════════════════════════════
  //  SUMMARY
  // ════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Deployment Complete");
  console.log("═══════════════════════════════════════════════════════");
  const labelMap: Record<string, string> = {
    groth16Verifier: "Groth16Verifier",
    agentWalletImpl: "AgentWallet (impl)",
    anchorImpl: "OrgCredentialAnchor (impl)",
    CredentialRegistry: "CredentialRegistry (proxy)",
    SessionManager: "SessionManager (proxy)",
    AgentWalletFactory: "AgentWalletFactory (proxy)",
    CapabilityRegistry: "CapabilityRegistry (proxy)",
    DelegationManager: "DelegationManager (proxy)",
    OrganizationRegistry: "OrganizationRegistry (proxy)",
    AgentIdentity: "AgentIdentity (proxy)",
  };
  for (const [key, label] of Object.entries(labelMap)) {
    console.log(`  ${label.padEnd(32)} ${r[key]}`);
  }
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
