import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — CredentialRegistry V1 → V2", function () {
  let credReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    // Deploy V1
    const V1Impl = await ethers.getContractFactory("CredentialRegistry");
    const v1Impl = await V1Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await v1Impl.getAddress(),
      v1Impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credReg = await ethers.getContractAt("CredentialRegistry", await proxy.getAddress());

    // Populate V1 state
    await credReg.setSessionManager(owner.address, true);
    await credReg.addIssuer(signers[1].address);
    await credReg.markNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("null-1")));
    await credReg.markNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("null-2")));
  });

  it("Should preserve state after upgrade", async function () {
    // Upgrade to V2
    const V2Impl = await ethers.getContractFactory("MockV2_CredentialRegistry");
    const v2Impl = await V2Impl.deploy();
    await credReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    // Verify state preserved
    expect(await credReg.issuers(owner.address)).to.be.true;
    expect(await credReg.issuers(signers[1].address)).to.be.true;
    expect(await credReg.sessionManagers(owner.address)).to.be.true;
    expect(await credReg.isNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("null-1")))).to.be.true;
    expect(await credReg.isNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("null-2")))).to.be.true;
  });

  it("Should maintain ownership after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_CredentialRegistry");
    const v2Impl = await V2Impl.deploy();
    await credReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");
    expect(await credReg.owner()).to.equal(owner.address);
  });

  it("Should allow new operations after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_CredentialRegistry");
    const v2Impl = await V2Impl.deploy();
    await credReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    await credReg.addIssuer(signers[2].address);
    expect(await credReg.issuers(signers[2].address)).to.be.true;

    await credReg.markNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("post-upgrade")));
    expect(await credReg.isNullifierUsed(ethers.keccak256(ethers.toUtf8Bytes("post-upgrade")))).to.be.true;
  });
});
