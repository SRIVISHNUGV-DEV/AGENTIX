import { ethers } from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
  console.log();

  // 1. Deploy Groth16Verifier
  console.log("1/7 Deploying Groth16Verifier...");
  const verifier = await ethers.deployContract("Groth16Verifier");
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`   Verifier: ${verifierAddr}`);

  // 2. Deploy CredentialRegistry
  console.log("2/7 Deploying CredentialRegistry...");
  const registry = await ethers.deployContract("CredentialRegistry");
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`   CredentialRegistry: ${registryAddr}`);

  // 3. Deploy SessionManager
  console.log("3/7 Deploying SessionManager...");
  const sessionManager = await ethers.deployContract("SessionManager", [
    verifierAddr,
    registryAddr
  ]);
  await sessionManager.waitForDeployment();
  const sessionManagerAddr = await sessionManager.getAddress();
  console.log(`   SessionManager: ${sessionManagerAddr}`);

  // 4. Deploy AgentWallet implementation
  console.log("4/7 Deploying AgentWallet...");
  const walletImplementation = await ethers.deployContract("AgentWallet");
  await walletImplementation.waitForDeployment();
  const walletImplAddr = await walletImplementation.getAddress();
  console.log(`   AgentWallet Impl: ${walletImplAddr}`);

  // 5. Deploy AgentWalletFactory
  console.log("5/7 Deploying AgentWalletFactory...");
  const walletFactory = await ethers.deployContract("AgentWalletFactory", [
    walletImplAddr,
    sessionManagerAddr,
    ENTRY_POINT_ADDRESS
  ]);
  await walletFactory.waitForDeployment();
  const walletFactoryAddr = await walletFactory.getAddress();
  console.log(`   AgentWalletFactory: ${walletFactoryAddr}`);

  // 6. Deploy CapabilityRegistry
  console.log("6/7 Deploying CapabilityRegistry...");
  const capReg = await ethers.deployContract("CapabilityRegistry");
  await capReg.waitForDeployment();
  const capRegAddr = await capReg.getAddress();
  console.log(`   CapabilityRegistry: ${capRegAddr}`);

  // 7. Deploy DelegationManager
  console.log("7/7 Deploying DelegationManager...");
  const delMan = await ethers.deployContract("DelegationManager");
  await delMan.waitForDeployment();
  const delManAddr = await delMan.getAddress();
  console.log(`   DelegationManager: ${delManAddr}`);

  // Configure CredentialRegistry with SessionManager
  console.log("\nConfiguring CredentialRegistry.setSessionManager...");
  const registryContract = await ethers.getContractAt("CredentialRegistry", registryAddr);
  const tx = await registryContract.setSessionManager(sessionManagerAddr, true);
  await tx.wait();
  console.log("   Done.");

  const output = {
    deployer: deployer.address,
    verifier: verifierAddr,
    credentialRegistry: registryAddr,
    sessionManager: sessionManagerAddr,
    agentWalletImplementation: walletImplAddr,
    agentWalletFactory: walletFactoryAddr,
    entryPoint: ENTRY_POINT_ADDRESS,
    capabilityRegistry: capRegAddr,
    delegationManager: delManAddr,
  };

  console.log("\n" + JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
