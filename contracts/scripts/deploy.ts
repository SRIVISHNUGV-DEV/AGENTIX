import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

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

/// @notice Deploys a UUPS proxy WITH its initialize calldata in the same
///         transaction. The proxy is born initialized and owned — there is
///         never an uninitialized proxy anyone could front-run. (The old
///         script deployed proxies with empty init data and initialized in
///         a later transaction; that window is closed by this change.)
async function deployProxy(impl: string, initData: string): Promise<string> {
  const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await proxyFactory.deploy(impl, initData);
  await proxy.waitForDeployment();
  return await proxy.getAddress();
}

async function initDataFor(implName: string, fn: string, args: any[]): Promise<string> {
  const factory = await ethers.getContractFactory(implName);
  return factory.interface.encodeFunctionData(fn, args);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  AgentIX — Fresh Deployment (atomic init)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:    ${network.name} (${network.chainId})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Balance:    ${ethers.formatEther(bal)} ETH`);
  console.log(`  EntryPoint: ${ENTRY_POINT}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const r: Record<string, string> = {};
  const impl: Record<string, string> = {};

  // ════════════════════════════════════════════════════════
  //  PHASE 1 — Standalone implementations (non-upgradeable)
  // ════════════════════════════════════════════════════════
  log("Phase 1: Standalone implementations:");
  r.groth16Verifier = await deployImpl("Groth16Verifier");
  log(`  Groth16Verifier:            ${r.groth16Verifier}`);
  await sleep(TX_DELAY_MS);

  r.agentWalletImpl = await deployImpl("AgentWallet");
  log(`  AgentWallet (impl):         ${r.agentWalletImpl}`);
  await sleep(TX_DELAY_MS);

  r.anchorImpl = await deployImpl("OrganizationCredentialAnchor");
  log(`  OrgCredentialAnchor (impl): ${r.anchorImpl}`);
  await sleep(TX_DELAY_MS);

  // ════════════════════════════════════════════════════════
  //  PHASE 2 — UUPS proxies, each born initialized (atomic init)
  // ════════════════════════════════════════════════════════
  log("\nPhase 2: UUPS proxies (atomic init — no uninitialized window):");

  // Independent inits (no cross-deps)
  impl.CredentialRegistry = await deployImpl("CredentialRegistry");
  r.CredentialRegistry = await deployProxy(
    impl.CredentialRegistry,
    await initDataFor("CredentialRegistry", "initialize", [deployer.address])
  );
  log(`  CredentialRegistry          ${r.CredentialRegistry}`);
  await sleep(TX_DELAY_MS);

  impl.CapabilityRegistry = await deployImpl("CapabilityRegistry");
  r.CapabilityRegistry = await deployProxy(
    impl.CapabilityRegistry,
    await initDataFor("CapabilityRegistry", "initialize", [deployer.address])
  );
  log(`  CapabilityRegistry          ${r.CapabilityRegistry}`);
  await sleep(TX_DELAY_MS);

  impl.DelegationManager = await deployImpl("DelegationManager");
  r.DelegationManager = await deployProxy(
    impl.DelegationManager,
    await initDataFor("DelegationManager", "initialize", [deployer.address])
  );
  log(`  DelegationManager           ${r.DelegationManager}`);
  await sleep(TX_DELAY_MS);

  impl.OrganizationRegistry = await deployImpl("OrganizationRegistry");
  r.OrganizationRegistry = await deployProxy(
    impl.OrganizationRegistry,
    await initDataFor("OrganizationRegistry", "initialize", [deployer.address, r.anchorImpl])
  );
  log(`  OrganizationRegistry        ${r.OrganizationRegistry}`);
  await sleep(TX_DELAY_MS);

  // Circular pair (SessionManager ↔ Factory): SessionManager is born
  // initialized with address(0) for the factory — the proxy is owned from
  // birth, so the zero is a state choice, not a front-running window —
  // then the real factory is wired via the one-time owner-only
  // setInitialWalletFactory (no timelock for the initial set).
  impl.SessionManager = await deployImpl("SessionManager");
  r.SessionManager = await deployProxy(
    impl.SessionManager,
    await initDataFor("SessionManager", "initialize", [r.groth16Verifier, r.CredentialRegistry, ethers.ZeroAddress])
  );
  log(`  SessionManager              ${r.SessionManager} (factory=0x0, wired in Phase 3)`);
  await sleep(TX_DELAY_MS);

  impl.AgentWalletFactory = await deployImpl("AgentWalletFactory");
  r.AgentWalletFactory = await deployProxy(
    impl.AgentWalletFactory,
    await initDataFor("AgentWalletFactory", "initialize", [r.agentWalletImpl, r.SessionManager, ENTRY_POINT])
  );
  log(`  AgentWalletFactory          ${r.AgentWalletFactory}`);
  await sleep(TX_DELAY_MS);

  impl.AgentIdentity = await deployImpl("AgentIdentity");
  r.AgentIdentity = await deployProxy(
    impl.AgentIdentity,
    await initDataFor("AgentIdentity", "initialize", [deployer.address, r.AgentWalletFactory])
  );
  log(`  AgentIdentity               ${r.AgentIdentity}`);
  await sleep(TX_DELAY_MS);

  // ════════════════════════════════════════════════════════
  //  PHASE 3 — Wire cross-contract references
  // ════════════════════════════════════════════════════════
  log("\nPhase 3: Wire cross-contract references");

  let contract = await ethers.getContractAt("SessionManager", r.SessionManager);
  let wireTx = await contract.setInitialWalletFactory(r.AgentWalletFactory);
  await wireTx.wait();
  log("  SessionManager.setInitialWalletFactory(factory)  ✓ real factory wired (no timelock)");
  await sleep(TX_DELAY_MS);

  contract = await ethers.getContractAt("CredentialRegistry", r.CredentialRegistry);
  wireTx = await contract.setSessionManager(r.SessionManager, true);
  await wireTx.wait();
  log("  CredentialRegistry.setSessionManager(sm, true)");
  await sleep(TX_DELAY_MS);

  contract = await ethers.getContractAt("AgentWalletFactory", r.AgentWalletFactory);
  wireTx = await contract.setAgentIdentity(r.AgentIdentity);
  await wireTx.wait();
  log("  AgentWalletFactory.setAgentIdentity(identity)");
  await sleep(TX_DELAY_MS);

  // ════════════════════════════════════════════════════════
  //  PHASE 4 — Write deploy-output.json (consumed by test-onchain.ts,
  //  test-onchain.mjs, and verify-all.ts — see their read paths)
  // ════════════════════════════════════════════════════════
  const proxyEntry = (name: string) => ({
    proxy: r[name],
    implementation: impl[name],
    impl: impl[name], // alias: verify-all.ts accepts implementation || impl
  });
  const output = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      groth16Verifier: r.groth16Verifier,
      agentWalletImpl: r.agentWalletImpl,
      agentWalletImplementation: r.agentWalletImpl, // alias for deploy task schema
      anchorImpl: r.anchorImpl,
      organizationCredentialAnchor: r.anchorImpl, // alias for deploy task schema
      credentialRegistry: proxyEntry("CredentialRegistry"),
      sessionManager: proxyEntry("SessionManager"),
      agentWalletFactory: proxyEntry("AgentWalletFactory"),
      capabilityRegistry: proxyEntry("CapabilityRegistry"),
      delegationManager: proxyEntry("DelegationManager"),
      organizationRegistry: proxyEntry("OrganizationRegistry"),
      agentIdentity: proxyEntry("AgentIdentity"),
      entryPoint: ENTRY_POINT,
    },
    configuration: {
      credentialRegistrySessionManager: true,
      sessionManagerWalletFactorySet: true,
    },
  };
  const outPath = path.join(__dirname, "..", "deploy-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  log(`\n  Wrote ${outPath}`);

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
