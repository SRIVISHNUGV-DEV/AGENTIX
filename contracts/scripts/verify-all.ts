import { ethers, run, network } from "hardhat";
import fs from "fs";
import path from "path";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

/**
 * Etherscan/Basescan verification for all deployed contracts.
 *
 * Usage:
 *   npx hardhat run scripts/verify-all.ts --network baseSepolia
 *
 * Verifies:
 *   - All UUPS proxy implementations
 *   - Standalone contracts (Groth16Verifier, AgentWallet impl)
 *   - ERC1967Proxy contracts (optional — proxies are bytecode-identical)
 */

// Contract name → constructor args mapping
function getVerifyArgs(state: Record<string, unknown>) {
  const args: [string, unknown[], string][] = [];

  // Standalone contracts
  args.push(["Groth16Verifier", [], "Groth16Verifier"]);

  // UUPS implementations (all have empty constructors — Initializable handles init)
  const uupsContracts = [
    ["CredentialRegistry", state.phase2.credentialRegistry.implementation, "CredentialRegistry Impl"],
    ["OrganizationCredentialAnchor", state.phase2.organizationCredentialAnchor.address, "OrgCredentialAnchor Impl"],
    ["OrganizationRegistry", state.phase3.organizationRegistry.implementation, "OrganizationRegistry Impl"],
    ["SessionManager", state.phase4.sessionManager.implementation, "SessionManager Impl"],
    ["AgentWalletFactory", state.phase3.agentWalletFactory.implementation, "AgentWalletFactory Impl"],
    ["CapabilityRegistry", state.phase1.capabilityRegistry.implementation, "CapabilityRegistry Impl"],
    ["DelegationManager", state.phase1.delegationManager.implementation, "DelegationManager Impl"],
    ["AgentIdentity", state.phase5.agentIdentity.implementation, "AgentIdentity Impl"],
  ];

  for (const [contractName, address, label] of uupsContracts) {
    args.push([contractName as string, [], label]);
  }

  // AgentWallet implementation (non-upgradeable, no constructor args)
  args.push(["AgentWallet", [], "AgentWallet Impl"]);

  return args;
}

async function main() {
  const networkInfo = await ethers.provider.getNetwork();
  const outputPath = path.join(DEPLOYMENTS_DIR, `${networkInfo.name}-${networkInfo.chainId}.json`);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Deployment file not found: ${outputPath}\nRun deploy-v5.ts first.`);
  }

  const state = JSON.parse(fs.readFileSync(outputPath, "utf8"));

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentIX Contract Verification");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network: ${networkInfo.name} (chainId: ${networkInfo.chainId})`);
  console.log("═══════════════════════════════════════════════════════\n");

  const verifyArgs = getVerifyArgs(state);
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const [contractName, constructorArgs, label] of verifyArgs) {
    // Find the address from state
    let address = "";
    for (const phase of [state.phase1, state.phase2, state.phase3, state.phase4, state.phase5]) {
      for (const key of Object.keys(phase)) {
        const dep = phase[key];
        if (dep && typeof dep === "object") {
          if (dep.implementation === state.phase2?.credentialRegistry?.implementation && contractName === "CredentialRegistry") {
            address = dep.implementation;
          } else if (dep.address && dep.name === contractName) {
            address = dep.address;
          }
        }
      }
    }

    // Map by known addresses from state
    const addressMap: Record<string, string> = {
      "Groth16Verifier": state.phase1.groth16Verifier.address,
      "CredentialRegistry": state.phase2.credentialRegistry.implementation,
      "OrganizationCredentialAnchor": state.phase2.organizationCredentialAnchor.address,
      "OrganizationRegistry": state.phase3.organizationRegistry.implementation,
      "SessionManager": state.phase4.sessionManager.implementation,
      "AgentWalletFactory": state.phase3.agentWalletFactory.implementation,
      "CapabilityRegistry": state.phase1.capabilityRegistry.implementation,
      "DelegationManager": state.phase1.delegationManager.implementation,
      "AgentIdentity": state.phase5.agentIdentity.implementation,
      "AgentWallet": state.phase3.agentWalletImplementation.address,
    };

    address = addressMap[contractName] || address;

    if (!address) {
      console.log(`  ⏭️  ${label} — no address found, skipping`);
      skipped++;
      continue;
    }

    console.log(`  Verifying ${label} (${address})...`);

    try {
      await run("verify:verify", {
        address,
        constructorArguments: constructorArgs,
      });
      console.log(`  ✅ ${label} verified`);
      success++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Already Verified")) {
        console.log(`  ✅ ${label} already verified`);
        success++;
      } else {
        console.log(`  ❌ ${label} failed: ${msg}`);
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
