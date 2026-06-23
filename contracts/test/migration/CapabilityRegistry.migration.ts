import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — CapabilityRegistry V1 → V2", function () {
  let capReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    const V1Impl = await ethers.getContractFactory("CapabilityRegistry");
    const v1Impl = await V1Impl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await v1Impl.getAddress(),
      v1Impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    capReg = await ethers.getContractAt("CapabilityRegistry", await proxy.getAddress());

    // Populate V1 state
    await capReg.registerCapability(
      ethers.keccak256(ethers.toUtf8Bytes("cap-1")), "action-1", 0
    );
    await capReg.registerCapability(
      ethers.keccak256(ethers.toUtf8Bytes("cap-2")), "action-2", 0
    );
    const cap1Id = ethers.keccak256(ethers.toUtf8Bytes("cap-1"));
    const mockRoot = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
    await capReg.connect(owner).updateGrantRoot(signers[1].address, cap1Id, mockRoot);
  });

  it("Should preserve capabilities after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_CapabilityRegistry");
    const v2Impl = await V2Impl.deploy();
    await capReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    expect(await capReg.getCapabilityCount()).to.equal(2);
    const cap1 = await capReg.getCapability(ethers.keccak256(ethers.toUtf8Bytes("cap-1")));
    expect(cap1.createdAt).to.be.gt(0);
  });

  it("Should preserve grant roots after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_CapabilityRegistry");
    const v2Impl = await V2Impl.deploy();
    await capReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");

    const cap1Id = ethers.keccak256(ethers.toUtf8Bytes("cap-1"));
    const root = await capReg.grantRoots(owner.address, signers[1].address, cap1Id);
    expect(root).to.equal(ethers.keccak256(ethers.toUtf8Bytes("root-1")));
  });

  it("Should maintain ownership after upgrade", async function () {
    const V2Impl = await ethers.getContractFactory("MockV2_CapabilityRegistry");
    const v2Impl = await V2Impl.deploy();
    await capReg.upgradeToAndCall(await v2Impl.getAddress(), "0x");
    expect(await capReg.owner()).to.equal(owner.address);
  });
});
