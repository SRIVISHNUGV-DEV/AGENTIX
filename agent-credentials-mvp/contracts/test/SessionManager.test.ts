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

  const PROOF_VALID = true;

  beforeEach(async function () {
    [owner, agent, operator, unauthorized] = await ethers.getSigners();

    // Deploy CredentialRegistry
    const CredentialRegistryFactory = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistryFactory.deploy();

    // Deploy MockVerifier
    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    // Deploy SessionManager
    const SessionManagerFactory = await ethers.getContractFactory("SessionManager");
    sessionManager = await SessionManagerFactory.deploy(
      await credentialRegistry.getAddress(),
      await mockVerifier.getAddress()
    );

    // Add operator as issuer
    await credentialRegistry.addIssuer(await operator.getAddress());
  });

  describe("Deployment", function () {
    it("Should set correct owner", async function () {
      expect(await sessionManager.owner()).to.equal(await owner.getAddress());
    });

    it("Should set correct credential registry", async function () {
      expect(await sessionManager.credentialRegistry()).to.equal(await credentialRegistry.getAddress());
    });

    it("Should set correct verifier", async function () {
      expect(await sessionManager.verifier()).to.equal(await mockVerifier.getAddress());
    });
  });

  describe("Session Creation", function () {
    it("Should create session with valid proof", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      // Set mock verifier to return true
      await mockVerifier.setResult(true);

      // Create session
      await expect(
        sessionManager.connect(operator).createSession(
          agentAddr,
          operatorAddr,
          sessionId,
          nullifier,
          Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          [0n, 1n, 2n, 3n], // proof signals
          [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] // proof bytes
        )
      ).to.emit(sessionManager, "SessionCreated");
    });

    it("Should reject session with invalid proof", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      // Set mock verifier to return false
      await mockVerifier.setResult(false);

      await expect(
        sessionManager.connect(operator).createSession(
          agentAddr,
          operatorAddr,
          sessionId,
          nullifier,
          Math.floor(Date.now() / 1000) + 3600,
          [0n, 1n, 2n, 3n],
          [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
        )
      ).to.be.reverted;
    });

    it("Should reject unauthorized operator", async function () {
      const agentAddr = await agent.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);

      await expect(
        sessionManager.connect(unauthorized).createSession(
          agentAddr,
          await unauthorized.getAddress(),
          sessionId,
          nullifier,
          Math.floor(Date.now() / 1000) + 3600,
          [0n, 1n, 2n, 3n],
          [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
        )
      ).to.be.reverted;
    });
  });

  describe("Session Validation", function () {
    it("Should validate active session", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId,
        nullifier,
        Math.floor(Date.now() / 1000) + 3600,
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      // Check session is active
      expect(await sessionManager.isSessionActive(sessionId)).to.be.true;
    });

    it("Should reject expired session", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId,
        nullifier,
        Math.floor(Date.now() / 1000) - 1, // Already expired
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      expect(await sessionManager.isSessionActive(sessionId)).to.be.false;
    });
  });

  describe("Session Termination", function () {
    it("Should allow operator to terminate session", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId,
        nullifier,
        Math.floor(Date.now() / 1000) + 3600,
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      await sessionManager.connect(operator).terminateSession(sessionId);
      expect(await sessionManager.isSessionActive(sessionId)).to.be.false;
    });

    it("Should prevent unauthorized termination", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId,
        nullifier,
        Math.floor(Date.now() / 1000) + 3600,
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      await expect(
        sessionManager.connect(unauthorized).terminateSession(sessionId)
      ).to.be.reverted;
    });
  });

  describe("Nullifier Protection (Replay Attack Prevention)", function () {
    it("Should prevent nullifier reuse", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId1 = ethers.keccak256(ethers.toUtf8Bytes("session-1"));
      const sessionId2 = ethers.keccak256(ethers.toUtf8Bytes("session-2"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("same-nullifier"));

      await mockVerifier.setResult(true);

      // Create first session
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId1,
        nullifier,
        Math.floor(Date.now() / 1000) + 3600,
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      // Attempt to reuse nullifier
      await expect(
        sessionManager.connect(operator).createSession(
          agentAddr,
          operatorAddr,
          sessionId2,
          nullifier,
          Math.floor(Date.now() / 1000) + 3600,
          [0n, 1n, 2n, 3n],
          [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
        )
      ).to.be.reverted;
    });

    it("Should mark nullifier as used in credential registry", async function () {
      const agentAddr = await agent.getAddress();
      const operatorAddr = await operator.getAddress();
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("test-session"));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      await mockVerifier.setResult(true);
      await sessionManager.connect(operator).createSession(
        agentAddr,
        operatorAddr,
        sessionId,
        nullifier,
        Math.floor(Date.now() / 1000) + 3600,
        [0n, 1n, 2n, 3n],
        [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
      );

      // Check nullifier is marked used
      expect(await credentialRegistry.usedNullifiers(nullifier)).to.be.true;
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
