import { ethers } from "hardhat";

/**
 * Verify all contract integrations on-chain.
 * Run: npx hardhat run scripts/verify-integrations.ts --network baseSepolia
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX — Contract Integration Verification");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${network.name} (${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // Contract addresses from deployment
  const ADDRS = {
    groth16Verifier: "0x7bA15966B895BEb00B291a73Aa672918D1E27cf9",
    agentWalletImpl: "0x206630bC8C366b94d4F73382f9F1742795F49de2",
    anchorImpl: "0x26d64c5Cad7e434534C9f349Bb14E777AA10E99F",
    credentialRegistry: "0x3b738E79053eD2993A9c061Dd2A4AA85A9962378",
    sessionManager: "0x1651b88dB25005fB22906D7d28A25c45ef9dc2Bf",
    agentWalletFactory: "0x95613c9cfEca1e77597cf6F54cDCA21a9Be7aA88",
    capabilityRegistry: "0xDa7069616F793d4048809245AA7Ce3f1C1d3EC0d",
    delegationManager: "0x2F7e35D096b43A002964bB6e343494188ca51D11",
    organizationRegistry: "0x982EAcfF15e6C326F534eB671B009546bae3D13a",
    agentIdentity: "0x5eb3688D61187550400A940D43461e7984Ca405c",
    entryPoint: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
  };

  let passed = 0;
  let failed = 0;

  function check(name: string, ok: boolean, detail: string) {
    if (ok) {
      console.log(`  ✅ ${name}: ${detail}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}: ${detail}`);
      failed++;
    }
  }

  // ─── SessionManager integrations ─────────────────────────────────
  console.log("\n  SessionManager Integrations:");

  const sm = await ethers.getContractAt("SessionManager", ADDRS.sessionManager);

  const smVerifier = await sm.verifier();
  check("SessionManager → Groth16Verifier",
    smVerifier.toLowerCase() === ADDRS.groth16Verifier.toLowerCase(),
    `verifier=${smVerifier}`);

  const smRegistry = await sm.registry();
  check("SessionManager → CredentialRegistry",
    smRegistry.toLowerCase() === ADDRS.credentialRegistry.toLowerCase(),
    `registry=${smRegistry}`);

  const smFactory = await sm.walletFactory();
  check("SessionManager → AgentWalletFactory",
    smFactory.toLowerCase() === ADDRS.agentWalletFactory.toLowerCase(),
    `walletFactory=${smFactory}`);

  const smOwner = await sm.owner();
  check("SessionManager → Owner",
    smOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${smOwner}`);

  // ─── AgentWalletFactory integrations ─────────────────────────────
  console.log("\n  AgentWalletFactory Integrations:");

  const factory = await ethers.getContractAt("AgentWalletFactory", ADDRS.agentWalletFactory);

  const fImpl = await factory.implementation();
  check("AgentWalletFactory → Wallet Implementation",
    fImpl.toLowerCase() === ADDRS.agentWalletImpl.toLowerCase(),
    `implementation=${fImpl}`);

  const fSM = await factory.sessionManager();
  check("AgentWalletFactory → SessionManager",
    fSM.toLowerCase() === ADDRS.sessionManager.toLowerCase(),
    `sessionManager=${fSM}`);

  const fEP = await factory.entryPoint();
  check("AgentWalletFactory → EntryPoint",
    fEP.toLowerCase() === ADDRS.entryPoint.toLowerCase(),
    `entryPoint=${fEP}`);

  const fIdentity = await factory.agentIdentity();
  check("AgentWalletFactory → AgentIdentity",
    fIdentity.toLowerCase() === ADDRS.agentIdentity.toLowerCase(),
    `agentIdentity=${fIdentity}`);

  const fOwner = await factory.owner();
  check("AgentWalletFactory → Owner",
    fOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${fOwner}`);

  // ─── CredentialRegistry integrations ─────────────────────────────
  console.log("\n  CredentialRegistry Integrations:");

  const cr = await ethers.getContractAt("CredentialRegistry", ADDRS.credentialRegistry);

  const crSM = await cr.sessionManagers(ADDRS.sessionManager);
  check("CredentialRegistry ← SessionManager (authorized)",
    crSM === true,
    `sessionManagers[sm]=${crSM}`);

  const crOwner = await cr.owner();
  check("CredentialRegistry → Owner",
    crOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${crOwner}`);

  // ─── AgentIdentity integrations ──────────────────────────────────
  console.log("\n  AgentIdentity Integrations:");

  const ai = await ethers.getContractAt("AgentIdentity", ADDRS.agentIdentity);

  const aiFactory = await ai.walletFactory();
  check("AgentIdentity → AgentWalletFactory",
    aiFactory.toLowerCase() === ADDRS.agentWalletFactory.toLowerCase(),
    `walletFactory=${aiFactory}`);

  const aiOwner = await ai.owner();
  check("AgentIdentity → Owner",
    aiOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${aiOwner}`);

  // ─── CapabilityRegistry integrations ─────────────────────────────
  console.log("\n  CapabilityRegistry Integrations:");

  const capReg = await ethers.getContractAt("CapabilityRegistry", ADDRS.capabilityRegistry);

  const capOwner = await capReg.owner();
  check("CapabilityRegistry → Owner",
    capOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${capOwner}`);

  // ─── DelegationManager integrations ──────────────────────────────
  console.log("\n  DelegationManager Integrations:");

  const dm = await ethers.getContractAt("DelegationManager", ADDRS.delegationManager);

  // DelegationManager uses AccessControl, check DEFAULT_ADMIN_ROLE
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const dmAdmin = await dm.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  check("DelegationManager → Admin",
    dmAdmin === true,
    `deployer has DEFAULT_ADMIN_ROLE=${dmAdmin}`);

  // ─── OrganizationRegistry integrations ───────────────────────────
  console.log("\n  OrganizationRegistry Integrations:");

  const orgReg = await ethers.getContractAt("OrganizationRegistry", ADDRS.organizationRegistry);

  const orgOwner = await orgReg.owner();
  check("OrganizationRegistry → Owner",
    orgOwner.toLowerCase() === deployer.address.toLowerCase(),
    `owner=${orgOwner}`);

  // ─── Cross-contract call tests ───────────────────────────────────
  console.log("\n  Cross-Contract Call Tests:");

  // Test: SessionManager can check if an address is an agent wallet via Factory
  try {
    const isWallet = await sm.walletFactory();
    const factoryContract = await ethers.getContractAt("AgentWalletFactory", isWallet);
    const isAgent = await factoryContract.agentWallets(deployer.address);
    check("SessionManager → Factory.isAgentWallet()",
      true,
      `call succeeded, isAgent=${isAgent}`);
  } catch (e: any) {
    check("SessionManager → Factory.isAgentWallet()", false, e.message.slice(0, 80));
  }

  // Test: CredentialRegistry activeRoot readable
  try {
    const activeRoot = await cr.activeRoot();
    check("CredentialRegistry.activeRoot()",
      true,
      `activeRoot=${activeRoot.slice(0, 20)}...`);
  } catch (e: any) {
    check("CredentialRegistry.activeRoot()", false, e.message.slice(0, 80));
  }

  // Test: CredentialRegistry revokedSecretRoot readable
  try {
    const revokedRoot = await cr.revokedSecretRoot();
    check("CredentialRegistry.revokedSecretRoot()",
      true,
      `revokedRoot=${revokedRoot.slice(0, 20)}...`);
  } catch (e: any) {
    check("CredentialRegistry.revokedSecretRoot()", false, e.message.slice(0, 80));
  }

  // Test: Factory walletCount readable
  try {
    const count = await factory.walletCount();
    check("AgentWalletFactory.walletCount()",
      true,
      `walletCount=${count}`);
  } catch (e: any) {
    check("AgentWalletFactory.walletCount()", false, e.message.slice(0, 80));
  }

  // Test: Factory getAddress (predict wallet address)
  try {
    const salt = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const predicted = await factory.getAddress(salt);
    check("AgentWalletFactory.getAddress()",
      true,
      `predicted=${predicted.slice(0, 20)}...`);
  } catch (e: any) {
    check("AgentWalletFactory.getAddress()", false, e.message.slice(0, 80));
  }

  // ─── Timelock verification ───────────────────────────────────────
  console.log("\n  Timelock Verification:");

  const TIMELOCK = await sm.TIMELOCK_DELAY();
  check("SessionManager.TIMELOCK_DELAY",
    TIMELOCK === 2n * 24n * 60n * 60n,
    `${TIMELOCK} seconds (${Number(TIMELOCK) / 86400} days)`);

  const fTIMELOCK = await factory.TIMELOCK_DELAY();
  check("AgentWalletFactory.TIMELOCK_DELAY",
    fTIMELOCK === 2n * 24n * 60n * 60n,
    `${fTIMELOCK} seconds (${Number(fTIMELOCK) / 86400} days)`);

  // Check that initial factory was set (not pending)
  const pendingFactory = await sm.pendingWalletFactory();
  check("SessionManager — no pending factory",
    pendingFactory === ethers.ZeroAddress,
    `pendingWalletFactory=${pendingFactory}`);

  // ─── Summary ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("  ⚠️  Some integrations failed — review the output above.");
  } else {
    console.log("  ✅ All contract integrations verified successfully.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
