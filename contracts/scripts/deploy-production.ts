import { ethers } from "hardhat";

const ENTRY_POINT = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(msg: string) { console.log(`  ${msg}`); }

async function deployImpl(name: string, label: string): Promise<string> {
  const factory = await ethers.getContractFactory(name);
  const c = await factory.deploy();
  await c.waitForDeployment();
  const addr = await c.getAddress();
  log(`${label}: ${addr}`);
  return addr;
}

async function deployUUPS(name: string, initArgs: unknown[], label: string): Promise<{ proxy: string; impl: string }> {
  const impl = await deployImpl(name, `${label} impl`);
  const proxyFact = await ethers.getContractFactory("ERC1967Proxy");
  const iface = (await ethers.getContractFactory(name)).interface;
  const proxy = await proxyFact.deploy(impl, iface.encodeFunctionData("initialize", initArgs));
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  log(`${label} proxy: ${proxyAddr}`);
  return { proxy: proxyAddr, impl };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Contract Deployment");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${networkInfo.name} (chainId: ${networkInfo.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${ethers.formatEther(bal)} ETH`);
  console.log(`  EntryPoint: ${ENTRY_POINT}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const r: Record<string, any> = {};

  // ── Phase 1: Independent ─────────────────────────────────
  log("Phase 1: Independent contracts");
  r.groth16Verifier = await deployImpl("Groth16Verifier", "Groth16Verifier");
  await sleep(5000);

  r.capabilityRegistry = await deployUUPS("CapabilityRegistry", [deployer.address], "CapabilityRegistry");
  await sleep(5000);

  r.delegationManager = await deployUUPS("DelegationManager", [deployer.address], "DelegationManager");
  await sleep(5000);

  // ── Phase 2: Foundation ──────────────────────────────────
  log("\nPhase 2: Foundation");
  r.credentialRegistry = await deployUUPS("CredentialRegistry", [deployer.address], "CredentialRegistry");
  await sleep(5000);

  r.organizationCredentialAnchor = await deployImpl("OrganizationCredentialAnchor", "OrgCredentialAnchor");
  await sleep(5000);

  // ── Phase 3: Core Infrastructure ─────────────────────────
  log("\nPhase 3: Core Infrastructure");
  r.organizationRegistry = await deployUUPS("OrganizationRegistry", [deployer.address, r.organizationCredentialAnchor], "OrganizationRegistry");
  await sleep(5000);

  r.agentWallet = await deployImpl("AgentWallet", "AgentWallet");
  await sleep(5000);

  // ── Phase 4: Session Layer ───────────────────────────────
  log("\nPhase 4: Session Layer");
  r.sessionManager = await deployUUPS("SessionManager", [r.groth16Verifier, r.credentialRegistry.proxy, deployer.address], "SessionManager");
  await sleep(5000);

  // ── Phase 5: Wallet Factory (real SM now available) ──────
  log("\nPhase 5: Wallet Factory");
  r.agentWalletFactory = await deployUUPS("AgentWalletFactory", [r.agentWallet, r.sessionManager.proxy, ENTRY_POINT], "AgentWalletFactory");
  await sleep(5000);

  // ── Phase 6: Identity ────────────────────────────────────
  log("\nPhase 6: Identity");
  r.agentIdentity = await deployUUPS("AgentIdentity", [deployer.address, r.agentWalletFactory.proxy], "AgentIdentity");
  await sleep(5000);

  // ── Phase 7: Wiring ──────────────────────────────────────
  log("\nPhase 7: Wiring");

  // 7a. SessionManager → set the real wallet factory (was deployer placeholder)
  const sm = await ethers.getContractAt("SessionManager", r.sessionManager.proxy);
  let tx = await sm.proposeWalletFactory(r.agentWalletFactory.proxy);
  await tx.wait();
  log("SessionManager walletFactory proposed");
  await sleep(2000);
  tx = await sm.acceptWalletFactory();
  await tx.wait();
  log("SessionManager walletFactory updated");
  await sleep(3000);

  // 7b. CredentialRegistry → authorize SessionManager
  const cr = await ethers.getContractAt("CredentialRegistry", r.credentialRegistry.proxy);
  tx = await cr.setSessionManager(r.sessionManager.proxy, true);
  await tx.wait();
  log("CredentialRegistry sessionManager authorized");
  await sleep(3000);

  // 7c. AgentWalletFactory → link AgentIdentity
  const fac = await ethers.getContractAt("AgentWalletFactory", r.agentWalletFactory.proxy);
  tx = await fac.setAgentIdentity(r.agentIdentity.proxy);
  await tx.wait();
  log("AgentIdentity linked to Factory");
  await sleep(3000);

  // 7d. Factory → accept the real SM (timelock = 0 now)
  tx = await fac.proposeSessionManager(r.sessionManager.proxy);
  await tx.wait();
  log("Factory sessionManager proposed");
  await sleep(2000);
  tx = await fac.acceptSessionManager();
  await tx.wait();
  log("Factory sessionManager updated");

  // ── Summary ──────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Deployment Complete");
  console.log("═══════════════════════════════════════════════════════");
  for (const [k, v] of Object.entries(r)) {
    const addr = typeof v === 'string' ? v : v.proxy || v.impl;
    console.log(`  ${k.padEnd(30)} ${addr}`);
  }
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
