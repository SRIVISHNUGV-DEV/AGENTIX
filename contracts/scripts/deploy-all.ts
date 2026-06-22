import { ethers } from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function deployWithRetry(contractName: string, args?: any[], retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const Factory = await ethers.getContractFactory(contractName);
      const tx = await Factory.deploy(...(args || []));
      await tx.waitForDeployment();
      return tx;
    } catch (e: any) {
      console.log(`    Attempt ${i + 1} failed for ${contractName}: ${e.message?.substring(0, 80)}`);
      if (i < retries - 1) {
        await sleep(8000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Deploy failed after retries");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
  console.log();

  // 1. Deploy Groth16Verifier (non-upgradeable)
  console.log("1/8 Deploying Groth16Verifier...");
  const verifier = await ethers.deployContract("Groth16Verifier");
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`   Verifier: ${verifierAddr}`);

  // 2. Deploy CredentialRegistry (UUPS)
  console.log("2/8 Deploying CredentialRegistry...");
  const credRegImpl = await ethers.deployContract("CredentialRegistry");
  await credRegImpl.waitForDeployment();
  const credRegImplAddr = await credRegImpl.getAddress();
  const credRegProxy = await ethers.deployContract("ERC1967Proxy", [
    credRegImplAddr,
    credRegImpl.interface.encodeFunctionData("initialize", [deployer.address])
  ]);
  await credRegProxy.waitForDeployment();
  const credRegAddr = await credRegProxy.getAddress();
  console.log(`   Proxy: ${credRegAddr}`);
  console.log(`   Impl:  ${credRegImplAddr}`);

  // 3. Deploy SessionManager (UUPS) — needs verifier, registry, walletFactory (set later)
  console.log("3/8 Deploying SessionManager...");
  const sessMgrImpl = await deployWithRetry("SessionManager");
  const sessMgrImplAddr = await sessMgrImpl.getAddress();
  // We'll initialize after factory is deployed
  const sessMgrProxy = await ethers.deployContract("ERC1967Proxy", [
    sessMgrImplAddr, "0x"
  ]);
  await sessMgrProxy.waitForDeployment();
  const sessMgrAddr = await sessMgrProxy.getAddress();
  console.log(`   Proxy: ${sessMgrAddr}`);
  console.log(`   Impl:  ${sessMgrImplAddr}`);

  // 4. Deploy AgentWallet implementation (non-upgradeable clone source)
  console.log("4/8 Deploying AgentWallet...");
  const walletImpl = await ethers.deployContract("AgentWallet");
  await walletImpl.waitForDeployment();
  const walletImplAddr = await walletImpl.getAddress();
  console.log(`   Impl: ${walletImplAddr}`);

  // 5. Deploy AgentWalletFactory (UUPS)
  console.log("5/8 Deploying AgentWalletFactory...");
  const factoryImpl = await ethers.deployContract("AgentWalletFactory");
  await factoryImpl.waitForDeployment();
  const factoryImplAddr = await factoryImpl.getAddress();
  const factoryProxy = await ethers.deployContract("ERC1967Proxy", [
    factoryImplAddr,
    factoryImpl.interface.encodeFunctionData("initialize", [
      walletImplAddr, sessMgrAddr, ENTRY_POINT_ADDRESS
    ])
  ]);
  await factoryProxy.waitForDeployment();
  const factoryAddr = await factoryProxy.getAddress();
  console.log(`   Proxy: ${factoryAddr}`);
  console.log(`   Impl:  ${factoryImplAddr}`);

  // 6. Initialize SessionManager (now that factory is deployed)
  console.log("6/8 Initializing SessionManager...");
  const sessMgr = await ethers.getContractAt("SessionManager", sessMgrAddr);
  const initTx = await sessMgr.initialize(verifierAddr, credRegAddr, factoryAddr);
  await initTx.wait();
  console.log("   Done.");

  // 7. Deploy CapabilityRegistry (UUPS)
  console.log("7/8 Deploying CapabilityRegistry...");
  const capRegImpl = await ethers.deployContract("CapabilityRegistry");
  await capRegImpl.waitForDeployment();
  const capRegImplAddr = await capRegImpl.getAddress();
  const capRegProxy = await ethers.deployContract("ERC1967Proxy", [
    capRegImplAddr,
    capRegImpl.interface.encodeFunctionData("initialize", [deployer.address])
  ]);
  await capRegProxy.waitForDeployment();
  const capRegAddr = await capRegProxy.getAddress();
  console.log(`   Proxy: ${capRegAddr}`);
  console.log(`   Impl:  ${capRegImplAddr}`);

  // 8. Deploy DelegationManager (UUPS)
  console.log("8/8 Deploying DelegationManager...");
  const delMgrImpl = await ethers.deployContract("DelegationManager");
  await delMgrImpl.waitForDeployment();
  const delMgrImplAddr = await delMgrImpl.getAddress();
  const delMgrProxy = await ethers.deployContract("ERC1967Proxy", [
    delMgrImplAddr,
    delMgrImpl.interface.encodeFunctionData("initialize", [deployer.address])
  ]);
  await delMgrProxy.waitForDeployment();
  const delMgrAddr = await delMgrProxy.getAddress();
  console.log(`   Proxy: ${delMgrAddr}`);
  console.log(`   Impl:  ${delMgrImplAddr}`);

  // 9. Configure CredentialRegistry — set SessionManager as authorized nullifier consumer
  console.log("9/9 Configuring CredentialRegistry...");
  const credReg = await ethers.getContractAt("CredentialRegistry", credRegAddr);
  const cfgTx = await credReg.setSessionManager(sessMgrAddr, true);
  await cfgTx.wait();
  console.log("   Done.");

  const output = {
    deployer: deployer.address,
    verifier: verifierAddr,
    credentialRegistry: { proxy: credRegAddr, implementation: credRegImplAddr },
    sessionManager: { proxy: sessMgrAddr, implementation: sessMgrImplAddr },
    agentWalletImplementation: walletImplAddr,
    agentWalletFactory: { proxy: factoryAddr, implementation: factoryImplAddr },
    entryPoint: ENTRY_POINT_ADDRESS,
    capabilityRegistry: { proxy: capRegAddr, implementation: capRegImplAddr },
    delegationManager: { proxy: delMgrAddr, implementation: delMgrImplAddr },
  };

  console.log("\n" + JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
