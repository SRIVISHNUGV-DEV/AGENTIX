import { ethers, run } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Etherscan/Basescan verification for all deployed contracts.
 *
 * Usage:
 *   npx hardhat run scripts/verify-all.ts --network baseSepolia
 *
 * Reads addresses from deploy-output.json (written by deploy.ts).
 */

function loadDeployments() {
  const deployPath = path.resolve(__dirname, "../deploy-output.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error(`deploy-output.json not found at ${deployPath}\nRun deploy.ts first.`);
  }
  return JSON.parse(fs.readFileSync(deployPath, "utf-8"));
}

async function main() {
  const deployData = loadDeployments();
  const contracts = deployData.contracts;
  const networkInfo = await ethers.provider.getNetwork();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Contract Verification");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network: ${networkInfo.name} (chainId: ${networkInfo.chainId})`);
  console.log("═══════════════════════════════════════════════════════\n");

  // All implementations to verify (no constructor args for UUPS impls)
  const toVerify: [string, string, unknown[]][] = [
    // Standalone
    ["Groth16Verifier", contracts.groth16Verifier, []],
    ["AgentWallet", contracts.agentWalletImpl, []],
    ["OrganizationCredentialAnchor", contracts.anchorImpl, []],
    // UUPS implementations
    ["CredentialRegistry", contracts.CredentialRegistry?.implementation || contracts.credentialRegistry?.impl, []],
    ["SessionManager", contracts.SessionManager?.implementation || contracts.sessionManager?.impl, []],
    ["AgentWalletFactory", contracts.AgentWalletFactory?.implementation || contracts.agentWalletFactory?.impl, []],
    ["CapabilityRegistry", contracts.CapabilityRegistry?.implementation || contracts.capabilityRegistry?.impl, []],
    ["DelegationManager", contracts.DelegationManager?.implementation || contracts.delegationManager?.impl, []],
    ["OrganizationRegistry", contracts.OrganizationRegistry?.implementation || contracts.organizationRegistry?.impl, []],
    ["AgentIdentity", contracts.AgentIdentity?.implementation || contracts.agentIdentity?.impl, []],
  ];

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const [contractName, address, constructorArgs] of toVerify) {
    if (!address) {
      console.log(`  SKIP  ${contractName} — no address in deploy-output.json`);
      skipped++;
      continue;
    }

    console.log(`  Verifying ${contractName} (${address})...`);

    try {
      await run("verify:verify", {
        address,
        constructorArguments: constructorArgs,
      });
      console.log(`  OK    ${contractName} verified`);
      success++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log(`  OK    ${contractName} already verified`);
        success++;
      } else {
        console.log(`  FAIL  ${contractName}: ${msg.substring(0, 120)}`);
        failed++;
      }
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  Results: ${success} verified, ${failed} failed, ${skipped} skipped`);
  console.log(`═══════════════════════════════════════════════════════\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
