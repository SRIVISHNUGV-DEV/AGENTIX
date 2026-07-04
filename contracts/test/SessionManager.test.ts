import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SessionManager", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let mockVerifier: any;
  let walletImpl: any;
  let agentWallet: any;
  let operatorWallet: any;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let operator: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async function () {
    [owner, agent, operator, unauthorized] = await ethers.getSigners();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const WalletImplF = await ethers.getContractFactory("AgentWallet");
    walletImpl = await WalletImplF.deploy();
    const placeholderAddr = "0x0000000000000000000000000000000000000001";

    const SessMgrImpl = await ethers.getContractFactory("SessionManager");
    const sessMgrImpl = await SessMgrImpl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await sessMgrImpl.getAddress(),
      sessMgrImpl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(),
        await credentialRegistry.getAddress(),
        placeholderAddr,
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

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
    const factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());

    await sessionManager.proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.acceptWalletFactory();

    await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);

    const tx1 = await factory.connect(owner).createWallet(await agent.getAddress());
    const receipt1 = await tx1.wait();
    const event1 = receipt1?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const agentWalletAddr = (factory.interface.parseLog(event1 as any) as any).args.wallet;
    agentWallet = await ethers.getContractAt("AgentWallet", agentWalletAddr);

    const tx2 = await factory.connect(owner).createWallet(await operator.getAddress());
    const receipt2 = await tx2.wait();
    const event2 = receipt2?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const operatorWalletAddr = (factory.interface.parseLog(event2 as any) as any).args.wallet;
    operatorWallet = await ethers.getContractAt("AgentWallet", operatorWalletAddr);

    await owner.sendTransaction({ to: agentWalletAddr, value: ethers.parseEther("10.0") });
    await owner.sendTransaction({ to: operatorWalletAddr, value: ethers.parseEther("10.0") });
  });

  async function makeCreateParams(walletAddress: string, nullifierSeed?: string) {
    const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session-" + Math.random()));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes(nullifierSeed || "test-nullifier-" + Math.random()));
    const maxValue = 1000000n;
    const block = await ethers.provider.getBlock("latest");
    const expiry: bigint = BigInt(block!.timestamp) + 7200n;
    const activeRoot = await credentialRegistry.activeRoot();
    const revokedSecretRoot = await credentialRegistry.revokedSecretRoot();
    const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      BigInt(activeRoot), BigInt(revokedSecretRoot), maxValue, expiry, BigInt(walletAddress), 1n, BigInt(nullifier)
    ];
    const a: [bigint, bigint] = [0n, 0n];
    const b: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];
    const c: [bigint, bigint] = [0n, 0n];
    return { sessionId, nullifier, maxValue, expiry, publicSignals, a, b, c };
  }

  async function createSessionAsWallet(walletAddr: string, sessionKeyAddr: string, p: any) {
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
    const walletSigner = await ethers.getSigner(walletAddr);
    const tx = await sessionManager.connect(walletSigner).createSession(
      p.sessionId, walletAddr, sessionKeyAddr, p.maxValue, p.expiry,
      p.a, p.b, p.c, p.publicSignals
    );
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    return tx;
  }

  describe("Deployment", function () {
    it("Should set correct credential registry", async function () {
      expect(await sessionManager.registry()).to.equal(await credentialRegistry.getAddress());
    });

    it("Should set correct verifier", async function () {
      expect(await sessionManager.verifier()).to.equal(await mockVerifier.getAddress());
    });

    it("Should set correct owner", async function () {
      expect(await sessionManager.owner()).to.equal(owner.address);
    });
  });

  describe("Session Creation", function () {
    it("Should create session with valid proof", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(walletAddr, sessionKeyAddr, p)
      ).to.emit(sessionManager, "SessionCreated");
    });

    it("Should reject session with invalid proof", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(false);

      await expect(
        createSessionAsWallet(walletAddr, sessionKeyAddr, p)
      ).to.be.revertedWithCustomError(sessionManager, "InvalidProof");
    });
  });

  describe("Session Validation", function () {
    it("Should validate active session", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      const valid = await sessionManager.connect(walletSigner).validateSession.staticCall(p.sessionId, sessionKeyAddr, 1n);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
      expect(valid).to.be.true;
    });

    it("Should reject expired session", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      await ethers.provider.send("evm_increaseTime", [7200]);
      await ethers.provider.send("evm_mine", []);

      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await expect(
        sessionManager.connect(walletSigner).validateSession(p.sessionId, sessionKeyAddr, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });
  });

  describe("Session Revocation", function () {
    it("Should allow session key to revoke session", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      await sessionManager.connect(operator).revokeSession(p.sessionId, walletAddr);
      const session = await sessionManager.sessions(p.sessionId);
      expect(session.revoked).to.be.true;
    });

    it("Should prevent unauthorized revocation", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      await expect(
        sessionManager.connect(unauthorized).revokeSession(p.sessionId, walletAddr)
      ).to.be.revertedWithCustomError(sessionManager, "NotAuthorizedToRevoke");
    });
  });

  describe("Nullifier Protection", function () {
    it("Should prevent nullifier reuse", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr, "reuse-nullifier");
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      const sessionId2 = ethers.keccak256(ethers.toUtf8Bytes("other-session"));
      const p2 = { ...p, sessionId: sessionId2 };
      await expect(
        createSessionAsWallet(walletAddr, sessionKeyAddr, p2)
      ).to.be.revertedWithCustomError(sessionManager, "NullifierAlreadyUsed");
    });

    it("Should mark nullifier as used in credential registry", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(walletAddr, sessionKeyAddr, p);

      expect(await credentialRegistry.isNullifierUsed(p.nullifier)).to.be.true;
    });
  });

  describe("Upgrade", function () {
    it("Should prevent non-owner from upgrading", async function () {
      const SessMgrImpl = await ethers.getContractFactory("SessionManager");
      const newImpl = await SessMgrImpl.deploy();
      await expect(
        sessionManager.connect(unauthorized).upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.be.reverted;
    });

    it("Should allow owner to pause (upgrade auth check)", async function () {
      await sessionManager.pause();
      expect(await sessionManager.paused()).to.be.true;
      await sessionManager.unpause();
    });
  });

  describe("Pausable", function () {
    it("Should allow owner to pause and unpause", async function () {
      await sessionManager.pause();
      expect(await sessionManager.paused()).to.be.true;

      await sessionManager.unpause();
      expect(await sessionManager.paused()).to.be.false;
    });

    it("Should prevent session creation when paused", async function () {
      const walletAddr = await agentWallet.getAddress();
      const sessionKeyAddr = await operator.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);
      await sessionManager.pause();

      await expect(
        createSessionAsWallet(walletAddr, sessionKeyAddr, p)
      ).to.be.revertedWithCustomError(sessionManager, "EnforcedPause");
    });
  });
});

