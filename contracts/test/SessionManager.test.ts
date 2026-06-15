import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SessionManager", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let mockVerifier: any;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let operator: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async function () {
    [owner, agent, operator, unauthorized] = await ethers.getSigners();

    // Deploy CredentialRegistry (UUPS)
    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());

    // Deploy MockVerifier (non-upgradeable)
    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    // Deploy SessionManager (UUPS)
    const SessMgrImpl = await ethers.getContractFactory("SessionManager");
    const sessMgrImpl = await SessMgrImpl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await sessMgrImpl.getAddress(),
      sessMgrImpl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(),
        await credentialRegistry.getAddress()
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

    // Register SessionManager as allowed caller
    await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);
  });

  async function makeCreateParams(agentAddr: string, nullifierSeed?: string) {
    const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session-" + Math.random()));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes(nullifierSeed || "test-nullifier-" + Math.random()));
    const maxValue = 1000000n;
    const block = await ethers.provider.getBlock("latest");
    const expiry: bigint = BigInt(block!.timestamp) + 7200n;
    const activeRoot = await credentialRegistry.activeRoot();
    const revokedSecretRoot = await credentialRegistry.revokedSecretRoot();
    const publicSignals: [bigint, bigint, bigint, bigint, bigint] = [
      BigInt(nullifier), BigInt(activeRoot), BigInt(revokedSecretRoot), maxValue, expiry
    ];
    const a: [bigint, bigint] = [0n, 0n];
    const b: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];
    const c: [bigint, bigint] = [0n, 0n];
    return { sessionId, nullifier, maxValue, expiry, publicSignals, a, b, c };
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
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await expect(
        sessionManager.connect(operator).createSession(
          p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.emit(sessionManager, "SessionCreated");
    });

    it("Should reject session with invalid proof", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(false);

      await expect(
        sessionManager.connect(operator).createSession(
          p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidProof");
    });
  });

  describe("Session Validation", function () {
    it("Should validate active session", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

      const valid = await sessionManager.validateSession.staticCall(p.sessionId, agentAddr, 1n);
      expect(valid).to.be.true;
    });

    it("Should reject expired session", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

      await ethers.provider.send("evm_increaseTime", [7200]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        sessionManager.validateSession(p.sessionId, agentAddr, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");
    });
  });

  describe("Session Revocation", function () {
    it("Should allow session key to revoke session", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

      await sessionManager.connect(agent).revokeSession(p.sessionId, ethers.ZeroAddress);
      const session = await sessionManager.sessions(p.sessionId);
      expect(session.revoked).to.be.true;
    });

    it("Should prevent unauthorized revocation", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

      await expect(
        sessionManager.connect(unauthorized).revokeSession(p.sessionId, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(sessionManager, "NotAuthorizedToRevoke");
    });
  });

  describe("Nullifier Protection", function () {
    it("Should prevent nullifier reuse", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr, "reuse-nullifier");
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

      const sessionId2 = ethers.keccak256(ethers.toUtf8Bytes("other-session"));
      await expect(
        sessionManager.connect(operator).createSession(
          sessionId2, agentAddr, p.maxValue, p.expiry, p.nullifier,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "NullifierAlreadyUsed");
    });

    it("Should mark nullifier as used in credential registry", async function () {
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);

      await sessionManager.connect(operator).createSession(
        p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
        p.a, p.b, p.c, p.publicSignals
      );

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
      const agentAddr = await agent.getAddress();
      const p = await makeCreateParams(agentAddr);
      await mockVerifier.setResult(true);
      await sessionManager.pause();

      await expect(
        sessionManager.connect(operator).createSession(
          p.sessionId, agentAddr, p.maxValue, p.expiry, p.nullifier,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWith("Pausable: paused");
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
      ).to.be.revertedWith("Pausable: paused");

      await credentialRegistry.unpause();
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.emit(credentialRegistry, "ActiveRootUpdated");
    });
  });
});
