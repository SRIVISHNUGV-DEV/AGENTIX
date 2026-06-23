import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

describe("Fuzz — DelegationManager", function () {
  let delMgr: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory("DelegationManager");
    const impl = await Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delMgr = await ethers.getContractAt("DelegationManager", await proxy.getAddress());
  });

  it("Fuzz: 100 random scope registrations", async function () {
    for (let i = 0; i < 100; i++) {
      await delMgr.registerScope(`scope-${i}-${Date.now()}`);
    }
  });

  it("Fuzz: emergency revoke and re-authorize cycle", async function () {
    for (let i = 0; i < 50; i++) {
      const addr = signers[i % signers.length].address;
      await delMgr.emergencyRevokeAll(addr);
      expect(await delMgr.revokedDelegators(addr)).to.be.true;
      await delMgr.reAuthorizeDelegator(addr);
      expect(await delMgr.revokedDelegators(addr)).to.be.false;
    }
  });

  it("Fuzz: root updates with random data", async function () {
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("test-scope"));
    for (let i = 0; i < 100; i++) {
      const root = randBytes32();
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
      await delMgr.updateDelegationRoot(owner.address, scopeHash, root, expiresAt);
      const stored = await delMgr.getDelegationRoot(owner.address, scopeHash);
      expect(stored.root).to.equal(root);
    }
  });

  it("Fuzz: revoked delegator cannot update root", async function () {
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("scope"));
    await delMgr.emergencyRevokeAll(owner.address);
    await expect(
      delMgr.updateDelegationRoot(owner.address, scopeHash, randBytes32(), 0)
    ).to.be.reverted;
  });

  it("Fuzz: delegation leaf revocation", async function () {
    const leaves: string[] = [];
    for (let i = 0; i < 50; i++) {
      const leaf = randBytes32();
      leaves.push(leaf);
      await delMgr.revokeDelegation(leaf, owner.address);
      expect(await delMgr.isRevoked(leaf)).to.be.true;
    }
    for (const leaf of leaves) {
      await expect(delMgr.revokeDelegation(leaf, owner.address)).to.be.reverted;
    }
  });

  it("Fuzz: non-admin cannot register scope", async function () {
    await expect(
      delMgr.connect(signers[1]).registerScope("test-scope")
    ).to.be.reverted;
  });

  it("Fuzz: non-admin cannot emergency revoke", async function () {
    await expect(
      delMgr.connect(signers[1]).emergencyRevokeAll(owner.address)
    ).to.be.reverted;
  });

  it("Fuzz: scope limit enforcement", async function () {
    for (let i = 0; i < 32; i++) {
      const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(`scope-${i}`));
      await delMgr.updateDelegationRoot(owner.address, scopeHash, randBytes32(), 0);
    }
    const extraScope = ethers.keccak256(ethers.toUtf8Bytes("extra-scope"));
    await expect(
      delMgr.updateDelegationRoot(owner.address, extraScope, randBytes32(), 0)
    ).to.be.reverted;
  });
});