describe("CredentialRegistry", function () {
  let credentialRegistry: any;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async function () {
    [owner, issuer, unauthorized] = await ethers.getSigners();
    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const impl = await CredRegImpl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await proxy.getAddress());
  });

  describe("Access Control", function () {
    it("Should allow owner to add issuer", async function () {
      await credentialRegistry.addIssuer(await issuer.getAddress());
      expect(await credentialRegistry.issuers(await issuer.getAddress())).to.be.true;
    });

    it("Should prevent non-owner from adding issuer", async function () {
      await expect(
        credentialRegistry.connect(unauthorized).addIssuer(await issuer.getAddress())
      ).to.be.reverted;
    });

    it("Should allow owner to remove issuer", async function () {
      await credentialRegistry.addIssuer(await issuer.getAddress());
      await credentialRegistry.removeIssuer(await issuer.getAddress());
      expect(await credentialRegistry.issuers(await issuer.getAddress())).to.be.false;
    });
  });

  describe("Root Management", function () {
    it("Should allow issuer to update active root", async function () {
      await credentialRegistry.addIssuer(await issuer.getAddress());
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new-root"));

      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.emit(credentialRegistry, "ActiveRootUpdated");

      expect(await credentialRegistry.activeRoot()).to.equal(newRoot);
    });

    it("Should prevent non-issuer from updating root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new-root"));

      await expect(
        credentialRegistry.connect(unauthorized).updateActiveRoot(newRoot)
      ).to.be.revertedWithCustomError(credentialRegistry, "OnlyIssuer");
    });
  });

  describe("Pausable", function () {
    it("Should pause and unpause root updates", async function () {
      await credentialRegistry.addIssuer(await issuer.getAddress());
      await credentialRegistry.pause();

      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new-root"));
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.be.revertedWithCustomError(credentialRegistry, "EnforcedPause");

      await credentialRegistry.unpause();
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.emit(credentialRegistry, "ActiveRootUpdated");
    });
  });
});
