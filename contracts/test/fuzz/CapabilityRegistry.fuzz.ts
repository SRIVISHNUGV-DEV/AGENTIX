import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

describe("Fuzz — CapabilityRegistry", function () {
  let capReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory("CapabilityRegistry");
    const impl = await Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    capReg = await ethers.getContractAt("CapabilityRegistry", await proxy.getAddress());
  });

  it("Fuzz: register 500 capabilities with random IDs", async function () {
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`cap-${i}-${Date.now()}`));
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
      await capReg.registerCapability(id, `action-${i}`, expiresAt);
      ids.push(id);
    }
    expect(await capReg.getCapabilityCount()).to.equal(ids.length);
  });

  it("Fuzz: revoke capabilities and verify list consistency", async function () {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`revoke-cap-${i}-${Date.now()}`));
      await capReg.registerCapability(id, `action-${i}`, 0);
      ids.push(id);
    }
    expect(await capReg.getCapabilityCount()).to.equal(50);

    for (let i = 0; i < 25; i++) {
      await capReg.revokeCapability(ids[i]);
      const cap = await capReg.getCapability(ids[i]);
      expect(cap.revoked).to.be.true;
    }
    expect(await capReg.getCapabilityCount()).to.equal(25);
  });

  it("Fuzz: random grant root updates", async function () {
    const grantors = Array.from({ length: 10 }, (_, i) => signers[i % signers.length]);
    const grantees = Array.from({ length: 10 }, (_, i) => signers[(i + 5) % signers.length]);
    const capIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`grant-cap-${i}-${Date.now()}`));
      await capReg.registerCapability(id, `action-${i}`, 0);
      capIds.push(id);
    }
    for (let i = 0; i < 10; i++) {
      const root = randBytes32();
      await capReg.connect(grantors[i]).updateGrantRoot(grantees[i].address, capIds[i], root);
      expect(await capReg.grantRoots(grantors[i].address, grantees[i].address, capIds[i])).to.equal(root);
    }
  });

  it("Fuzz: duplicate registration always reverts", async function () {
    const id = randBytes32();
    await capReg.registerCapability(id, "test-action", 0);
    await expect(capReg.registerCapability(id, "test-action-2", 0)).to.be.reverted;
  });

  it("Fuzz: revoke nonexistent always reverts", async function () {
    for (let i = 0; i < 50; i++) {
      await expect(capReg.revokeCapability(randBytes32())).to.be.reverted;
    }
  });

  it("Fuzz: double revoke always reverts", async function () {
    const id = randBytes32();
    await capReg.registerCapability(id, "test", 0);
    await capReg.revokeCapability(id);
    await expect(capReg.revokeCapability(id)).to.be.reverted;
  });

  it("Fuzz: expired capabilities fail verification", async function () {
    const id = randBytes32();
    const pastExpiry = BigInt(Math.floor(Date.now() / 1000) - 3600);
    await capReg.registerCapability(id, "expired-action", pastExpiry);
    const valid = await capReg.verifyCapability(
      signers[0].address, id, randBytes32(), [], owner.address, ethers.ZeroHash, pastExpiry
    );
    expect(valid).to.be.false;
  });

  it("Fuzz: pause blocks registration", async function () {
    await capReg.pause();
    await expect(capReg.registerCapability(randBytes32(), "action", 0)).to.be.reverted;
    await capReg.unpause();
    await expect(capReg.registerCapability(randBytes32(), "action", 0)).to.not.be.reverted;
  });
});
