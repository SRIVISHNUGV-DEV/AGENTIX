import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

describe("Fuzz — OrganizationCredentialAnchor", function () {
  let anchor: any;
  let orgReg: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();
    const AnchorF = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const anchorImpl = await AnchorF.deploy();
    const OrgRegF = await ethers.getContractFactory("OrganizationRegistry");
    const orgRegImpl = await OrgRegF.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await orgRegImpl.getAddress(),
      orgRegImpl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );
    orgReg = await ethers.getContractAt("OrganizationRegistry", await proxy.getAddress());

    const orgId = ethers.keccak256(ethers.toUtf8Bytes("test-org"));
    await orgReg.registerOrganization(orgId, "Test Org", owner.address);
    const anchorAddr = await orgReg.getCredentialAnchor(orgId);
    anchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);
  });

  it("Fuzz: 500 root updates", async function () {
    for (let i = 0; i < 500; i++) {
      const root = randBytes32();
      await anchor.connect(owner).updateRoot(root);
      expect(await anchor.currentRoot()).to.equal(root);
    }
  });

  it("Fuzz: epoch increment 100 times", async function () {
    for (let i = 0; i < 100; i++) {
      await anchor.connect(owner).incrementEpoch();
      expect(await anchor.currentEpoch()).to.equal(i + 1);
    }
  });

  it("Fuzz: visibility toggle", async function () {
    for (let i = 0; i < 50; i++) {
      await anchor.connect(owner).setVisibility(i % 2);
      expect(await anchor.visibility()).to.equal(i % 2);
    }
  });

  it("Fuzz: metadata hash updates", async function () {
    for (let i = 0; i < 100; i++) {
      const hash = randBytes32();
      await anchor.connect(owner).setMetadataHash(hash);
      expect(await anchor.metadataHash()).to.equal(hash);
    }
  });

  it("Fuzz: duplicate root always reverts", async function () {
    const root = randBytes32();
    await anchor.connect(owner).updateRoot(root);
    await expect(anchor.connect(owner).updateRoot(root)).to.be.reverted;
  });

  it("Fuzz: non-owner cannot update root", async function () {
    await expect(
      anchor.connect(signers[1]).updateRoot(randBytes32())
    ).to.be.reverted;
  });

  it("Fuzz: pause blocks root updates", async function () {
    await anchor.connect(owner).pause();
    await expect(anchor.connect(owner).updateRoot(randBytes32())).to.be.reverted;
    await anchor.connect(owner).unpause();
    await expect(anchor.connect(owner).updateRoot(randBytes32())).to.not.be.reverted;
  });

  it("Fuzz: revoked root updates are idempotent (no revert)", async function () {
    for (let i = 0; i < 100; i++) {
      const root = randBytes32();
      await anchor.connect(owner).updateRevokedRoot(root);
      expect(await anchor.revokedRoot()).to.equal(root);
    }
  });
});
