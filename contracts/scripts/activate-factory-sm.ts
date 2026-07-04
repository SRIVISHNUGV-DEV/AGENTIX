import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

async function main() {
  const [signer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  const outputPath = path.join(DEPLOYMENTS_DIR, `${networkInfo.name}-${networkInfo.chainId}.json`);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Deployment file not found: ${outputPath}\nRun deploy-v5.ts first.`);
  }

  const state = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const factoryAddr = state.phase3.agentWalletFactory.proxy;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Activate Factory → SessionManager Link");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${networkInfo.name}`);
  console.log(`  Factory:  ${factoryAddr}`);
  console.log(`  Signer:   ${signer.address}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const factory = await ethers.getContractAt("AgentWalletFactory", factoryAddr);

  // Check pending state
  const pendingSM = await factory.pendingSessionManager();
  const activationTime = await factory.sessionManagerActivationTime();
  const currentBlock = await ethers.provider.getBlock("latest");

  if (pendingSM === ethers.ZeroAddress) {
    console.log("  ❌ No pending SessionManager. Run deploy-v5.ts first.");
    return;
  }

  console.log(`  Pending SM:  ${pendingSM}`);
  console.log(`  Activates:   ${new Date(Number(activationTime) * 1000).toISOString()}`);
  console.log(`  Now:         ${new Date(Number(currentBlock!.timestamp) * 1000).toISOString()}`);

  if (Number(currentBlock!.timestamp) < Number(activationTime)) {
    const remaining = Number(activationTime) - Number(currentBlock!.timestamp);
    console.log(`  ⏳ Timelock not ready. ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m remaining.`);
    console.log(`     Try again after ${new Date(Number(activationTime) * 1000).toISOString()}`);
    return;
  }

  console.log("\n  Activating...");
  const tx = await factory.acceptSessionManager();
  await tx.wait();

  // Update state
  state.configuration.factorySessionManagerLinked = true;
  delete state.configuration.factorySessionManagerActivationTime;
  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2));

  const currentSM = await factory.sessionManager();
  console.log(`  ✅ SessionManager linked: ${currentSM}`);
  console.log(`  ✅ Deployment state updated\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
