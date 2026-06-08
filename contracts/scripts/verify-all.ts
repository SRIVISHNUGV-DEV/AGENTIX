import { ethers } from "hardhat";
import hre from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function main() {
  const addresses = process.env.DEPLOYED_ADDRESSES
    ? JSON.parse(process.env.DEPLOYED_ADDRESSES)
    : await loadFromLatestDeploy();

  console.log("Verifying all contracts on Base Sepolia...\n");

  const contracts = [
    { name: "Groth16Verifier", address: addresses.verifier, args: [] },
    { name: "CredentialRegistry", address: addresses.credentialRegistry, args: [] },
    { name: "SessionManager", address: addresses.sessionManager, args: [addresses.verifier, addresses.credentialRegistry] },
    { name: "AgentWallet", address: addresses.agentWalletImplementation, args: [] },
    { name: "AgentWalletFactory", address: addresses.agentWalletFactory, args: [addresses.agentWalletImplementation, addresses.sessionManager, ENTRY_POINT_ADDRESS] },
    { name: "CapabilityRegistry", address: addresses.capabilityRegistry, args: [] },
    { name: "DelegationManager", address: addresses.delegationManager, args: [] },
  ];

  for (const c of contracts) {
    console.log(`Verifying ${c.name} at ${c.address}...`);
    try {
      await hre.run("verify:verify", {
        address: c.address,
        constructorArguments: c.args,
      });
      console.log(`   ✅ ${c.name} verified`);
    } catch (err: any) {
      if (err.message?.includes("Already Verified")) {
        console.log(`   ⏭️  ${c.name} already verified`);
      } else {
        console.error(`   ❌ ${c.name} verification failed:`, err.message);
      }
    }
    console.log();
  }

  console.log("Done.");
}

async function loadFromLatestDeploy() {
  const fs = await import("fs");
  const path = await import("path");
  const deployLogPath = path.resolve(__dirname, "../deploy-output.json");
  if (fs.existsSync(deployLogPath)) {
    return JSON.parse(fs.readFileSync(deployLogPath, "utf8"));
  }
  throw new Error("No DEPLOYED_ADDRESSES env var and no deploy-output.json found");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
