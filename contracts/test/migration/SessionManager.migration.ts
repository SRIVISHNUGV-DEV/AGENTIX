import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — SessionManager V1 → V2", function () {
  let sessionManager: any;
  let owner: SignerWithAddress;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );

    const AnchorImpl = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const anchorImpl = await AnchorImpl.deploy();
    const OrgRegImpl = await ethers.getContractFactory("OrganizationRegistry");
    const orgRegImpl = await OrgRegImpl.deploy();
    const OrgRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const orgRegProxy = await OrgRegProxy.deploy(
      await orgRegImpl.getAddress(),
      orgRegImpl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );

    const V1Impl = await ethers.getContractFactory("SessionManager");
    const v1Impl = await V1Impl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await v1Impl.getAddress(),
      v1Impl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(),
        await credRegProxy.getAddress(),
        "0x0000000000000000000000000000000000000001"
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());
  });

  it("Should preserve configuration after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_SessionManager");
    const v2Impl = await V2Impl.deploy();
    await sessionManager.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    expect(await sessionManager.owner()).to.equal(owner.address);
    expect(await sessionManager.paused()).to.be.false;
  });

  it("Should maintain ownership after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_SessionManager");
    const v2Impl = await V2Impl.deploy();
    await sessionManager.upgradeToAndCall(await v2Impl.getAddress(), "0x");
    expect(await sessionManager.owner()).to.equal(owner.address);
  });

  it("Non-admin cannot upgrade", async function () {
    const [, attacker] = await ethers.getSigners();
    const V2Impl = await ethers.getContractFactory("MockV2_SessionManager");
    const v2Impl = await V2Impl.deploy();
    await expect(
      sessionManager.connect(attacker).upgradeToAndCall(await v2Impl.getAddress(), "0x")
    ).to.be.reverted;
  });
});
