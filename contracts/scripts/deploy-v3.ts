import { ethers } from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} ETH`);
  console.log(`Chain: ${(await ethers.provider.getNetwork()).chainId}\n`);

  // 1. Groth16Verifier
  console.log("1. Groth16Verifier...");
  const VerifierF = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await VerifierF.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`   ${verifierAddr}`);

  // 2. CredentialRegistry (UUPS)
  console.log("2. CredentialRegistry...");
  const CredRegImplF = await ethers.getContractFactory("CredentialRegistry");
  const credRegImpl = await CredRegImplF.deploy();
  await credRegImpl.waitForDeployment();
  const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
  const credRegProxy = await ProxyF.deploy(
    await credRegImpl.getAddress(),
    credRegImpl.interface.encodeFunctionData("initialize", [deployer.address])
  );
  await credRegProxy.waitForDeployment();
  const credRegAddr = await credRegProxy.getAddress();
  console.log(`   Proxy: ${credRegAddr}  Impl: ${await credRegImpl.getAddress()}`);

  // 3. AgentWallet impl (non-upgradeable)
  console.log("3. AgentWallet...");
  const WalletF = await ethers.getContractFactory("AgentWallet");
  const walletImpl = await WalletF.deploy();
  await walletImpl.waitForDeployment();
  const walletImplAddr = await walletImpl.getAddress();
  console.log(`   ${walletImplAddr}`);

  // 4. AgentWalletFactory (UUPS) — needs SM address, use placeholder first
  console.log("4. AgentWalletFactory...");
  const FactoryF = await ethers.getContractFactory("AgentWalletFactory");
  const factoryImpl = await FactoryF.deploy();
  await factoryImpl.waitForDeployment();

  // Deploy factory proxy with placeholder SM address (will be updated)
  const PLACEHOLDER_SM = "0x0000000000000000000000000000000000000001";
  const factoryProxy = await ProxyF.deploy(
    await factoryImpl.getAddress(),
    factoryImpl.interface.encodeFunctionData("initialize", [
      walletImplAddr, PLACEHOLDER_SM, ENTRY_POINT_ADDRESS
    ])
  );
  await factoryProxy.waitForDeployment();
  const factoryAddr = await factoryProxy.getAddress();
  console.log(`   Proxy: ${factoryAddr}  Impl: ${await factoryImpl.getAddress()}`);

  // 5. SessionManager (UUPS) — now we have all dependencies
  console.log("5. SessionManager...");
  const SessMgrF = await ethers.getContractFactory("SessionManager");
  const sessMgrImpl = await SessMgrF.deploy();
  await sessMgrImpl.waitForDeployment();
  const sessMgrProxy = await ProxyF.deploy(
    await sessMgrImpl.getAddress(),
    sessMgrImpl.interface.encodeFunctionData("initialize", [
      verifierAddr, credRegAddr, factoryAddr
    ])
  );
  await sessMgrProxy.waitForDeployment();
  const sessMgrAddr = await sessMgrProxy.getAddress();
  console.log(`   Proxy: ${sessMgrAddr}  Impl: ${await sessMgrImpl.getAddress()}`);

  // 6. Update factory's sessionManager reference
  console.log("6. Link factory -> sessionManager...");
  const factory = await ethers.getContractAt("AgentWalletFactory", factoryAddr);
  let tx = await factory.setSessionManager(sessMgrAddr);
  await tx.wait();
  console.log("   Done.");

  // 7. CapabilityRegistry (UUPS)
  console.log("7. CapabilityRegistry...");
  const CapRegF = await ethers.getContractFactory("CapabilityRegistry");
  const capRegImpl = await CapRegF.deploy();
  await capRegImpl.waitForDeployment();
  const capRegProxy = await ProxyF.deploy(
    await capRegImpl.getAddress(),
    capRegImpl.interface.encodeFunctionData("initialize", [deployer.address])
  );
  await capRegProxy.waitForDeployment();
  console.log(`   Proxy: ${await capRegProxy.getAddress()}  Impl: ${await capRegImpl.getAddress()}`);

  // 8. DelegationManager (UUPS)
  console.log("8. DelegationManager...");
  const DelMgrF = await ethers.getContractFactory("DelegationManager");
  const delMgrImpl = await DelMgrF.deploy();
  await delMgrImpl.waitForDeployment();
  const delMgrProxy = await ProxyF.deploy(
    await delMgrImpl.getAddress(),
    delMgrImpl.interface.encodeFunctionData("initialize", [deployer.address])
  );
  await delMgrProxy.waitForDeployment();
  console.log(`   Proxy: ${await delMgrProxy.getAddress()}  Impl: ${await delMgrImpl.getAddress()}`);

  // 9. Configure CredentialRegistry
  console.log("9. Configure CredentialRegistry...");
  const credReg = await ethers.getContractAt("CredentialRegistry", credRegAddr);
  tx = await credReg.setSessionManager(sessMgrAddr, true);
  await tx.wait();
  console.log("   Done.");

  const output = {
    deployer: deployer.address,
    verifier: verifierAddr,
    credentialRegistry: { proxy: credRegAddr, implementation: await credRegImpl.getAddress() },
    sessionManager: { proxy: sessMgrAddr, implementation: await sessMgrImpl.getAddress() },
    agentWalletImplementation: walletImplAddr,
    agentWalletFactory: { proxy: factoryAddr, implementation: await factoryImpl.getAddress() },
    entryPoint: ENTRY_POINT_ADDRESS,
    capabilityRegistry: { proxy: await capRegProxy.getAddress(), implementation: await capRegImpl.getAddress() },
    delegationManager: { proxy: await delMgrProxy.getAddress(), implementation: await delMgrImpl.getAddress() },
  };

  console.log("\n" + JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
