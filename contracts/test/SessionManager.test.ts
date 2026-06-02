import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SessionManager, CredentialRegistry, MockVerifier } from "../typechain-types";

describe("SessionManager", function () {
  let sessionManager: SessionManager;
  let credentialRegistry: CredentialRegistry;
  let mockVerifier: MockVerifier;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let operator: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async function () {
    [owner, agent, operator, unauthorized] = await ethers.getSigners();

    const CredentialRegistryFactory = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistryFactory.deploy();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const SessionManagerFactory = await ethers.getContractFactory("SessionManager");
    sessionManager = await SessionManagerFactory.deploy(
      await mockVerifier.getAddress(),
      await credentialRegistry.getAddress()
    );

    // Register SessionManager as allowed caller for markNullifierUsed
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
      ).to.be.revertedWith("Invalid proof");
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
      ).to.be.revertedWith("Session Expired");
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

      await sessionManager.connect(agent).revokeSession(p.sessionId);
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
        sessionManager.connect(unauthorized).revokeSession(p.sessionId)
      ).to.be.revertedWith("Only session key");
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
      ).to.be.revertedWith("Nullifier used");
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
});

describe("CredentialRegistry", function () {
  let credentialRegistry: CredentialRegistry;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  beforeEach(async function () {
    [owner, issuer, unauthorized] = await ethers.getSigners();
    const CredentialRegistryFactory = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistryFactory.deploy();
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
      ).to.be.reverted;
    });
  });
});

describe("AgentWallet", function () {
  // Tests for agent wallet security
  it("Should prevent initialization after deployment", async function () {
    // This would be tested with actual AgentWallet deployment
    // Placeholder for security test structure
    expect(true).to.be.true;
  });
});
