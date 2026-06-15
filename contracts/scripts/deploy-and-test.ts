import { ethers } from "hardhat";

const ENTRY_POINT_ADDRESS =
  process.env.ENTRY_POINT_ADDRESS || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sendAndWait(txPromise: Promise<any>, delay = 3000): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tx = await txPromise;
      if (tx?.wait) await tx.wait(1);
      await ethers.provider.getBlock("latest");
      await sleep(delay);
      return tx;
    } catch (e: any) {
      if (e.message?.includes("in-flight")) {
        console.log(`    (retrying after in-flight limit, attempt ${attempt + 1})`);
        await sleep(8000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Transaction failed after 3 retries");
}

async function deployAndWait(factoryName: string, args?: any[]): Promise<any> {
  const factory = await ethers.getContractFactory(factoryName);
  const contract = args ? await factory.deploy(...args) : await factory.deploy();
  const tx = contract.deploymentTransaction();
  if (tx) await tx.wait(1);
  await sleep(4000);
  return contract;
}

async function deployProxyAndWait(implAddr: string, initData: string): Promise<any> {
  const factory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await factory.deploy(implAddr, initData);
  const tx = proxy.deploymentTransaction();
  if (tx) await tx.wait(1);
  await sleep(4000);
  return proxy;
}

interface DeployResult {
  deployer: string;
  verifier: string;
  credentialRegistry: { proxy: string; implementation: string };
  sessionManager: { proxy: string; implementation: string };
  agentWalletImplementation: string;
  agentWalletFactory: { proxy: string; implementation: string };
  capabilityRegistry: { proxy: string; implementation: string };
  delegationManager: { proxy: string; implementation: string };
}

async function deployAll(): Promise<DeployResult> {
  const [deployer] = await ethers.getSigners();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`DEPLOYMENT PHASE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
  console.log();

  console.log("1/8 Deploying Groth16Verifier...");
  const verifier = await deployAndWait("Groth16Verifier");
  const verifierAddr = await verifier.getAddress();
  console.log(`   Verifier: ${verifierAddr}`);

  console.log("2/8 Deploying CredentialRegistry...");
  const credRegImpl = await deployAndWait("CredentialRegistry");
  const credRegImplAddr = await credRegImpl.getAddress();
  const credRegProxy = await deployProxyAndWait(credRegImplAddr, credRegImpl.interface.encodeFunctionData("initialize", [deployer.address]));
  const credRegAddr = await credRegProxy.getAddress();
  console.log(`   CredentialRegistry Proxy: ${credRegAddr}`);

  console.log("3/8 Deploying SessionManager...");
  const sessMgrImpl = await deployAndWait("SessionManager");
  const sessMgrImplAddr = await sessMgrImpl.getAddress();
  const sessMgrProxy = await deployProxyAndWait(sessMgrImplAddr, sessMgrImpl.interface.encodeFunctionData("initialize", [verifierAddr, credRegAddr]));
  const sessMgrAddr = await sessMgrProxy.getAddress();
  console.log(`   SessionManager Proxy: ${sessMgrAddr}`);

  console.log("4/8 Deploying AgentWallet...");
  const walletImpl = await deployAndWait("AgentWallet");
  const walletImplAddr = await walletImpl.getAddress();
  console.log(`   AgentWallet Impl: ${walletImplAddr}`);

  console.log("5/8 Deploying AgentWalletFactory...");
  const factoryImpl = await deployAndWait("AgentWalletFactory");
  const factoryImplAddr = await factoryImpl.getAddress();
  const factoryProxy = await deployProxyAndWait(factoryImplAddr, factoryImpl.interface.encodeFunctionData("initialize", [walletImplAddr, sessMgrAddr, ENTRY_POINT_ADDRESS]));
  const factoryAddr = await factoryProxy.getAddress();
  console.log(`   AgentWalletFactory Proxy: ${factoryAddr}`);

  console.log("6/8 Deploying CapabilityRegistry...");
  const capRegImpl = await deployAndWait("CapabilityRegistry");
  const capRegImplAddr = await capRegImpl.getAddress();
  const capRegProxy = await deployProxyAndWait(capRegImplAddr, capRegImpl.interface.encodeFunctionData("initialize", [deployer.address]));
  const capRegAddr = await capRegProxy.getAddress();
  console.log(`   CapabilityRegistry Proxy: ${capRegAddr}`);

  console.log("7/8 Deploying DelegationManager...");
  const delMgrImpl = await deployAndWait("DelegationManager");
  const delMgrImplAddr = await delMgrImpl.getAddress();
  const delMgrProxy = await deployProxyAndWait(delMgrImplAddr, delMgrImpl.interface.encodeFunctionData("initialize", [deployer.address]));
  const delMgrAddr = await delMgrProxy.getAddress();
  console.log(`   DelegationManager Proxy: ${delMgrAddr}`);

  console.log("8/8 Configuring CredentialRegistry...");
  const credReg = await ethers.getContractAt("CredentialRegistry", credRegAddr);
  await sendAndWait(credReg.setSessionManager(sessMgrAddr, true));
  console.log("   Done.");

  const result: DeployResult = {
    deployer: deployer.address,
    verifier: verifierAddr,
    credentialRegistry: { proxy: credRegAddr, implementation: credRegImplAddr },
    sessionManager: { proxy: sessMgrAddr, implementation: sessMgrImplAddr },
    agentWalletImplementation: walletImplAddr,
    agentWalletFactory: { proxy: factoryAddr, implementation: factoryImplAddr },
    capabilityRegistry: { proxy: capRegAddr, implementation: capRegImplAddr },
    delegationManager: { proxy: delMgrAddr, implementation: delMgrImplAddr },
  };

  console.log("\n" + JSON.stringify(result, null, 2));
  return result;
}

async function runOnChainTests(deployed: DeployResult) {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const oracle = signers[1];
  const client = signers[2];
  const worker = signers[3];
  const other = signers[4];

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (e: any) {
      const msg = e?.reason || e?.message?.substring(0, 120) || String(e);
      console.log(`  FAIL  ${name}: ${msg}`);
      failures.push(`${name}: ${msg}`);
      failed++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — CredentialRegistry`);
  console.log(`${"=".repeat(60)}`);

  const credReg = await ethers.getContractAt("CredentialRegistry", deployed.credentialRegistry.proxy);

  await test("CR: owner is deployer", async () => {
    if (await credReg.owner() !== deployer.address) throw new Error("owner mismatch");
  });

  await test("CR: add issuer (oracle)", async () => {
    await sendAndWait(credReg.addIssuer(oracle.address));
    if (!(await credReg.issuers(oracle.address))) throw new Error("issuer not added");
  });

  await test("CR: reject non-owner adding issuer", async () => {
    try {
      await sendAndWait(credReg.connect(client).addIssuer(client.address));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("CR: issuer updates active root", async () => {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root-1"));
    await sendAndWait(credReg.connect(oracle).updateActiveRoot(newRoot));
    if ((await credReg.activeRoot()) !== newRoot) throw new Error("root not updated");
  });

  await test("CR: issuer updates revoked secret root", async () => {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("revoked-root-1"));
    await sendAndWait(credReg.connect(oracle).updateRevokedSecretRoot(newRoot));
    if ((await credReg.revokedSecretRoot()) !== newRoot) throw new Error("revoked root not updated");
  });

  await test("CR: non-issuer cannot update root", async () => {
    try {
      await sendAndWait(credReg.connect(client).updateActiveRoot(ethers.ZeroHash));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("CR: pause blocks root updates", async () => {
    await sendAndWait(credReg.pause());
    if (!(await credReg.paused())) throw new Error("pause tx failed");
    try {
      await sendAndWait(credReg.connect(oracle).updateActiveRoot(ethers.keccak256(ethers.toUtf8Bytes("paused"))));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
    await sendAndWait(credReg.unpause());
  });

  await test("CR: remove issuer", async () => {
    await sendAndWait(credReg.removeIssuer(oracle.address));
    if (await credReg.issuers(oracle.address)) throw new Error("issuer still exists");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — SessionManager`);
  console.log(`${"=".repeat(60)}`);

  const sessMgr = await ethers.getContractAt("SessionManager", deployed.sessionManager.proxy);

  await test("SM: owner is deployer", async () => {
    if (await sessMgr.owner() !== deployer.address) throw new Error("owner mismatch");
  });

  await test("SM: verifier is set correctly", async () => {
    if ((await sessMgr.verifier()).toLowerCase() !== deployed.verifier.toLowerCase()) throw new Error("verifier mismatch");
  });

  await test("SM: registry is set correctly", async () => {
    if ((await sessMgr.registry()).toLowerCase() !== deployed.credentialRegistry.proxy.toLowerCase()) throw new Error("registry mismatch");
  });

  await test("SM: pause/unpause", async () => {
    await sendAndWait(sessMgr.pause());
    if (!(await sessMgr.paused())) throw new Error("not paused");
    await sendAndWait(sessMgr.unpause());
    if (await sessMgr.paused()) throw new Error("still paused");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — AgentWalletFactory`);
  console.log(`${"=".repeat(60)}`);

  const factory = await ethers.getContractAt("AgentWalletFactory", deployed.agentWalletFactory.proxy);

  await test("AWF: owner is deployer", async () => {
    if (await factory.owner() !== deployer.address) throw new Error("owner mismatch");
  });

  await test("AWF: implementation is set", async () => {
    if ((await factory.implementation()).toLowerCase() !== deployed.agentWalletImplementation.toLowerCase()) throw new Error("impl mismatch");
  });

  await test("AWF: session manager is set", async () => {
    if ((await factory.sessionManager()).toLowerCase() !== deployed.sessionManager.proxy.toLowerCase()) throw new Error("session manager mismatch");
  });

  await test("AWF: entry point is set", async () => {
    if ((await factory.entryPoint()).toLowerCase() !== ENTRY_POINT_ADDRESS.toLowerCase()) throw new Error("entry point mismatch");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — AgentWallet`);
  console.log(`${"=".repeat(60)}`);

  const createReceipt = await sendAndWait(factory.createWallet(deployer.address));
  const walletLog = createReceipt?.logs?.find((log: any) => {
    try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; }
    catch { return false; }
  });
  const walletAddress = (factory.interface.parseLog(walletLog as any) as any).args.wallet;
  const wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  console.log(`  Wallet created at: ${walletAddress}`);

  await test("AW: wallet owner is deployer", async () => {
    if ((await wallet.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("owner mismatch");
  });

  await test("AW: wallet session manager is set", async () => {
    if ((await wallet.sessionManager()).toLowerCase() !== deployed.sessionManager.proxy.toLowerCase()) throw new Error("sm mismatch");
  });

  await test("AW: accept ETH deposit", async () => {
    await sendAndWait(deployer.sendTransaction({ to: walletAddress, value: ethers.parseEther("0.005") }));
    const bal = await wallet.checkBalance();
    if (bal < ethers.parseEther("0.005")) throw new Error("balance too low");
  });

  await test("AW: whitelist party and execute", async () => {
    await sendAndWait(wallet.setWhiteListedParty(client.address, true));
    if (!(await wallet.whiteListedParties(client.address))) throw new Error("not whitelisted");
    await sendAndWait(wallet.execute(client.address, 0, "0x"));
  });

  await test("AW: reject execute on non-whitelisted target", async () => {
    try {
      await sendAndWait(wallet.execute(other.address, 0, "0x"));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("AW: batch whitelist", async () => {
    await sendAndWait(wallet.setWhiteListedPartyBatch([other.address, worker.address], [true, true]));
    if (!(await wallet.whiteListedParties(other.address))) throw new Error("other not whitelisted");
    if (!(await wallet.whiteListedParties(worker.address))) throw new Error("worker not whitelisted");
  });

  await test("AW: batch execute", async () => {
    await sendAndWait(wallet.executeBatch([client.address, other.address], [0, 0], ["0x", "0x"]));
  });

  await test("AW: ownership transfer initiation", async () => {
    await sendAndWait(wallet.changeOwner(client.address));
    if ((await wallet.pendingOwner()).toLowerCase() !== client.address.toLowerCase()) throw new Error("pending owner mismatch");
  });

  await test("AW: reject non-owner initiating transfer", async () => {
    try {
      await sendAndWait(wallet.connect(other).changeOwner(other.address));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("AW: accept ownership by pending owner", async () => {
    await sendAndWait(wallet.connect(client).acceptOwnership());
    if ((await wallet.owner()).toLowerCase() !== client.address.toLowerCase()) throw new Error("owner not transferred");
  });

  await test("AW: transfer ownership back to deployer", async () => {
    await sendAndWait(wallet.connect(client).changeOwner(deployer.address));
    await sendAndWait(wallet.connect(deployer).acceptOwnership());
    if ((await wallet.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("owner not restored");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — CapabilityRegistry`);
  console.log(`${"=".repeat(60)}`);

  const capReg = await ethers.getContractAt("CapabilityRegistry", deployed.capabilityRegistry.proxy);

  await test("CR2: owner is deployer", async () => {
    if (await capReg.owner() !== deployer.address) throw new Error("owner mismatch");
  });

  const capId = ethers.keccak256(ethers.toUtf8Bytes("capability-" + Date.now()));
  await test("CR2: register capability", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    await sendAndWait(capReg.registerCapability(capId, "deploy-contract", expiry));
    const cap = await capReg.getCapability(capId);
    if (cap.registrar.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("registrar mismatch");
    if (cap.revoked) throw new Error("should not be revoked");
  });

  await test("CR2: reject duplicate capability", async () => {
    try {
      await sendAndWait(capReg.registerCapability(capId, "deploy-contract", Math.floor(Date.now() / 1000) + 86400));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("CR2: set root updater", async () => {
    await sendAndWait(capReg.setRootUpdater(oracle.address, true));
    if (!(await capReg.rootUpdaters(oracle.address))) throw new Error("not set");
  });

  await test("CR2: update grant root", async () => {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("grant-root-1"));
    await sendAndWait(capReg.connect(oracle).updateGrantRoot(client.address, newRoot));
    if ((await capReg.grantRoots(client.address)) !== newRoot) throw new Error("root mismatch");
  });

  await test("CR2: revoke capability", async () => {
    await sendAndWait(capReg.revokeCapability(capId));
    const cap = await capReg.getCapability(capId);
    if (!cap.revoked) throw new Error("not revoked");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ON-CHAIN TESTS — DelegationManager`);
  console.log(`${"=".repeat(60)}`);

  const delMgr = await ethers.getContractAt("DelegationManager", deployed.delegationManager.proxy);

  await test("DM: owner is deployer", async () => {
    if (await delMgr.owner() !== deployer.address) throw new Error("owner mismatch");
  });

  await test("DM: set root updater", async () => {
    await sendAndWait(delMgr.setRootUpdater(oracle.address, true));
    if (!(await delMgr.rootUpdaters(oracle.address))) throw new Error("not set");
  });

  await test("DM: update delegation root", async () => {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("deleg-root-1"));
    await sendAndWait(delMgr.connect(deployer).updateDelegationRoot(deployer.address, newRoot));
    if ((await delMgr.delegationRoots(deployer.address)) !== newRoot) throw new Error("root mismatch");
  });

  await test("DM: non-delegator cannot update root", async () => {
    try {
      await sendAndWait(delMgr.connect(client).updateDelegationRoot(deployer.address, ethers.ZeroHash));
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message?.includes("should have reverted")) throw e;
    }
  });

  await test("DM: pause/unpause", async () => {
    await sendAndWait(delMgr.pause());
    if (!(await delMgr.paused())) throw new Error("not paused");
    await sendAndWait(delMgr.unpause());
    if (await delMgr.paused()) throw new Error("still paused");
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${"=".repeat(60)}\n`);

  return { passed, failed, failures };
}

async function main() {
  const deployed = await deployAll();
  const results = await runOnChainTests(deployed);
  if (results.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
