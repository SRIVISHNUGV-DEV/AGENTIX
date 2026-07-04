import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

/**
 * Post-deployment wiring integrity checker.
 *
 * Usage:
 *   npx hardhat run scripts/check-wiring.ts --network baseSepolia
 *
 * Validates every cross-contract reference is correctly set.
 * Reports PASS/FAIL for each wiring point.
 */

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function main() {
  const networkInfo = await ethers.provider.getNetwork();
  const outputPath = path.join(DEPLOYMENTS_DIR, `${networkInfo.name}-${networkInfo.chainId}.json`);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Deployment file not found: ${outputPath}\nRun deploy-v5.ts first.`);
  }

  const state = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const results: CheckResult[] = [];

  const verifierAddr = state.phase1.groth16Verifier.address;
  const credRegAddr = state.phase2.credentialRegistry.proxy;
  const anchorAddr = state.phase2.organizationCredentialAnchor.address;
  const orgRegAddr = state.phase3.organizationRegistry.proxy;
  const walletImplAddr = state.phase3.agentWalletImplementation.address;
  const factoryAddr = state.phase3.agentWalletFactory.proxy;
  const smAddr = state.phase4.sessionManager.proxy;
  const capRegAddr = state.phase1.capabilityRegistry.proxy;
  const delMgrAddr = state.phase1.delegationManager.proxy;
  const identityAddr = state.phase5.agentIdentity.proxy;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Wiring Integrity Check");
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── 1. SessionManager → Verifier ────────────────────────────────────────
  const sm = await ethers.getContractAt("SessionManager", smAddr);
  const smVerifier = await sm.verifier();
  results.push({
    name: "SessionManager → Verifier",
    pass: smVerifier.toLowerCase() === verifierAddr.toLowerCase(),
    detail: `expected=${verifierAddr}, actual=${smVerifier}`,
  });

  // ─── 2. SessionManager → CredentialRegistry ──────────────────────────────
  const smRegistry = await sm.registry();
  results.push({
    name: "SessionManager → CredentialRegistry",
    pass: smRegistry.toLowerCase() === credRegAddr.toLowerCase(),
    detail: `expected=${credRegAddr}, actual=${smRegistry}`,
  });

  // ─── 3. SessionManager → AgentWalletFactory ──────────────────────────────
  const smFactory = await sm.walletFactory();
  results.push({
    name: "SessionManager → AgentWalletFactory",
    pass: smFactory.toLowerCase() === factoryAddr.toLowerCase(),
    detail: `expected=${factoryAddr}, actual=${smFactory}`,
  });

  // ─── 4. CredentialRegistry → SessionManager (authorized) ─────────────────
  const cr = await ethers.getContractAt("CredentialRegistry", credRegAddr);
  const crSmAllowed = await cr.sessionManagers(smAddr);
  results.push({
    name: "CredentialRegistry → SessionManager (authorized)",
    pass: crSmAllowed === true,
    detail: `sessionManagers[${smAddr}] = ${crSmAllowed}`,
  });

  // ─── 5. AgentWalletFactory → SessionManager ──────────────────────────────
  const factory = await ethers.getContractAt("AgentWalletFactory", factoryAddr);
  const factorySm = await factory.sessionManager();
  const factorySmLinked = factorySm.toLowerCase() === smAddr.toLowerCase();
  results.push({
    name: "AgentWalletFactory → SessionManager",
    pass: factorySmLinked,
    detail: factorySmLinked
      ? `linked: ${factorySm}`
      : `NOT linked — pending=${await factory.pendingSessionManager()}, current=${factorySm}`,
  });

  // ─── 6. AgentWalletFactory → EntryPoint ──────────────────────────────────
  const factoryEp = await factory.entryPoint();
  const ENTRY_POINT = process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
  results.push({
    name: "AgentWalletFactory → EntryPoint",
    pass: factoryEp.toLowerCase() === ENTRY_POINT.toLowerCase(),
    detail: `expected=${ENTRY_POINT}, actual=${factoryEp}`,
  });

  // ─── 7. AgentWalletFactory → AgentIdentity ──────────────────────────────
  const factoryIdentity = await factory.agentIdentity();
  const identityLinked = factoryIdentity.toLowerCase() === identityAddr.toLowerCase();
  results.push({
    name: "AgentWalletFactory → AgentIdentity",
    pass: identityLinked,
    detail: identityLinked
      ? `linked: ${factoryIdentity}`
      : `NOT linked — actual=${factoryIdentity}, expected=${identityAddr}`,
  });

  // ─── 8. AgentWalletFactory → AgentWallet Implementation ──────────────────
  const factoryImpl = await factory.implementation();
  results.push({
    name: "AgentWalletFactory → AgentWallet (impl)",
    pass: factoryImpl.toLowerCase() === walletImplAddr.toLowerCase(),
    detail: `expected=${walletImplAddr}, actual=${factoryImpl}`,
  });

  // ─── 9. OrganizationRegistry → Anchor Implementation ─────────────────────
  const orgReg = await ethers.getContractAt("OrganizationRegistry", orgRegAddr);
  const orgAnchorImpl = await orgReg.anchorImplementation();
  results.push({
    name: "OrganizationRegistry → Anchor (impl)",
    pass: orgAnchorImpl.toLowerCase() === anchorAddr.toLowerCase(),
    detail: `expected=${anchorAddr}, actual=${orgAnchorImpl}`,
  });

  // ─── 10. AgentIdentity → AgentWalletFactory ──────────────────────────────
  const identity = await ethers.getContractAt("AgentIdentity", identityAddr);
  const identityFactory = await identity.walletFactory();
  results.push({
    name: "AgentIdentity → AgentWalletFactory",
    pass: identityFactory.toLowerCase() === factoryAddr.toLowerCase(),
    detail: `expected=${factoryAddr}, actual=${identityFactory}`,
  });

  // ─── 11. CredentialRegistry — owner is deployer ──────────────────────────
  const crOwner = await cr.owner();
  results.push({
    name: "CredentialRegistry — owner is deployer",
    pass: crOwner.toLowerCase() === state.deployer.toLowerCase(),
    detail: `owner=${crOwner}, deployer=${state.deployer}`,
  });

  // ─── 12. SessionManager — owner is deployer ──────────────────────────────
  const smOwner = await sm.owner();
  results.push({
    name: "SessionManager — owner is deployer",
    pass: smOwner.toLowerCase() === state.deployer.toLowerCase(),
    detail: `owner=${smOwner}, deployer=${state.deployer}`,
  });

  // ─── 13. AgentWalletFactory — owner is deployer ──────────────────────────
  const factoryOwner = await factory.owner();
  results.push({
    name: "AgentWalletFactory — owner is deployer",
    pass: factoryOwner.toLowerCase() === state.deployer.toLowerCase(),
    detail: `owner=${factoryOwner}, deployer=${state.deployer}`,
  });

  // ─── Print Results ──────────────────────────────────────────────────────
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}`);
    if (!r.pass) {
      console.log(`       ${r.detail}`);
      failed++;
    } else {
      passed++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  ${passed}/${results.length} checks passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
