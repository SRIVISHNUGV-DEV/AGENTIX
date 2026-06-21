import { ethers } from "hardhat";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sendAndWait(p: Promise<any>, delay = 6000) {
  for (let i = 0; i < 5; i++) {
    try {
      const t = await p;
      if (t?.wait) await t.wait(1);
      await sleep(delay);
      return t;
    } catch (e: any) {
      if (e.message?.includes("in-flight") || e.message?.includes("replacement")) {
        console.log(`    (retry ${i+1})`);
        await sleep(15000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("failed after retries");
}

async function main() {
  const signers = await ethers.getSigners();
  const SM = await ethers.getContractAt("SessionManager", "0xC11663bc720F4C9dfed07BBfe08DC60Bdb0aE9d1");
  const DM = await ethers.getContractAt("DelegationManager", "0x546311d1dcC6192113Bbaf13F3d43d772a4226D2");

  console.log("--- SM: pause/unpause ---");
  try {
    if (await SM.paused()) { await sendAndWait(SM.unpause()); console.log("  (unpaused first)"); }
    await sendAndWait(SM.pause());
    console.log("  PASS paused:", await SM.paused());
    await sendAndWait(SM.unpause());
    console.log("  PASS unpaused:", !(await SM.paused()));
  } catch (e: any) { console.log("  FAIL:", e.message.substring(0, 100)); }

  console.log("--- DM: set root updater ---");
  try {
    await sendAndWait(DM.setRootUpdater(signers[1].address, true));
    console.log("  PASS:", await DM.rootUpdaters(signers[1].address));
  } catch (e: any) { console.log("  FAIL:", e.message.substring(0, 100)); }

  console.log("--- DM: pause/unpause ---");
  try {
    if (await DM.paused()) { await sendAndWait(DM.unpause()); console.log("  (unpaused first)"); }
    await sendAndWait(DM.pause());
    console.log("  PASS paused:", await DM.paused());
    await sendAndWait(DM.unpause());
    console.log("  PASS unpaused:", !(await DM.paused()));
  } catch (e: any) { console.log("  FAIL:", e.message.substring(0, 100)); }
}
main().catch(console.error);
