import { ethers } from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function main() {
  const verifier = await ethers.deployContract("Groth16Verifier");
  await verifier.waitForDeployment();

  const registry = await ethers.deployContract("CredentialRegistry");
  await registry.waitForDeployment();

  const sessionManager = await ethers.deployContract("SessionManager", [
    await verifier.getAddress(),
    await registry.getAddress()
  ]);
  await sessionManager.waitForDeployment();

  const walletImplementation = await ethers.deployContract("AgentWallet");
  await walletImplementation.waitForDeployment();

  const walletFactory = await ethers.deployContract("AgentWalletFactory", [
    await walletImplementation.getAddress(),
    await sessionManager.getAddress(),
    ENTRY_POINT_ADDRESS
  ]);
  await walletFactory.waitForDeployment();

  const registryContract = await ethers.getContractAt(
    "CredentialRegistry",
    await registry.getAddress()
  );
  await (await registryContract.setSessionManager(
    await sessionManager.getAddress(),
    true
  )).wait();

  console.log(JSON.stringify({
    verifier: await verifier.getAddress(),
    credentialRegistry: await registry.getAddress(),
    sessionManager: await sessionManager.getAddress(),
    agentWalletImplementation: await walletImplementation.getAddress(),
    agentWalletFactory: await walletFactory.getAddress(),
    entryPoint: ENTRY_POINT_ADDRESS
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
