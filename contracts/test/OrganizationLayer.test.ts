import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrganizationLayer — Unit & Security", function () {
  let orgRegistry: any;
  let anchorImpl: any;
  let owner: SignerWithAddress;
  let orgOwner: SignerWithAddress;
  let alice: SignerWithAddress;
  let attacker: SignerWithAddress;

  const ORG_ID = ethers.keccak256(ethers.toUtf8Bytes("org-acme"));
  const ORG_ID_2 = ethers.keccak256(ethers.toUtf8Bytes("org-globex"));

  beforeEach(async function () {
    [owner, orgOwner, alice, attacker] = await ethers.getSigners();

    // Deploy OrganizationCredentialAnchor implementation
    const AnchorF = await ethers.getContractFactory("OrganizationCredentialAnchor");
    anchorImpl = await AnchorF.deploy();
    await anchorImpl.waitForDeployment();

    // Deploy OrganizationRegistry
    const RegistryF = await ethers.getContractFactory("OrganizationRegistry");
    const registryImpl = await RegistryF.deploy();
    await registryImpl.waitForDeployment();
    const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await ProxyF.deploy(
      await registryImpl.getAddress(),
      registryImpl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
    );
    orgRegistry = await ethers.getContractAt("OrganizationRegistry", await proxy.getAddress());
  });

  // ═══════════════════════════════════════════════════════
  // OrganizationRegistry
  // ═══════════════════════════════════════════════════════

  describe("OrganizationRegistry — Initialization", function () {
    it("Should set owner correctly", async function () {
      expect(await orgRegistry.owner()).to.equal(owner.address);
    });

    it("Should set anchor implementation", async function () {
      expect(await orgRegistry.anchorImplementation()).to.equal(await anchorImpl.getAddress());
    });

    it("Should prevent re-initialization", async function () {
      const RegistryF = await ethers.getContractFactory("OrganizationRegistry");
      const impl = await RegistryF.deploy();
      await expect(impl.initialize(owner.address, await anchorImpl.getAddress())).to.be.reverted;
    });

    it("Should reject zero-address anchor implementation", async function () {
      const RegistryF = await ethers.getContractFactory("OrganizationRegistry");
      const impl = await RegistryF.deploy();
      await expect(impl.initialize(owner.address, ethers.ZeroAddress)).to.be.reverted;
    });
  });

  describe("OrganizationRegistry — Registration", function () {
    it("Should register an organization", async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      const org = await orgRegistry.getOrganization(ORG_ID);
      expect(org.organizationId).to.equal(ORG_ID);
      expect(org.name).to.equal("Acme Corp");
      expect(org.owner).to.equal(orgOwner.address);
      expect(org.active).to.be.true;
    });

    it("Should deploy a credential anchor clone", async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      const org = await orgRegistry.getOrganization(ORG_ID);
      expect(org.credentialAnchor).to.not.equal(ethers.ZeroAddress);
      // Clone should have code
      const code = await ethers.provider.getCode(org.credentialAnchor);
      expect(code.length).to.be.greaterThan(2);
    });

    it("Should emit OrganizationRegistered event", async function () {
      const tx = await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try { return orgRegistry.interface.parseLog(log as any)?.name === "OrganizationRegistered"; } catch { return false; }
      });
      const parsed = orgRegistry.interface.parseLog(event as any) as any;
      expect(parsed.args.organizationId).to.equal(ORG_ID);
      expect(parsed.args.name).to.equal("Acme Corp");
      expect(parsed.args.owner).to.equal(orgOwner.address);
      expect(parsed.args.credentialAnchor).to.not.equal(ethers.ZeroAddress);
    });

    it("Should track owner organizations", async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      await orgRegistry.registerOrganization(ORG_ID_2, "Globex Inc", orgOwner.address);
      const orgs = await orgRegistry.getOwnerOrganizations(orgOwner.address);
      expect(orgs.length).to.equal(2);
    });

    it("Should reject duplicate organization ID", async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      await expect(
        orgRegistry.registerOrganization(ORG_ID, "Acme Corp 2", orgOwner.address)
      ).to.be.revertedWithCustomError(orgRegistry, "OrganizationAlreadyExists");
    });

    it("Should reject zero-address owner", async function () {
      await expect(
        orgRegistry.registerOrganization(ORG_ID, "Acme Corp", ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(orgRegistry, "InvalidOwnerAddress");
    });

    it("Should reject empty name", async function () {
      await expect(
        orgRegistry.registerOrganization(ORG_ID, "", orgOwner.address)
      ).to.be.revertedWithCustomError(orgRegistry, "InvalidName");
    });

    it("Should prevent non-owner from registering", async function () {
      await expect(
        orgRegistry.connect(alice).registerOrganization(ORG_ID, "Acme Corp", alice.address)
      ).to.be.reverted;
    });

    it("Should register multiple organizations under different owners", async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme", orgOwner.address);
      await orgRegistry.registerOrganization(ORG_ID_2, "Globex", alice.address);
      expect(await orgRegistry.isActive(ORG_ID)).to.be.true;
      expect(await orgRegistry.isActive(ORG_ID_2)).to.be.true;
    });
  });

  describe("OrganizationRegistry — Deactivation", function () {
    beforeEach(async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
    });

    it("Should deactivate an organization", async function () {
      await orgRegistry.deactivateOrganization(ORG_ID);
      expect(await orgRegistry.isActive(ORG_ID)).to.be.false;
    });

    it("Should emit OrganizationDeactivated event", async function () {
      await expect(orgRegistry.deactivateOrganization(ORG_ID))
        .to.emit(orgRegistry, "OrganizationDeactivated")
        .withArgs(ORG_ID);
    });

    it("Should reject deactivating non-existent org", async function () {
      await expect(
        orgRegistry.deactivateOrganization(ORG_ID_2)
      ).to.be.revertedWithCustomError(orgRegistry, "OrganizationNotFound");
    });

    it("Should reject deactivating already inactive org", async function () {
      await orgRegistry.deactivateOrganization(ORG_ID);
      await expect(
        orgRegistry.deactivateOrganization(ORG_ID)
      ).to.be.revertedWithCustomError(orgRegistry, "OrganizationNotFound");
    });

    it("Should prevent non-owner from deactivating", async function () {
      await expect(
        orgRegistry.connect(alice).deactivateOrganization(ORG_ID)
      ).to.be.reverted;
    });
  });

  describe("OrganizationRegistry — Reactivation", function () {
    beforeEach(async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      await orgRegistry.deactivateOrganization(ORG_ID);
    });

    it("Should reactivate an organization", async function () {
      await orgRegistry.reactivateOrganization(ORG_ID);
      expect(await orgRegistry.isActive(ORG_ID)).to.be.true;
    });

    it("Should emit OrganizationReactivated event", async function () {
      await expect(orgRegistry.reactivateOrganization(ORG_ID))
        .to.emit(orgRegistry, "OrganizationReactivated")
        .withArgs(ORG_ID);
    });

    it("Should reject reactivating active org", async function () {
      await orgRegistry.reactivateOrganization(ORG_ID);
      await expect(
        orgRegistry.reactivateOrganization(ORG_ID)
      ).to.be.revertedWithCustomError(orgRegistry, "OrganizationNotFound");
    });
  });

  describe("OrganizationRegistry — Anchor Management", function () {
    beforeEach(async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
    });

    it("Should set a new credential anchor", async function () {
      const newAnchor = alice.address;
      await orgRegistry.setCredentialAnchor(ORG_ID, newAnchor);
      const org = await orgRegistry.getOrganization(ORG_ID);
      expect(org.credentialAnchor).to.equal(newAnchor);
    });

    it("Should emit CredentialAnchorUpdated event", async function () {
      const org = await orgRegistry.getOrganization(ORG_ID);
      await expect(orgRegistry.setCredentialAnchor(ORG_ID, alice.address))
        .to.emit(orgRegistry, "CredentialAnchorUpdated")
        .withArgs(ORG_ID, org.credentialAnchor, alice.address);
    });

    it("Should reject zero-address anchor", async function () {
      await expect(
        orgRegistry.setCredentialAnchor(ORG_ID, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(orgRegistry, "ZeroAddressNotAllowed");
    });

    it("Should prevent non-owner from setting anchor", async function () {
      await expect(
        orgRegistry.connect(alice).setCredentialAnchor(ORG_ID, alice.address)
      ).to.be.reverted;
    });
  });

  describe("OrganizationRegistry — View Functions", function () {
    beforeEach(async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
    });

    it("Should return organizationExists = true for registered org", async function () {
      expect(await orgRegistry.organizationExists(ORG_ID)).to.be.true;
    });

    it("Should return organizationExists = false for unknown org", async function () {
      expect(await orgRegistry.organizationExists(ORG_ID_2)).to.be.false;
    });

    it("Should return getCredentialAnchor address", async function () {
      const anchor = await orgRegistry.getCredentialAnchor(ORG_ID);
      expect(anchor).to.not.equal(ethers.ZeroAddress);
    });

    it("Should reject getOrganization for non-existent org", async function () {
      await expect(orgRegistry.getOrganization(ORG_ID_2)).to.be.reverted;
    });
  });

  describe("OrganizationRegistry — Pausable", function () {
    it("Should pause and unpause", async function () {
      await orgRegistry.pause();
      expect(await orgRegistry.paused()).to.be.true;
      await orgRegistry.unpause();
      expect(await orgRegistry.paused()).to.be.false;
    });

    it("Should block registration when paused", async function () {
      await orgRegistry.pause();
      await expect(
        orgRegistry.registerOrganization(ORG_ID, "Acme", orgOwner.address)
      ).to.be.revertedWithCustomError(orgRegistry, "EnforcedPause");
    });

    it("Should prevent non-owner from pausing", async function () {
      await expect(orgRegistry.connect(alice).pause()).to.be.reverted;
    });
  });

  describe("OrganizationRegistry — UUPS Upgrade", function () {
    it("Should allow owner to upgrade", async function () {
      const RegistryF = await ethers.getContractFactory("OrganizationRegistry");
      const newImpl = await RegistryF.deploy();
      await expect(orgRegistry.upgradeToAndCall(await newImpl.getAddress(), "0x")).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const RegistryF = await ethers.getContractFactory("OrganizationRegistry");
      const newImpl = await RegistryF.deploy();
      await expect(
        orgRegistry.connect(alice).upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════
  // OrganizationCredentialAnchor
  // ═══════════════════════════════════════════════════════

  describe("OrganizationCredentialAnchor", function () {
    let anchor: any;

    beforeEach(async function () {
      await orgRegistry.registerOrganization(ORG_ID, "Acme Corp", orgOwner.address);
      const anchorAddr = await orgRegistry.getCredentialAnchor(ORG_ID);
      anchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);
    });

    describe("Initialization", function () {
      it("Should set organizationId", async function () {
        expect(await anchor.organizationId()).to.equal(ORG_ID);
      });

      it("Should set owner to org owner", async function () {
        expect(await anchor.owner()).to.equal(orgOwner.address);
      });

      it("Should start with zero roots", async function () {
        expect(await anchor.currentRoot()).to.equal(ethers.ZeroHash);
        expect(await anchor.revokedRoot()).to.equal(ethers.ZeroHash);
      });

      it("Should start with epoch 0", async function () {
        expect(await anchor.currentEpoch()).to.equal(0);
      });

      it("Should start with PRIVATE visibility", async function () {
        expect(await anchor.visibility()).to.equal(0); // PRIVATE
      });

      it("Should prevent re-initialization", async function () {
        await expect(anchor.initialize(ORG_ID_2, alice.address)).to.be.reverted;
      });
    });

    describe("Root Updates", function () {
      it("Should update root", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
        await anchor.connect(orgOwner).updateRoot(newRoot);
        expect(await anchor.currentRoot()).to.equal(newRoot);
      });

      it("Should emit RootUpdated event", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
        await expect(anchor.connect(orgOwner).updateRoot(newRoot))
          .to.emit(anchor, "RootUpdated")
          .withArgs(ORG_ID, ethers.ZeroHash, newRoot);
      });

      it("Should reject duplicate root", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
        await anchor.connect(orgOwner).updateRoot(newRoot);
        await expect(anchor.connect(orgOwner).updateRoot(newRoot))
          .to.be.revertedWithCustomError(anchor, "RootAlreadyCurrent");
      });

      it("Should allow root update after epoch change", async function () {
        const root1 = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
        await anchor.connect(orgOwner).updateRoot(root1);
        await anchor.connect(orgOwner).incrementEpoch();
        const root2 = ethers.keccak256(ethers.toUtf8Bytes("root-2"));
        await anchor.connect(orgOwner).updateRoot(root2);
        expect(await anchor.currentRoot()).to.equal(root2);
      });

      it("Should prevent non-owner from updating root", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
        await expect(anchor.connect(alice).updateRoot(newRoot)).to.be.reverted;
      });
    });

    describe("Revoked Root Updates", function () {
      it("Should update revoked root", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("revoked-1"));
        await anchor.connect(orgOwner).updateRevokedRoot(newRoot);
        expect(await anchor.revokedRoot()).to.equal(newRoot);
      });

      it("Should emit RevokedRootUpdated event", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("revoked-1"));
        await expect(anchor.connect(orgOwner).updateRevokedRoot(newRoot))
          .to.emit(anchor, "RevokedRootUpdated")
          .withArgs(ORG_ID, ethers.ZeroHash, newRoot);
      });

      it("Should prevent non-owner from updating revoked root", async function () {
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("revoked-1"));
        await expect(anchor.connect(alice).updateRevokedRoot(newRoot)).to.be.reverted;
      });
    });

    describe("Epoch Management", function () {
      it("Should increment epoch", async function () {
        await anchor.connect(orgOwner).incrementEpoch();
        expect(await anchor.currentEpoch()).to.equal(1);
        await anchor.connect(orgOwner).incrementEpoch();
        expect(await anchor.currentEpoch()).to.equal(2);
      });

      it("Should emit EpochIncremented event", async function () {
        await expect(anchor.connect(orgOwner).incrementEpoch())
          .to.emit(anchor, "EpochIncremented")
          .withArgs(ORG_ID, 1);
      });

      it("Should prevent non-owner from incrementing epoch", async function () {
        await expect(anchor.connect(alice).incrementEpoch()).to.be.reverted;
      });
    });

    describe("Visibility", function () {
      it("Should set visibility to PUBLIC", async function () {
        await anchor.connect(orgOwner).setVisibility(1); // PUBLIC
        expect(await anchor.visibility()).to.equal(1);
      });

      it("Should emit VisibilityChanged event", async function () {
        await expect(anchor.connect(orgOwner).setVisibility(1))
          .to.emit(anchor, "VisibilityChanged")
          .withArgs(ORG_ID, 1);
      });

      it("Should prevent non-owner from setting visibility", async function () {
        await expect(anchor.connect(alice).setVisibility(1)).to.be.reverted;
      });
    });

    describe("Metadata Hash", function () {
      it("Should set metadata hash", async function () {
        const hash = ethers.keccak256(ethers.toUtf8Bytes("metadata"));
        await anchor.connect(orgOwner).setMetadataHash(hash);
        expect(await anchor.metadataHash()).to.equal(hash);
      });

      it("Should emit MetadataHashUpdated event", async function () {
        const hash = ethers.keccak256(ethers.toUtf8Bytes("metadata"));
        await expect(anchor.connect(orgOwner).setMetadataHash(hash))
          .to.emit(anchor, "MetadataHashUpdated")
          .withArgs(ORG_ID, hash);
      });

      it("Should prevent non-owner from setting metadata hash", async function () {
        const hash = ethers.keccak256(ethers.toUtf8Bytes("metadata"));
        await expect(anchor.connect(alice).setMetadataHash(hash)).to.be.reverted;
      });
    });

    describe("View Helpers", function () {
      it("Should return roots via getRoots()", async function () {
        const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
        const revoked = ethers.keccak256(ethers.toUtf8Bytes("revoked"));
        await anchor.connect(orgOwner).updateRoot(root);
        await anchor.connect(orgOwner).updateRevokedRoot(revoked);
        const [r, rr] = await anchor.getRoots();
        expect(r).to.equal(root);
        expect(rr).to.equal(revoked);
      });
    });

    describe("Pausable", function () {
      it("Should pause and unpause", async function () {
        await anchor.connect(orgOwner).pause();
        expect(await anchor.paused()).to.be.true;
        await anchor.connect(orgOwner).unpause();
        expect(await anchor.paused()).to.be.false;
      });

      it("Should block root updates when paused", async function () {
        await anchor.connect(orgOwner).pause();
        const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root"));
        await expect(anchor.connect(orgOwner).updateRoot(newRoot))
          .to.be.revertedWithCustomError(anchor, "EnforcedPause");
      });

      it("Should block epoch increment when paused", async function () {
        await anchor.connect(orgOwner).pause();
        await expect(anchor.connect(orgOwner).incrementEpoch())
          .to.be.revertedWithCustomError(anchor, "EnforcedPause");
      });

      it("Should prevent non-owner from pausing", async function () {
        await expect(anchor.connect(alice).pause()).to.be.reverted;
      });
    });

    describe("UUPS Upgrade", function () {
      // ponytail: implementation has no owner set (constructor calls _disableInitializers before __Ownable_init).
      // UUPS on the impl is a no-op for EIP1167 clones. Upgrading clones = redeploying from new impl.
      it("Should prevent non-owner from upgrading implementation", async function () {
        const AnchorF = await ethers.getContractFactory("OrganizationCredentialAnchor");
        const newImpl = await AnchorF.deploy();
        await expect(
          anchorImpl.connect(alice).upgradeToAndCall(await newImpl.getAddress(), "0x")
        ).to.be.reverted;
      });
    });

    describe("Self-Destruct Protection", function () {
      it("Should mark implementation as initialized", async function () {
        await expect(anchorImpl.initialize(ORG_ID, owner.address)).to.be.reverted;
      });
    });
  });

  // ═══════════════════════════════════════════════════════
  // Integration: 100 organizations simulation
  // ═══════════════════════════════════════════════════════

  describe("100 Organizations Simulation", function () {
    it("Should register 100 organizations", async function () {
      for (let i = 0; i < 100; i++) {
        const id = ethers.keccak256(ethers.toUtf8Bytes(`org-${i}`));
        await orgRegistry.registerOrganization(id, `Org ${i}`, orgOwner.address);
      }
      // Verify a few
      expect(await orgRegistry.organizationExists(ethers.keccak256(ethers.toUtf8Bytes("org-0")))).to.be.true;
      expect(await orgRegistry.organizationExists(ethers.keccak256(ethers.toUtf8Bytes("org-99")))).to.be.true;
      const orgs = await orgRegistry.getOwnerOrganizations(orgOwner.address);
      expect(orgs.length).to.equal(100);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Integration: CredentialRegistry (stripped)
  // ═══════════════════════════════════════════════════════

  describe("CredentialRegistry — Stripped", function () {
    let credReg: any;

    beforeEach(async function () {
      const CredRegF = await ethers.getContractFactory("CredentialRegistry");
      const impl = await CredRegF.deploy();
      const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyF.deploy(
        await impl.getAddress(),
        impl.interface.encodeFunctionData("initialize", [owner.address])
      );
      credReg = await ethers.getContractAt("CredentialRegistry", await proxy.getAddress());
    });

    it("Should manage issuers", async function () {
      await credReg.addIssuer(alice.address);
      expect(await credReg.issuers(alice.address)).to.be.true;
      await credReg.removeIssuer(alice.address);
      expect(await credReg.issuers(alice.address)).to.be.false;
    });

    it("Should manage session managers", async function () {
      await credReg.setSessionManager(alice.address, true);
      expect(await credReg.sessionManagers(alice.address)).to.be.true;
    });

    it("Should track nullifiers", async function () {
      await credReg.setSessionManager(owner.address, true);
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("null-1"));
      await credReg.markNullifierUsed(nullifier);
      expect(await credReg.isNullifierUsed(nullifier)).to.be.true;
    });

    it("Should reject nullifier reuse", async function () {
      await credReg.setSessionManager(owner.address, true);
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("null-1"));
      await credReg.markNullifierUsed(nullifier);
      await expect(credReg.markNullifierUsed(nullifier)).to.be.reverted;
    });

    it("Should have activeRoot and revokedSecretRoot as zero by default", async function () {
      expect(await credReg.activeRoot()).to.equal(ethers.ZeroHash);
      expect(await credReg.revokedSecretRoot()).to.equal(ethers.ZeroHash);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Integration: SessionManager + Org Layer
  // ═══════════════════════════════════════════════════════

  describe("SessionManager — Organization Integration", function () {
    let sessionManager: any;
    let credReg: any;
    let mockVerifier: any;
    let factory: any;
    let wallet: any;
    let walletAddress: string;

    beforeEach(async function () {
      // Deploy all dependencies
      const MockVerifierF = await ethers.getContractFactory("MockVerifier");
      mockVerifier = await MockVerifierF.deploy();

      const CredRegF = await ethers.getContractFactory("CredentialRegistry");
      const credRegImpl = await CredRegF.deploy();
      const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
      const credRegProxy = await ProxyF.deploy(
        await credRegImpl.getAddress(),
        credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
      );
      credReg = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());

      const WalletImplF = await ethers.getContractFactory("AgentWallet");
      const walletImpl = await WalletImplF.deploy();

      const placeholder = "0x0000000000000000000000000000000000000001";
      const SessMgrF = await ethers.getContractFactory("SessionManager");
      const sessMgrImpl = await SessMgrF.deploy();
      const sessMgrProxy = await ProxyF.deploy(
        await sessMgrImpl.getAddress(),
        sessMgrImpl.interface.encodeFunctionData("initialize", [
          await mockVerifier.getAddress(), await credReg.getAddress(), placeholder
        ])
      );
      sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

      const FactoryF = await ethers.getContractFactory("AgentWalletFactory");
      const factoryImpl = await FactoryF.deploy();
      const factoryProxy = await ProxyF.deploy(
        await factoryImpl.getAddress(),
        factoryImpl.interface.encodeFunctionData("initialize", [
          await walletImpl.getAddress(), await sessionManager.getAddress(), owner.address
        ])
      );
      factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());

      await sessionManager.setWalletFactory(await factory.getAddress());
      await credReg.setSessionManager(await sessionManager.getAddress(), true);

      // Create a wallet
      const tx = await factory.createWallet(owner.address);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
      });
      walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
      wallet = await ethers.getContractAt("AgentWallet", walletAddress);
    });

    it("Should have orgRegistry set", async function () {
      expect(await sessionManager.orgRegistry()).to.equal(await orgRegistry.getAddress());
    });

    it("Should create session with organizationId and valid org roots", async function () {
      // Register org and set roots
      const orgId = ethers.keccak256(ethers.toUtf8Bytes("test-org"));
      await orgRegistry.registerOrganization(orgId, "Test Org", owner.address);
      const anchorAddr = await orgRegistry.getCredentialAnchor(orgId);
      const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);

      const root = ethers.keccak256(ethers.toUtf8Bytes("credential-root"));
      const revokedRoot = ethers.keccak256(ethers.toUtf8Bytes("revoked-root"));
      await anchor.updateRoot(root);
      await anchor.updateRevokedRoot(revokedRoot);

      // Build public signals matching org roots
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-1"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("null-1"));
      const maxValue = 1000n;
      const block = await ethers.provider.getBlock("latest");
      const expiry = BigInt(block!.timestamp) + 7200n;

      const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(nullifier),
        BigInt(root),
        BigInt(revokedRoot),
        maxValue,
        expiry,
        BigInt(walletAddress),
      ];

      await mockVerifier.setResult(true);

      await expect(
        sessionManager.createSession(
          sessionId, walletAddress, alice.address, maxValue, expiry,
          nullifier, orgId,
          { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n], publicSignals }
        )
      ).to.emit(sessionManager, "SessionCreated");
    });

    it("Should reject session with inactive organization", async function () {
      const orgId = ethers.keccak256(ethers.toUtf8Bytes("inactive-org"));
      await orgRegistry.registerOrganization(orgId, "Inactive", owner.address);
      await orgRegistry.deactivateOrganization(orgId);

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-2"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("null-2"));
      const block = await ethers.provider.getBlock("latest");

      await expect(
        sessionManager.createSession(
          sessionId, walletAddress, alice.address, 1000n, BigInt(block!.timestamp) + 7200n,
          nullifier, orgId,
          { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n], publicSignals: [BigInt(nullifier), 0n, 0n, 1000n, BigInt(block!.timestamp) + 7200n, BigInt(walletAddress)] }
        )
      ).to.be.revertedWithCustomError(sessionManager, "OrganizationNotActive");
    });

    it("Should reject session with wrong root (not matching org anchor)", async function () {
      const orgId = ethers.keccak256(ethers.toUtf8Bytes("test-org-2"));
      await orgRegistry.registerOrganization(orgId, "Test Org 2", owner.address);
      const anchorAddr = await orgRegistry.getCredentialAnchor(orgId);
      const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);

      const realRoot = ethers.keccak256(ethers.toUtf8Bytes("real-root"));
      await anchor.updateRoot(realRoot);
      await anchor.updateRevokedRoot(ethers.ZeroHash);

      // Try with a different root in public signals
      const fakeRoot = ethers.keccak256(ethers.toUtf8Bytes("fake-root"));
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-3"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("null-3"));
      const block = await ethers.provider.getBlock("latest");

      await expect(
        sessionManager.createSession(
          sessionId, walletAddress, alice.address, 1000n, BigInt(block!.timestamp) + 7200n,
          nullifier, orgId,
          { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n], publicSignals: [BigInt(nullifier), BigInt(fakeRoot), 0n, 1000n, BigInt(block!.timestamp) + 7200n, BigInt(walletAddress)] }
        )
      ).to.be.revertedWithCustomError(sessionManager, "RootMismatch");
    });

    it("Should allow setOrgRegistry", async function () {
      await sessionManager.setOrgRegistry(alice.address);
      expect(await sessionManager.orgRegistry()).to.equal(alice.address);
    });

    it("Should reject zero-address setOrgRegistry", async function () {
      await expect(sessionManager.setOrgRegistry(ethers.ZeroAddress)).to.be.reverted;
    });
  });
});
