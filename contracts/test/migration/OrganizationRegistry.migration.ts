import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — OrganizationRegistry V1 → V2", function () {
  let orgReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    const AnchorImpl = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const anchorImpl = await AnchorImpl.deploy();
    const V1Impl = await ethers.getContractFactory("OrganizationRegistry");
    const v1Impl = await V1Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await v1Impl.getAddress(),
      v1Impl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );
    orgReg = await ethers.getContractAt("OrganizationRegistry", await proxy.getAddress());

    // Populate V1 state
    const orgId1 = ethers.keccak256(ethers.toUtf8Bytes("org-migration-1"));
    const orgId2 = ethers.keccak256(ethers.toUtf8Bytes("org-migration-2"));
    await orgReg.registerOrganization(orgId1, "Mig Org 1", owner.address);
    await orgReg.registerOrganization(orgId2, "Mig Org 2", signers[1].address);
    await orgReg.deactivateOrganization(orgId2);

    // Set roots on anchors
    const anchor1Addr = await orgReg.getCredentialAnchor(orgId1);
    const anchor1 = await ethers.getContractAt("OrganizationCredentialAnchor", anchor1Addr);
    await anchor1.connect(owner).updateRoot(ethers.keccak256(ethers.toUtf8Bytes("root-1")));
  });

  it("Should preserve organizations after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_OrganizationRegistry");
    const v2Impl = await V2Impl.deploy();
    await orgReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    const orgId1 = ethers.keccak256(ethers.toUtf8Bytes("org-migration-1"));
    const orgId2 = ethers.keccak256(ethers.toUtf8Bytes("org-migration-2"));

    expect(await orgReg.organizationExists(orgId1)).to.be.true;
    expect(await orgReg.organizationExists(orgId2)).to.be.true;
    expect(await orgReg.isActive(orgId1)).to.be.true;
    expect(await orgReg.isActive(orgId2)).to.be.false;
  });

  it("Should preserve anchor roots after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_OrganizationRegistry");
    const v2Impl = await V2Impl.deploy();
    await orgReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    const orgId1 = ethers.keccak256(ethers.toUtf8Bytes("org-migration-1"));
    const anchor1Addr = await orgReg.getCredentialAnchor(orgId1);
    const anchor1 = await ethers.getContractAt("OrganizationCredentialAnchor", anchor1Addr);
    expect(await anchor1.currentRoot()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("root-1")));
  });

  it("Should preserve ownership after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_OrganizationRegistry");
    const v2Impl = await V2Impl.deploy();
    await orgReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");
    expect(await orgReg.owner()).to.equal(owner.address);
  });

  it("Non-admin cannot upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_OrganizationRegistry");
    const v2Impl = await V2Impl.deploy();
    await expect(
      orgReg.connect(signers[1]).upgradeToAndCall(await v2Impl.getAddress(), "0x")
    ).to.be.reverted;
  });
});
