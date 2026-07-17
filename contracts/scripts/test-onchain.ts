import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Load addresses from deploy-output.json (written by deploy.ts)
function loadDeployments() {
  const deployPath = path.resolve(__dirname, "../deploy-output.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error(`deploy-output.json not found at ${deployPath}\nRun deploy.ts first.`);
  }
  return JSON.parse(fs.readFileSync(deployPath, "utf-8"));
}

const EP = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function sendAndWait(txPromise: Promise<any>, delay = 8000): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tx = await txPromise;
      let receipt;
      if (tx?.wait) {
        receipt = await tx.wait(1);
      }
      await sleep(delay);
      return receipt || tx;
    } catch (e: any) {
      if (e.message?.includes("in-flight") || e.message?.includes("underpriced") || e.message?.includes("nonce")) {
        console.log(`    (retrying, attempt ${attempt + 1}: ${e.message.substring(0, 80)})`);
        await sleep(15000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Tx failed after retries");
}

async function main() {
  const DEPLOYED = loadDeployments();
  const contracts = DEPLOYED.contracts;

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const oracle = signers[1];
  const client = signers[2];
  const worker = signers[3];
  const other = signers[4];

  console.log(`Deployer: ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(bal)} ETH\n`);

  console.log("Resetting paused states...");
  for (const [name, addr] of [
    ["CredentialRegistry", contracts.credentialRegistry.proxy],
    ["SessionManager", contracts.sessionManager.proxy],
    ["CapabilityRegistry", contracts.capabilityRegistry.proxy],
    ["DelegationManager", contracts.delegationManager.proxy],
  ]) {
    try {
      const c = await ethers.getContractAt(name, addr);
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
      const msg = e?.reason || e?.message?.substring(0, 150) || String(e);
      console.log(`  FAIL  ${name}: ${msg}`);
      failures.push(`${name}: ${msg}`);
      failed++;
    }
  }

  // ═══════════════════════════════════════════════════════
  // CredentialRegistry
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — CredentialRegistry\n${"=".repeat(60)}`);
  const credReg = await ethers.getContractAt("CredentialRegistry", contracts.credentialRegistry.proxy);

  await test("CR: owner is deployer", async () => {
    if ((await credReg.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("owner mismatch");
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

  // ═══════════════════════════════════════════════════════
  // SessionManager
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — SessionManager\n${"=".repeat(60)}`);
  const sessMgr = await ethers.getContractAt("SessionManager", contracts.sessionManager.proxy);

  await test("SM: owner is deployer", async () => {
    if ((await sessMgr.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("owner mismatch");
  });
  await test("SM: verifier set", async () => {
    if ((await sessMgr.verifier()).toLowerCase() !== contracts.groth16Verifier.toLowerCase()) throw new Error("mismatch");
  });
  await test("SM: registry set", async () => {
    if ((await sessMgr.registry()).toLowerCase() !== contracts.credentialRegistry.proxy.toLowerCase()) throw new Error("mismatch");
  });
  await test("SM: walletFactory set", async () => {
    if ((await sessMgr.walletFactory()).toLowerCase() !== contracts.agentWalletFactory.proxy.toLowerCase()) throw new Error("mismatch");
  });
  await test("SM: pause/unpause", async () => {
    await sendAndWait(sessMgr.pause());
    if (!(await sessMgr.paused())) throw new Error("not paused");
    await sendAndWait(sessMgr.unpause());
    if (await sessMgr.paused()) throw new Error("still paused");
  });

  // ═══════════════════════════════════════════════════════
  // AgentWalletFactory
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — AgentWalletFactory\n${"=".repeat(60)}`);
  const factory = await ethers.getContractAt("AgentWalletFactory", contracts.agentWalletFactory.proxy);

  await test("AWF: owner is deployer", async () => {
    if ((await factory.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("mismatch");
  });
  await test("AWF: implementation set", async () => {
    if ((await factory.implementation()).toLowerCase() !== contracts.agentWalletImpl.toLowerCase()) throw new Error("mismatch");
  });
  await test("AWF: session manager set", async () => {
    if ((await factory.sessionManager()).toLowerCase() !== contracts.sessionManager.proxy.toLowerCase()) throw new Error("mismatch");
  });
  await test("AWF: entry point set", async () => {
    if ((await factory.entryPoint()).toLowerCase() !== EP.toLowerCase()) throw new Error("mismatch");
  });

  // ═══════════════════════════════════════════════════════
  // AgentWallet
  // ═══════════════════════════════════════════════════════
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
    if ((await wallet.sessionManager()).toLowerCase() !== contracts.sessionManager.proxy.toLowerCase()) throw new Error("mismatch");
  });
  await test("AW: accept ETH deposit", async () => {
    await sendAndWait(deployer.sendTransaction({ to: walletAddress, value: ethers.parseEther("0.002") }));
    if ((await wallet.checkBalance()) < ethers.parseEther("0.002")) throw new Error("balance too low");
  });
  await test("AW: owner can execute", async () => {
    await sendAndWait(wallet.execute(other.address, 0, "0x"));
  });
  await test("AW: ownership transfer (2-step)", async () => {
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
  await test("AW: batch execute", async () => {
    await sendAndWait(wallet.executeBatch([client.address, other.address], [0, 0], ["0x", "0x"]));
  });

  // ═══════════════════════════════════════════════════════
  // CapabilityRegistry
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — CapabilityRegistry\n${"=".repeat(60)}`);
  const capReg = await ethers.getContractAt("CapabilityRegistry", contracts.capabilityRegistry.proxy);

  await test("CR2: owner is deployer", async () => {
    if ((await capReg.owner()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("mismatch");
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
  await test("CR2: update grant root", async () => {
    const r = ethers.keccak256(ethers.toUtf8Bytes("grant-root-1"));
    await sendAndWait(capReg.updateGrantRoot(client.address, capId, r));
    if ((await capReg.grantRoots(deployer.address, client.address, capId)) !== r) throw new Error("root mismatch");
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

  // ═══════════════════════════════════════════════════════
  // DelegationManager
  // ═══════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}\nON-CHAIN TESTS — DelegationManager\n${"=".repeat(60)}`);
  const delMgr = await ethers.getContractAt("DelegationManager", contracts.delegationManager.proxy);
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const ROOT_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ROOT_UPDATER"));

  await test("DM: admin is deployer", async () => {
    if (!(await delMgr.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))) throw new Error("not admin");
  });
  await test("DM: ROOT_UPDATER granted to deployer", async () => {
    if (!(await delMgr.hasRole(ROOT_UPDATER_ROLE, deployer.address))) throw new Error("not root updater");
  });
  await test("DM: grant ROOT_UPDATER to oracle", async () => {
    await sendAndWait(delMgr.setRootUpdater(oracle.address, true));
    if (!(await delMgr.hasRole(ROOT_UPDATER_ROLE, oracle.address))) throw new Error("not granted");
  });
  await test("DM: register scope", async () => {
    const action = "scope-reg-" + Date.now();
    await sendAndWait(delMgr.registerScope(action));
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(action));
    if ((await delMgr.getScopeAction(scopeHash)) !== action) throw new Error("scope not registered");
  });
  await test("DM: delegator updates own root", async () => {
    const scopeAction = "scope-root-" + Date.now();
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(scopeAction));
    await sendAndWait(delMgr.registerScope(scopeAction));
    const r = ethers.keccak256(ethers.toUtf8Bytes("deleg-root-1"));
    await sendAndWait(delMgr.updateDelegationRoot(deployer.address, scopeHash, r, 0));
    const rootInfo = await delMgr.getDelegationRoot(deployer.address, scopeHash);
    if (rootInfo.root !== r) throw new Error("root mismatch");
  });
  await test("DM: non-delegator cannot update OTHER's root", async () => {
    const scopeAction = "scope-auth-" + Date.now();
    await sendAndWait(delMgr.registerScope(scopeAction));
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(scopeAction));
    try {
      await sendAndWait(delMgr.connect(client).updateDelegationRoot(deployer.address, scopeHash, ethers.ZeroHash, 0));
      throw new Error("should have reverted");
    } catch (e: any) { if (e.message?.includes("should have reverted")) throw e; }
  });
  await test("DM: emergency revoke all", async () => {
    await sendAndWait(delMgr.emergencyRevokeAll(deployer.address));
    if (!(await delMgr.revokedDelegators(deployer.address))) throw new Error("not revoked");
  });
  await test("DM: re-authorize delegator", async () => {
    await sendAndWait(delMgr.reAuthorizeDelegator(deployer.address));
    if (await delMgr.revokedDelegators(deployer.address)) throw new Error("still revoked");
  });
  await test("DM: pause/unpause", async () => {
    await sendAndWait(delMgr.pause());
    if (!(await delMgr.paused())) throw new Error("not paused");
    await sendAndWait(delMgr.unpause());
    if (await delMgr.paused()) throw new Error("still paused");
  });

  // ═══════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════
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
