import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

function randAddr(): string {
  return ethers.Wallet.createRandom().address;
}

describe("Fuzz — CredentialRegistry", function () {
  let credReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory("CredentialRegistry");
    const impl = await Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credReg = await ethers.getContractAt("CredentialRegistry", await proxy.getAddress());
    await credReg.setSessionManager(owner.address, true);
  });

  it("Fuzz: markNullifierUsed with 1000 random nullifiers — no duplicates", async function () {
    const nullifiers: string[] = [];
    for (let i = 0; i < 1000; i++) {
      nullifiers.push(randBytes32());
    }
    for (const n of nullifiers) {
      await credReg.markNullifierUsed(n);
      expect(await credReg.isNullifierUsed(n)).to.be.true;
    }
    for (const n of nullifiers) {
      expect(await credReg.isNullifierUsed(n)).to.be.true;
    }
  });

  it("Fuzz: random address issuer management", async function () {
    const addrs = Array.from({ length: 50 }, () => randAddr());
    for (const a of addrs) {
      await credReg.addIssuer(a);
      expect(await credReg.issuers(a)).to.be.true;
    }
    for (const a of addrs) {
      await credReg.removeIssuer(a);
      expect(await credReg.issuers(a)).to.be.false;
    }
  });

  it("Fuzz: non-session-manager cannot mark nullifier", async function () {
    const rando = signers[5];
    await expect(
      credReg.connect(rando).markNullifierUsed(randBytes32())
    ).to.be.reverted;
  });

  it("Fuzz: nullifier reuse always reverts", async function () {
    for (let i = 0; i < 100; i++) {
      const n = randBytes32();
      await credReg.markNullifierUsed(n);
      await expect(credReg.markNullifierUsed(n)).to.be.reverted;
    }
  });

  it("Fuzz: random session manager toggling", async function () {
    const addrs = Array.from({ length: 20 }, () => randAddr());
    for (const a of addrs) {
      await credReg.setSessionManager(a, true);
      expect(await credReg.sessionManagers(a)).to.be.true;
      await credReg.setSessionManager(a, false);
      expect(await credReg.sessionManagers(a)).to.be.false;
    }
  });

  it("Fuzz: pause does not block nullifier marking (no modifier)", async function () {
    await credReg.pause();
    // markNullifierUsed has no whenNotPaused modifier, so it works even when paused
    await expect(credReg.markNullifierUsed(randBytes32())).to.not.be.reverted;
    await credReg.unpause();
    await expect(credReg.markNullifierUsed(randBytes32())).to.not.be.reverted;
  });
});
