import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

/**
 * Post-deployment configuration script.
 *
 * Usage:
 *   npx hardhat run scripts/configure.ts --network baseSepolia
 *
 * What it does:
 *   1. Reads the deployment state file
 *   2. Verifies all wiring is correct
 *   3. Applies any pending configuration (issuers, roles, etc.)
 *   4. Optionally registers test organizations
 *
 * Safe to re-run — all operations are idempotent or checked before execution.
 */

interface OrgConfig {
  id: string;
  name: string;
  owner: string;
}

// Add organizations to register here
const ORGANIZATIONS: OrgConfig[] = [];

// Add issuers to authorize on CredentialRegistry
const ADDITIONAL_ISSUERS: string[] = [];

// Add ROOT_UPDATER roles on DelegationManager
const ROOT_UPDATERS: string[] = [];

async function main() {
  const [signer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const outputPath = path.join(DEPLOYMENTS_DIR, `${networkInfo.name}-${networkInfo.chainId}.json`);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Deployment file not found: ${outputPath}\nRun deploy-v5.ts first.`);
  }

  const state = JSON.parse(fs.readFileSync(outputPath, "utf8"));

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Post-Deployment Configuration");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${networkInfo.name} (chainId: ${networkInfo.chainId})`);
  console.log(`  Signer:   ${signer.address}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── Verify Factory → SM link ────────────────────────────────────────────
  const factoryAddr = state.phase3.agentWalletFactory.proxy;
  const smAddr = state.phase4.sessionManager.proxy;
  const factory = await ethers.getContractAt("AgentWalletFactory", factoryAddr);
  const currentSM = await factory.sessionManager();

  if (currentSM.toLowerCase() !== smAddr.toLowerCase()) {
    console.log("  ⚠️  Factory SessionManager not yet linked!");
    console.log(`     Expected: ${smAddr}`);
    console.log(`     Current:  ${currentSM}`);
    console.log("     Run activate-factory-sm.ts after timelock.\n");
  } else {
    console.log("  ✅ Factory → SessionManager: linked\n");
  }

  // ─── Verify CredentialRegistry → SM link ─────────────────────────────────
  const credRegAddr = state.phase2.credentialRegistry.proxy;
  const credReg = await ethers.getContractAt("CredentialRegistry", credRegAddr);
  const smAllowed = await credReg.sessionManagers(smAddr);
  console.log(`  ${smAllowed ? "✅" : "❌"} CredentialRegistry → SessionManager: ${smAllowed ? "authorized" : "NOT authorized"}`);

  // ─── Verify Factory → Identity link ──────────────────────────────────────
  const identityAddr = state.phase5.agentIdentity.proxy;
  const factoryIdentity = await factory.agentIdentity();
  const identityLinked = factoryIdentity.toLowerCase() === identityAddr.toLowerCase();
  console.log(`  ${identityLinked ? "✅" : "❌"} Factory → AgentIdentity: ${identityLinked ? "linked" : "NOT linked"}`);

  // ─── Register additional issuers on CredentialRegistry ───────────────────
  if (ADDITIONAL_ISSUERS.length > 0) {
    console.log("\n─── Authorizing Issuers ─────────────────────────────\n");
    for (const issuer of ADDITIONAL_ISSUERS) {
      const alreadyIssuer = await credReg.issuers(issuer);
      if (alreadyIssuer) {
        console.log(`  ${issuer} — already authorized`);
        continue;
      }
      const tx = await credReg.addIssuer(issuer);
      await tx.wait();
      console.log(`  ✅ ${issuer} — authorized`);
    }
  }

  // ─── Register ROOT_UPDATERS on DelegationManager ─────────────────────────
  if (ROOT_UPDATERS.length > 0) {
    console.log("\n─── Authorizing ROOT_UPDATERS ───────────────────────\n");
    const delMgrAddr = state.phase1.delegationManager.proxy;
    const ROOT_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ROOT_UPDATER"));
    const delMgr = await ethers.getContractAt("DelegationManager", delMgrAddr);

    for (const updater of ROOT_UPDATERS) {
      const hasRole = await delMgr.hasRole(ROOT_UPDATER_ROLE, updater);
      if (hasRole) {
        console.log(`  ${updater} — already authorized`);
        continue;
      }
      const tx = await delMgr.setRootUpdater(updater, true);
      await tx.wait();
      console.log(`  ✅ ${updater} — authorized`);
    }
  }

  // ─── Register Organizations ──────────────────────────────────────────────
  if (ORGANIZATIONS.length > 0) {
    console.log("\n─── Registering Organizations ───────────────────────\n");
    const orgRegAddr = state.phase3.organizationRegistry.proxy;
    const orgReg = await ethers.getContractAt("OrganizationRegistry", orgRegAddr);

    for (const org of ORGANIZATIONS) {
      const exists = await orgReg.organizationExists(org.id);
      if (exists) {
        console.log(`  ${org.name} (${org.id}) — already registered`);
        continue;
      }
      const tx = await orgReg.registerOrganization(org.id, org.name, org.owner);
      await tx.wait();
      const anchor = await orgReg.getCredentialAnchor(org.id);
      console.log(`  ✅ ${org.name} — anchor: ${anchor}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Configuration complete");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
