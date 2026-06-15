import { ethers } from "hardhat";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const DEPLOYED = {
  verifier: "0x2520AA0d05d841a878432CB5af10911454b5ef1d",
  credentialRegistry: "0xEAE8Bb4d4FfcddE9a3D31Ce6A146b483A33B63f1",
  sessionManager: "0xC11663bc720F4C9dfed07BBfe08DC60Bdb0aE9d1",
  agentWalletImplementation: "0x50544798E104D71D09832BD664728C216D554A1b",
  agentWalletFactory: "0xef1926946b4C5b97B42e8A7315d95a5847786DAC",
  capabilityRegistry: "0x0445262Fa344ECd3A381FeB6CF247f36889D8bea",
  delegationManager: "0x546311d1dcC6192113Bbaf13F3d43d772a4226D2",
};

async function sendAndWait(txPromise: Promise<any>, delay = 5000): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tx = await txPromise;
      let receipt;
      if (tx?.wait) {
        receipt = await tx.wait(1);
      }
      await ethers.provider.getBlock("latest");
      await sleep(delay);
      return receipt || tx;
    } catch (e: any) {
      if (e.message?.includes("in-flight") || e.message?.includes("underpriced")) {
        console.log(`    (retrying, attempt ${attempt + 1}: ${e.message.substring(0, 60)})`);
        await sleep(12000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Tx failed after retries");
}

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const oracle = signers[1];
  const client = signers[2];
  const worker = signers[3];
  const other = signers[4];

  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(bal)} ETH)`);

  console.log("\nResetting paused states...");
  for (const [name, addr] of [
    ["CredentialRegistry", DEPLOYED.credentialRegistry],
    ["SessionManager", DEPLOYED.sessionManager],
    ["CapabilityRegistry", DEPLOYED.capabilityRegistry],
    ["DelegationManager", DEPLOYED.delegationManager],
  ]) {
    try {
      const c = await ethers.getContractAt(name, addr);
      await ethers.provider.getBlock("latest");
      if (await c.paused()) {
        await sendAndWait(c.unpause());
        console.log(`  Unpaused ${name}`);
      }
    } catch {}
  }

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

  // === CredentialRegistry ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — CredentialRegistry\n${"=".repeat(60)}`);
  const credReg = await ethers.getContractAt("CredentialRegistry", DEPLOYED.credentialRegistry);

  await test("CR: owner is deployer", async () => {
    if (await credReg.owner() !== deployer.address) throw new Error("owner mismatch");
  });
  await test("CR: add issuer (oracle)", async () => {
    await sendAndWait(credReg.addIssuer(oracle.address));
    if (!(await credReg.issuers(oracle.address))) throw new Error("not added");
  });
  await test("CR: reject non-owner adding issuer", async () => {
    try {
      await sendAndWait(credReg.connect(client).addIssuer(client.address));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("CR: issuer updates active root", async () => {
    const r = ethers.keccak256(ethers.toUtf8Bytes("test-root-1"));
    await sendAndWait(credReg.connect(oracle).updateActiveRoot(r));
    if ((await credReg.activeRoot()) !== r) throw new Error("root not updated");
  });
  await test("CR: issuer updates revoked secret root", async () => {
    const r = ethers.keccak256(ethers.toUtf8Bytes("revoked-root-1"));
    await sendAndWait(credReg.connect(oracle).updateRevokedSecretRoot(r));
    if ((await credReg.revokedSecretRoot()) !== r) throw new Error("revoked root not updated");
  });
  await test("CR: non-issuer cannot update root", async () => {
    try {
      await sendAndWait(credReg.connect(client).updateActiveRoot(ethers.ZeroHash));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("CR: pause blocks root updates", async () => {
    await sendAndWait(credReg.pause());
    if (!(await credReg.paused())) throw new Error("pause failed");
    try {
      await sendAndWait(credReg.connect(oracle).updateActiveRoot(ethers.keccak256(ethers.toUtf8Bytes("x"))));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
    await sendAndWait(credReg.unpause());
  });
  await test("CR: remove issuer", async () => {
    await sendAndWait(credReg.removeIssuer(oracle.address));
    if (await credReg.issuers(oracle.address)) throw new Error("still exists");
  });

  // === SessionManager ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — SessionManager\n${"=".repeat(60)}`);
  const sessMgr = await ethers.getContractAt("SessionManager", DEPLOYED.sessionManager);

  await test("SM: owner is deployer", async () => {
    if (await sessMgr.owner() !== deployer.address) throw new Error("owner mismatch");
  });
  await test("SM: verifier set", async () => {
    if ((await sessMgr.verifier()).toLowerCase() !== DEPLOYED.verifier.toLowerCase()) throw new Error("mismatch");
  });
  await test("SM: registry set", async () => {
    if ((await sessMgr.registry()).toLowerCase() !== DEPLOYED.credentialRegistry.toLowerCase()) throw new Error("mismatch");
  });
  await test("SM: pause/unpause", async () => {
    await sendAndWait(sessMgr.pause());
    if (!(await sessMgr.paused())) throw new Error("not paused");
    await sendAndWait(sessMgr.unpause());
    if (await sessMgr.paused()) throw new Error("still paused");
  });

  // === AgentWalletFactory ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — AgentWalletFactory\n${"=".repeat(60)}`);
  const factory = await ethers.getContractAt("AgentWalletFactory", DEPLOYED.agentWalletFactory);
  const EP = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

  await test("AWF: owner is deployer", async () => {
    if (await factory.owner() !== deployer.address) throw new Error("mismatch");
  });
  await test("AWF: implementation set", async () => {
    if ((await factory.implementation()).toLowerCase() !== DEPLOYED.agentWalletImplementation.toLowerCase()) throw new Error("mismatch");
  });
  await test("AWF: session manager set", async () => {
    if ((await factory.sessionManager()).toLowerCase() !== DEPLOYED.sessionManager.toLowerCase()) throw new Error("mismatch");
  });
  await test("AWF: entry point set", async () => {
    if ((await factory.entryPoint()).toLowerCase() !== EP.toLowerCase()) throw new Error("mismatch");
  });

  // === AgentWallet ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — AgentWallet\n${"=".repeat(60)}`);

  const createTx = await sendAndWait(factory.createWallet(deployer.address));
  const receipt = await ethers.provider.getTransactionReceipt(createTx.hash);
  let walletAddress = "";
  for (const log of receipt?.logs || []) {
    try {
      const parsed = factory.interface.parseLog(log as any);
      if (parsed?.name === "WalletCreated") { walletAddress = parsed.args.wallet; break; }
    } catch {}
  }
  if (!walletAddress) throw new Error("WalletCreated not found in tx " + createTx.hash);
  const wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  console.log(`  Wallet: ${walletAddress}`);

  await test("AW: owner is deployer", async () => {
    if ((await wallet.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("mismatch");
  });
  await test("AW: session manager set", async () => {
    if ((await wallet.sessionManager()).toLowerCase() !== DEPLOYED.sessionManager.toLowerCase()) throw new Error("mismatch");
  });
  await test("AW: accept ETH deposit", async () => {
    await sendAndWait(deployer.sendTransaction({ to: walletAddress, value: ethers.parseEther("0.002") }));
    if ((await wallet.checkBalance()) < ethers.parseEther("0.002")) throw new Error("balance too low");
  });
  await test("AW: whitelist + execute", async () => {
    await sendAndWait(wallet.setWhiteListedParty(client.address, true));
    if (!(await wallet.whiteListedParties(client.address))) throw new Error("not whitelisted");
    await sendAndWait(wallet.execute(client.address, 0, "0x"));
  });
  await test("AW: reject non-whitelisted execute", async () => {
    try {
      await sendAndWait(wallet.execute(other.address, 0, "0x"));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("AW: batch whitelist + execute", async () => {
    await sendAndWait(wallet.setWhiteListedPartyBatch([other.address, worker.address], [true, true]));
    await sendAndWait(wallet.executeBatch([client.address, other.address], [0, 0], ["0x", "0x"]));
  });
  await test("AW: ownership transfer", async () => {
    await sendAndWait(wallet.changeOwner(client.address));
    if ((await wallet.pendingOwner()).toLowerCase() !== client.address.toLowerCase()) throw new Error("pending mismatch");
    await sendAndWait(wallet.connect(client).acceptOwnership());
    if ((await wallet.owner()).toLowerCase() !== client.address.toLowerCase()) throw new Error("owner mismatch");
    await sendAndWait(wallet.connect(client).changeOwner(deployer.address));
    await sendAndWait(wallet.connect(deployer).acceptOwnership());
    if ((await wallet.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("not restored");
  });
  await test("AW: reject non-owner changeOwner", async () => {
    try {
      await sendAndWait(wallet.connect(other).changeOwner(other.address));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });

  // === CapabilityRegistry ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — CapabilityRegistry\n${"=".repeat(60)}`);
  const capReg = await ethers.getContractAt("CapabilityRegistry", DEPLOYED.capabilityRegistry);

  await test("CR2: owner is deployer", async () => {
    if (await capReg.owner() !== deployer.address) throw new Error("mismatch");
  });
  const capId = ethers.keccak256(ethers.toUtf8Bytes("cap-" + Date.now()));
  await test("CR2: register capability", async () => {
    await sendAndWait(capReg.registerCapability(capId, "deploy-contract", Math.floor(Date.now() / 1000) + 86400));
    const cap = await capReg.getCapability(capId);
    if (cap.registrar.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("registrar mismatch");
  });
  await test("CR2: reject duplicate", async () => {
    try {
      await sendAndWait(capReg.registerCapability(capId, "x", Math.floor(Date.now() / 1000) + 86400));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("CR2: set root updater", async () => {
    await sendAndWait(capReg.setRootUpdater(oracle.address, true));
    if (!(await capReg.rootUpdaters(oracle.address))) throw new Error("not set");
  });
  await test("CR2: update grant root", async () => {
    const r = ethers.keccak256(ethers.toUtf8Bytes("grant-root-1"));
    await sendAndWait(capReg.connect(oracle).updateGrantRoot(client.address, r));
    if ((await capReg.grantRoots(client.address)) !== r) throw new Error("root mismatch");
  });
  await test("CR2: revoke capability", async () => {
    await sendAndWait(capReg.revokeCapability(capId));
    if (!(await capReg.getCapability(capId)).revoked) throw new Error("not revoked");
  });
  await test("CR2: pause/unpause", async () => {
    await sendAndWait(capReg.pause());
    if (!(await capReg.paused())) throw new Error("not paused");
    await sendAndWait(capReg.unpause());
    if (await capReg.paused()) throw new Error("still paused");
  });

  // === DelegationManager ===
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — DelegationManager\n${"=".repeat(60)}`);
  const delMgr = await ethers.getContractAt("DelegationManager", DEPLOYED.delegationManager);

  await test("DM: owner is deployer", async () => {
    if (await delMgr.owner() !== deployer.address) throw new Error("mismatch");
  });
  await test("DM: set root updater", async () => {
    await sendAndWait(delMgr.setRootUpdater(oracle.address, true));
    if (!(await delMgr.rootUpdaters(oracle.address))) throw new Error("not set");
  });
  await test("DM: update delegation root", async () => {
    const r = ethers.keccak256(ethers.toUtf8Bytes("deleg-root-1"));
    await sendAndWait(delMgr.updateDelegationRoot(deployer.address, r));
    if ((await delMgr.delegationRoots(deployer.address)) !== r) throw new Error("root mismatch");
  });
  await test("DM: non-delegator cannot update root", async () => {
    try {
      await sendAndWait(delMgr.connect(client).updateDelegationRoot(deployer.address, ethers.ZeroHash));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("DM: pause/unpause", async () => {
    await sendAndWait(delMgr.pause());
    if (!(await delMgr.paused())) throw new Error("not paused");
    await sendAndWait(delMgr.unpause());
    if (await delMgr.paused()) throw new Error("still paused");
  });

  // === Summary ===
  console.log(`\n${"=".repeat(60)}\nTEST SUMMARY\n${"=".repeat(60)}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
