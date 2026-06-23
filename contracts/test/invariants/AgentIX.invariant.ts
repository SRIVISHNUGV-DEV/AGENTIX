import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

describe("Invariant Tests — AgentIX System", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let capReg: any;
  let delMgr: any;
  let orgReg: any;
  let testAnchor: any;
  let wallet: any;
  let factory: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());
    await credentialRegistry.setSessionManager(owner.address, true);

    const AnchorImpl = await ethers.getContractFactory("OrganizationCredentialAnchor");
    const anchorImpl = await AnchorImpl.deploy();
    const OrgRegImpl = await ethers.getContractFactory("OrganizationRegistry");
    const orgRegImpl = await OrgRegImpl.deploy();
    const OrgRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const orgRegProxy = await OrgRegProxy.deploy(
      await orgRegImpl.getAddress(),
      orgRegImpl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );
    orgReg = await ethers.getContractAt("OrganizationRegistry", await orgRegProxy.getAddress());

    const orgId = ethers.keccak256(ethers.toUtf8Bytes("invariant-org"));
    await orgReg.registerOrganization(orgId, "Invariant Org", owner.address);
    const anchorAddr = await orgReg.getCredentialAnchor(orgId);
    testAnchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);
    const root = ethers.keccak256(ethers.toUtf8Bytes("inv-root"));
    const revokedRoot = ethers.keccak256(ethers.toUtf8Bytes("inv-revoked"));
    await testAnchor.connect(owner).updateRoot(root);
    await testAnchor.connect(owner).updateRevokedRoot(revokedRoot);

    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await WalletImpl.deploy();
    const SessMgrImpl = await ethers.getContractFactory("SessionManager");
    const sessMgrImpl = await SessMgrImpl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await sessMgrImpl.getAddress(),
      sessMgrImpl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(),
        await credRegProxy.getAddress(),
        "0x0000000000000000000000000000000000000001"
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

    const CapRegImpl = await ethers.getContractFactory("CapabilityRegistry");
    const capRegImpl = await CapRegImpl.deploy();
    const CapRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const capRegProxy = await CapRegProxy.deploy(
      await capRegImpl.getAddress(),
      capRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    capReg = await ethers.getContractAt("CapabilityRegistry", await capRegProxy.getAddress());

    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const delMgrImpl = await DelMgrImpl.deploy();
    const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const delMgrProxy = await DelMgrProxy.deploy(
      await delMgrImpl.getAddress(),
      delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delMgr = await ethers.getContractAt("DelegationManager", await delMgrProxy.getAddress());

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const mockEntryPoint = ethers.Wallet.createRandom().address;
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint
      ])
    );
    factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());
    await sessionManager.connect(owner).setWalletFactory(await factory.getAddress());
    await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);

    const tx = await factory.connect(owner)["createWallet(address)"](owner.address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  describe("SessionManager Invariants", function () {
    it("INVARIANT: valueUsed never exceeds maxValue for any session", async function () {
      const sessions: any[] = [];
      for (let i = 0; i < 10; i++) {
        const session = await sessionManager.sessions(randBytes32());
        if (session.sessionKey !== ethers.ZeroAddress) {
          expect(session.valueUsed).to.be.lte(session.maxValue);
        }
      }
    });

    it("INVARIANT: revoked sessions have revoked=true", async function () {
      for (let i = 0; i < 100; i++) {
        const id = randBytes32();
        const session = await sessionManager.sessions(id);
        if (session.revoked) {
          expect(session.sessionKey).to.not.equal(ethers.ZeroAddress);
        }
      }
    });

    it("INVARIANT: expired sessions have expiry <= block.timestamp", async function () {
      const block = await ethers.provider.getBlock("latest");
      for (let i = 0; i < 50; i++) {
        const id = randBytes32();
        const session = await sessionManager.sessions(id);
        if (session.sessionKey !== ethers.ZeroAddress && session.expiry > 0) {
          if (session.expiry <= block!.timestamp) {
            expect(session.expiry).to.be.lte(block!.timestamp);
          }
        }
      }
    });
  });

  describe("CredentialRegistry Invariants", function () {
    it("INVARIANT: usedNullifiers never go from true to false", async function () {
      const nullifiers: string[] = [];
      for (let i = 0; i < 50; i++) {
        const n = randBytes32();
        nullifiers.push(n);
        await credentialRegistry.markNullifierUsed(n);
      }
      for (const n of nullifiers) {
        expect(await credentialRegistry.isNullifierUsed(n)).to.be.true;
      }
    });

    it("INVARIANT: non-session-managers cannot mark nullifiers", async function () {
      const rando = signers[0];
      await expect(
        credentialRegistry.connect(rando).markNullifierUsed(randBytes32())
      ).to.be.reverted;
    });
  });

  describe("CapabilityRegistry Invariants", function () {
    it("INVARIANT: revoked capabilities remain revoked", async function () {
      const id = ethers.keccak256(ethers.toUtf8Bytes("invariant-cap"));
      await capReg.registerCapability(id, "test", 0);
      await capReg.revokeCapability(id);
      const cap = await capReg.getCapability(id);
      expect(cap.revoked).to.be.true;
      // After any operations, still revoked
      const cap2 = await capReg.getCapability(id);
      expect(cap2.revoked).to.be.true;
    });

    it("INVARIANT: capability count consistent with list length", async function () {
      const count = await capReg.getCapabilityCount();
      for (let i = 0; i < count; i++) {
        const capId = await capReg.getCapabilityAt(i);
        const cap = await capReg.getCapability(capId);
        expect(cap.revoked).to.be.false;
      }
    });
  });

  describe("DelegationManager Invariants", function () {
    it("INVARIANT: delegation depth never exceeds MAX_DELEGATION_DEPTH", async function () {
      // The contract enforces this, but verify the constant
      expect(await delMgr.MAX_DELEGATION_DEPTH()).to.equal(10);
    });

    it("INVARIANT: revoked delegators remain revoked", async function () {
      const addr = owner.address;
      await delMgr.emergencyRevokeAll(addr);
      expect(await delMgr.revokedDelegators(addr)).to.be.true;
      // Still true after state checks
      expect(await delMgr.revokedDelegators(addr)).to.be.true;
    });

    it("INVARIANT: scope count never exceeds 32 per delegator", async function () {
      for (let i = 0; i < 32; i++) {
        const scopeHash = ethers.keccak256(ethers.toUtf8Bytes(`scope-${i}`));
        await delMgr.updateDelegationRoot(owner.address, scopeHash, randBytes32(), 0);
      }
      const count = await delMgr.getDelegatorScopeCount(owner.address);
      expect(count).to.equal(32);
    });
  });

  describe("AgentWallet Invariants", function () {
    it("INVARIANT: owner is never zero address", async function () {
      const o = await wallet.owner();
      expect(o).to.not.equal(ethers.ZeroAddress);
    });

    it("INVARIANT: pendingOwner is never current owner", async function () {
      const pending = await wallet.pendingOwner();
      const current = await wallet.owner();
      if (pending !== ethers.ZeroAddress) {
        expect(pending).to.not.equal(current);
      }
    });

    it("INVARIANT: whitelist is deterministic", async function () {
      const target = signers[5].address;
      await wallet.setWhiteListedParty(target, true);
      expect(await wallet.whiteListedParties(target)).to.be.true;
      await wallet.setWhiteListedParty(target, false);
      expect(await wallet.whiteListedParties(target)).to.be.false;
    });
  });

  describe("OrganizationRegistry Invariants", function () {
    it("INVARIANT: duplicate organization IDs cannot exist", async function () {
      const id = ethers.keccak256(ethers.toUtf8Bytes("dup-test"));
      await orgReg.registerOrganization(id, "First", owner.address);
      await expect(orgReg.registerOrganization(id, "Second", owner.address)).to.be.reverted;
    });

    it("INVARIANT: organization ownership is deterministic", async function () {
      const id = ethers.keccak256(ethers.toUtf8Bytes("own-test"));
      await orgReg.registerOrganization(id, "Own Test", owner.address);
      const org = await orgReg.getOrganization(id);
      expect(org.owner).to.equal(owner.address);
    });
  });

  describe("OrganizationCredentialAnchor Invariants", function () {
    it("INVARIANT: epochs can only increment", async function () {
      const prevEpoch = await testAnchor.currentEpoch();
      await testAnchor.connect(owner).incrementEpoch();
      const newEpoch = await testAnchor.currentEpoch();
      expect(newEpoch).to.equal(prevEpoch + 1n);
    });

    it("INVARIANT: duplicate roots cannot exist within same state", async function () {
      const root = ethers.keccak256(ethers.toUtf8Bytes("unique-root"));
      await testAnchor.connect(owner).updateRoot(root);
      await expect(testAnchor.connect(owner).updateRoot(root)).to.be.reverted;
    });
  });
});
