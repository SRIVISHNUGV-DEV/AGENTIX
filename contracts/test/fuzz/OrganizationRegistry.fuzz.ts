import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Fuzz — OrganizationRegistry", function () {
  let orgReg: any;
  let anchorImpl: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();
    const AnchorF = await ethers.getContractFactory("OrganizationCredentialAnchor");
    anchorImpl = await AnchorF.deploy();
    const Impl = await ethers.getContractFactory("OrganizationRegistry");
    const impl = await Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );
    orgReg = await ethers.getContractAt("OrganizationRegistry", await proxy.getAddress());
  });

  it("Fuzz: register 200 organizations", async function () {
    const orgIds: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`org-${i}-${Date.now()}`));
      await orgReg.registerOrganization(id, `Org ${i}`, signers[i % signers.length].address);
      orgIds.push(id);
    }
    for (const id of orgIds) {
      expect(await orgReg.organizationExists(id)).to.be.true;
    }
  });

  it("Fuzz: deactivation/reactivation cycles", async function () {
    for (let i = 0; i < 50; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`cycle-org-${i}-${Date.now()}`));
      await orgReg.registerOrganization(id, `Org ${i}`, owner.address);
      await orgReg.deactivateOrganization(id);
      expect(await orgReg.isActive(id)).to.be.false;
      await orgReg.reactivateOrganization(id);
      expect(await orgReg.isActive(id)).to.be.true;
    }
  });

  it("Fuzz: duplicate org IDs always revert", async function () {
    const id = ethers.keccak256(ethers.toUtf8Bytes("dup-org"));
    await orgReg.registerOrganization(id, "Org 1", owner.address);
    await expect(orgReg.registerOrganization(id, "Org 2", owner.address)).to.be.reverted;
  });

  it("Fuzz: owner can own multiple organizations", async function () {
    const orgIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = ethers.keccak256(ethers.toUtf8Bytes(`multi-org-${i}-${Date.now()}`));
      await orgReg.registerOrganization(id, `Org ${i}`, owner.address);
      orgIds.push(id);
    }
    const owned = await orgReg.getOwnerOrganizations(owner.address);
    expect(owned.length).to.equal(20);
  });

  it("Fuzz: credential anchor replacement", async function () {
    const id = ethers.keccak256(ethers.toUtf8Bytes("replace-anchor"));
    await orgReg.registerOrganization(id, "Replace", owner.address);
    const AnchorF = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const newAnchorImpl = await AnchorF.deploy();
    const newAnchorAddr = await newAnchorImpl.getAddress();
    await orgReg.proposeCredentialAnchor(id, newAnchorAddr);
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await orgReg.acceptCredentialAnchor(id);
    const org = await orgReg.getOrganization(id);
    expect(org.credentialAnchor).to.equal(newAnchorAddr);
  });

  it("Fuzz: non-owner cannot register", async function () {
    await expect(
      orgReg.connect(signers[1]).registerOrganization(
        ethers.keccak256(ethers.toUtf8Bytes("unauth")),
        "Unauth",
        signers[1].address
      )
    ).to.be.reverted;
  });

  it("Fuzz: pause blocks registration", async function () {
    await orgReg.pause();
    await expect(
      orgReg.registerOrganization(ethers.keccak256(ethers.toUtf8Bytes("paused")), "P", owner.address)
    ).to.be.reverted;
    await orgReg.unpause();
    await expect(
      orgReg.registerOrganization(ethers.keccak256(ethers.toUtf8Bytes("unpaused")), "U", owner.address)
    ).to.not.be.reverted;
  });
});
