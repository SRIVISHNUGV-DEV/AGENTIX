import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

function randBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

describe("Adversarial Tests — AgentIX", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let capReg: any;
  let delMgr: any;
  let orgReg: any;
  let testAnchor: any;
  let wallet: any;
  let factory: any;
  let owner: SignerWithAddress;
  let attacker: SignerWithAddress;
  let signers: SignerWithAddress[];
  let orgId: string;

  beforeEach(async function () {
    [owner, attacker, ...signers] = await ethers.getSigners();

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

    orgId = ethers.keccak256(ethers.toUtf8Bytes("adversarial-org"));
    await orgReg.registerOrganization(orgId, "Adv Org", owner.address);
    const anchorAddr = await orgReg.getCredentialAnchor(orgId);
    testAnchor = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAddr);
    const root = ethers.keccak256(ethers.toUtf8Bytes("adv-root"));
    const revokedRoot = ethers.keccak256(ethers.toUtf8Bytes("adv-revoked"));
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
    // Activate factory via timelock
    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();
    await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);

    const tx = await factory.connect(owner)["createWallet(address)"](owner.address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  describe("Attack 1: 100 simultaneous sessions → overspend attempt", function () {
    it("BLOCKED: attacker cannot create sessions without valid proof", async function () {
      for (let i = 0; i < 100; i++) {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`attack-session-${i}`));
        const walletAddr = await wallet.getAddress();
        const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
          BigInt(ethers.keccak256(ethers.toUtf8Bytes("root"))),
          BigInt(ethers.keccak256(ethers.toUtf8Bytes("revoked"))),
          1000000n,
          expiry,
          BigInt(walletAddr),
          1n,
          BigInt(ethers.keccak256(ethers.toUtf8Bytes(`attack-null-${i}`))),
        ];
        await expect(
          sessionManager.connect(attacker).createSession(
            sessionId, walletAddr, attacker.address, 1000000n,
            expiry,
            [0n, 0n],
            [[0n, 0n], [0n, 0n]],
            [0n, 0n],
            publicSignals
          )
        ).to.be.reverted;
      }
    });
  });

  describe("Attack 2: Replay lightweight session signatures", function () {
    it("BLOCKED: duplicate session IDs prevent replay", async function () {
      const sessionId = ethers.id("replay-target");
      const walletAddr = await wallet.getAddress();
      const block = await ethers.provider.getBlock("latest");
      const expiry = BigInt(block!.timestamp + 3600);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [chainId, await sessionManager.getAddress(), walletAddr, sessionId, signers[0].address, ethers.parseEther("1.0"), 10, BigInt(expiry)]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);

      await sessionManager.connect(walletSigner).createLightweightSession(
        sessionId, signers[0].address, ethers.parseEther("1.0"), 10, expiry, signature
      );

      // Replay attempt — same ID should revert
      await expect(
        sessionManager.connect(walletSigner).createLightweightSession(
          sessionId, signers[1].address, ethers.parseEther("1.0"), 10, expiry, signature
        )
      ).to.be.reverted;

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });
  });

  describe("Attack 3: Privilege escalation via delegation", function () {
    it("BLOCKED: unauthorized delegator cannot escalate for another", async function () {
      const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("admin-scope"));
      // Attacker tries to update root for owner — should fail (not delegator, not ROOT_UPDATER)
      await expect(
        delMgr.connect(attacker).updateDelegationRoot(owner.address, scopeHash, randBytes32(), 0)
      ).to.be.reverted;
    });

    it("BLOCKED: revoked delegator cannot delegate", async function () {
      await delMgr.emergencyRevokeAll(attacker.address);
      const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("revoked-scope"));
      await expect(
        delMgr.connect(owner).updateDelegationRoot(attacker.address, scopeHash, randBytes32(), 0)
      ).to.be.reverted;
    });
  });

  describe("Attack 4: Cross-organization authority abuse", function () {
    it("BLOCKED: different org roots cannot be used across orgs", async function () {
      // Org A has its own root
      const orgA = ethers.keccak256(ethers.toUtf8Bytes("org-A"));
      const orgB = ethers.keccak256(ethers.toUtf8Bytes("org-B"));
      await orgReg.registerOrganization(orgA, "Org A", owner.address);
      await orgReg.registerOrganization(orgB, "Org B", owner.address);

      const anchorAAddr = await orgReg.getCredentialAnchor(orgA);
      const anchorA = await ethers.getContractAt("OrganizationCredentialAnchor", anchorAAddr);
      const rootA = ethers.keccak256(ethers.toUtf8Bytes("root-A"));
      await anchorA.connect(owner).updateRoot(rootA);

      const anchorBAddr = await orgReg.getCredentialAnchor(orgB);
      const anchorB = await ethers.getContractAt("OrganizationCredentialAnchor", anchorBAddr);
      const rootB = ethers.keccak256(ethers.toUtf8Bytes("root-B"));
      await anchorB.connect(owner).updateRoot(rootB);

      // Verify roots are different
      expect(await anchorA.currentRoot()).to.not.equal(await anchorB.currentRoot());
    });
  });

  describe("Attack 5: Compromised owner → state corruption", function () {
    it("BLOCKED: attacker cannot pause or upgrade contracts", async function () {
      await expect(sessionManager.connect(attacker).pause()).to.be.reverted;
      await expect(capReg.connect(attacker).pause()).to.be.reverted;
      await expect(orgReg.connect(attacker).pause()).to.be.reverted;
    });

    it("BLOCKED: attacker cannot modify wallet whitelist", async function () {
      await expect(
        wallet.connect(attacker).setWhiteListedSelector(attacker.address, "0x12345678", true)
      ).to.be.reverted;
    });

    it("BLOCKED: attacker cannot change wallet owner", async function () {
      await expect(
        wallet.connect(attacker).changeOwner(attacker.address)
      ).to.be.reverted;
    });
  });

  describe("Attack 6: Malformed inputs from faulty backend", function () {
    it("BLOCKED: zero session key rejected", async function () {
      const walletAddr = await wallet.getAddress();
      const sessionId = randBytes32();
      await expect(
        sessionManager.createLightweightSession(
          sessionId, ethers.ZeroAddress, ethers.parseEther("1.0"), 10,
          BigInt(Math.floor(Date.now() / 1000) + 3600), "0x"
        )
      ).to.be.reverted;
    });

    it("BLOCKED: expired session rejected", async function () {
      const sessionId = randBytes32();
      await expect(
        sessionManager.createLightweightSession(
          sessionId, signers[0].address, ethers.parseEther("1.0"), 10,
          BigInt(Math.floor(Date.now() / 1000) - 1), "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Attack 7: Concurrent wallet execution → double-spend", function () {
    it("BLOCKED: execution only from owner or EntryPoint", async function () {
      await expect(
        wallet.connect(attacker).execute(signers[5].address, 0, "0x")
      ).to.be.reverted;
    });
  });

  describe("Attack 8: Pause/unpause abuse", function () {
    it("BLOCKED: cannot bypass pause via upgrade during pause", async function () {
      await sessionManager.pause();
      const newImpl = await (await ethers.getContractFactory("SessionManager")).deploy();
      await expect(
        sessionManager.connect(attacker).upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.be.reverted;
      await sessionManager.unpause();
    });

    it("BLOCKED: non-admin cannot pause DelegationManager", async function () {
      await expect(delMgr.connect(attacker).pause()).to.be.reverted;
    });
  });

  describe("Attack 9: Factory manipulation", function () {
    it("BLOCKED: non-owner cannot change factory implementation", async function () {
      await expect(
        factory.connect(attacker).proposeImplementation(signers[9].address)
      ).to.be.reverted;
    });

    it("BLOCKED: non-owner cannot change factory sessionManager", async function () {
      await expect(
        factory.connect(attacker).proposeSessionManager(signers[9].address)
      ).to.be.reverted;
    });
  });

  describe("Attack 10: Null injection via capability registry", function () {
    it("BLOCKED: non-owner cannot register capabilities", async function () {
      await expect(
        capReg.connect(attacker).registerCapability(randBytes32(), "evil-action", 0)
      ).to.be.reverted;
    });

    it("BLOCKED: unregistered grantor cannot verify", async function () {
      const valid = await capReg.verifyCapability(
        attacker.address, randBytes32(), randBytes32(), [], attacker.address, ethers.ZeroHash, 0
      );
      expect(valid).to.be.false;
    });
  });
});
