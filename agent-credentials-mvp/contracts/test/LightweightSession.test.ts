import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SessionManager, AgentWallet, AgentWalletFactory, MockVerifier, CredentialRegistry } from "../typechain-types";

describe("LightweightSession", function () {
  let sessionManager: SessionManager;
  let wallet: AgentWallet;
  let factory: AgentWalletFactory;
  let mockVerifier: MockVerifier;
  let credentialRegistry: CredentialRegistry;
  let owner: SignerWithAddress;
  let sessionKeySigner: SignerWithAddress;
  let other: SignerWithAddress;

  const DAILY_SPEND_LIMIT = ethers.parseEther("1.0");
  const DAILY_TX_LIMIT = 10n;
  const EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

  // Helper to create session
  async function createSession(sessionId: string, walletOwner: SignerWithAddress, sessionKeyAddr: string, spendLimit: bigint = DAILY_SPEND_LIMIT, txLimit: bigint = DAILY_TX_LIMIT, expiry: number = EXPIRY) {
    const sessionIdBytes32 = ethers.id(sessionId);

    // Create message hash
    const messageHash = ethers.solidityPackedKeccak256(
      ["bytes32", "address", "uint256", "uint256", "uint64"],
      [sessionIdBytes32, sessionKeyAddr, spendLimit, txLimit, expiry]
    );

    // Sign with wallet owner's EIP-191
    const signature = await walletOwner.signMessage(ethers.getBytes(messageHash));

    // Impersonate wallet contract (msg.sender must be wallet)
    const walletAddress = await wallet.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
    const walletSigner = await ethers.getSigner(walletAddress);

    // Call createLightweightSession
    await sessionManager.connect(walletSigner).createLightweightSession(
      sessionIdBytes32,
      sessionKeyAddr,
      spendLimit,
      txLimit,
      expiry,
      signature
    );

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);

    return sessionIdBytes32;
  }

  beforeEach(async function () {
    [owner, sessionKeySigner, other] = await ethers.getSigners();
    const entryPointAddress = ethers.Wallet.createRandom().address;

    // Deploy mocks
    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const CredentialRegistryFactory = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistryFactory.deploy();

    // Deploy SessionManager
    const SessionManagerFactory = await ethers.getContractFactory("SessionManager");
    sessionManager = await SessionManagerFactory.deploy(
      await mockVerifier.getAddress(),
      await credentialRegistry.getAddress()
    );

    // Deploy AgentWallet implementation
    const AgentWalletFactory = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await AgentWalletFactory.deploy();

    // Deploy AgentWalletFactory
    const FactoryFactory = await ethers.getContractFactory("AgentWalletFactory");
    factory = await FactoryFactory.deploy(
      await walletImpl.getAddress(),
      await sessionManager.getAddress(),
      entryPointAddress
    );

    // Create wallet with owner as owner
    const tx = await factory.connect(owner).createWallet(await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return factory.interface.parseLog(log as any)?.name === "WalletCreated";
      } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress) as AgentWallet;

    // Fund wallet
    await owner.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("10.0") });
  });

  describe("createLightweightSession", function () {
    it("should create session with valid owner signature", async function () {
      const sessionId = ethers.id("test-session-1");
      const sessionKey = await sessionKeySigner.getAddress();

      // Get wallet owner (set when wallet was created)
      const walletOwner = await wallet.owner();

      // Create message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "uint256", "uint64"],
        [sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, EXPIRY]
      );

      // Sign with wallet's actual owner (should be 'owner' signer)
      const signingAddress = (await owner.getAddress()).toLowerCase();
      const actualOwner = walletOwner.toLowerCase();

      // Check owner matches
      expect(signingAddress).to.equal(actualOwner, "Wallet owner should match signer");

      // Sign with EIP-191
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      // Impersonate wallet contract
      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager.connect(walletSigner).createLightweightSession(
        sessionId,
        sessionKey,
        DAILY_SPEND_LIMIT,
        DAILY_TX_LIMIT,
        EXPIRY,
        signature
      );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);

      // Verify session created
      const session = await sessionManager.getLightSession(sessionId);
      expect(session.sessionKey).to.equal(sessionKey);
      expect(session.dailySpendLimit).to.equal(DAILY_SPEND_LIMIT);
      expect(session.dailyTxLimit).to.equal(DAILY_TX_LIMIT);
      expect(session.revoked).to.be.false;
    });

    it("should reject session with invalid signature", async function () {
      const sessionId = ethers.id("test-session-2");
      const sessionKey = await sessionKeySigner.getAddress();

      // Sign with wrong signer
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "uint256", "uint64"],
        [sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, EXPIRY]
      );

      const signature = await other.signMessage(ethers.getBytes(messageHash));

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await expect(
        sessionManager.connect(walletSigner).createLightweightSession(
          sessionId,
          sessionKey,
          DAILY_SPEND_LIMIT,
          DAILY_TX_LIMIT,
          EXPIRY,
          signature
        )
      ).to.be.revertedWith("Not wallet owner");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });

    it("should reject duplicate session", async function () {
      const sessionId = ethers.id("test-session-3");
      const sessionKey = await sessionKeySigner.getAddress();

      // Create first session
      await createSession("test-session-3", owner, sessionKey);

      // Try to create duplicate
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "uint256", "uint64"],
        [sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, EXPIRY]
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await expect(
        sessionManager.connect(walletSigner).createLightweightSession(
          sessionId,
          sessionKey,
          DAILY_SPEND_LIMIT,
          DAILY_TX_LIMIT,
          EXPIRY,
          signature
        )
      ).to.be.revertedWith("Session exists");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("validateLightweightSession", function () {
    it("should validate valid session", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-4", owner, sessionKey);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Validate
      const value = ethers.parseEther("0.1");
      const valid = await sessionManager.connect(walletSigner).validateLightweightSession.staticCall(
        sessionId,
        sessionKey,
        value
      );
      expect(valid).to.be.true;

      // Execute validation
      await sessionManager.connect(walletSigner).validateLightweightSession(sessionId, sessionKey, value);

      // Check usage
      const session = await sessionManager.getLightSession(sessionId);
      expect(session.dailySpendUsed).to.equal(value);
      expect(session.dailyTxUsed).to.equal(1n);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });

    it("should reject when daily spend limit exceeded", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const lowLimit = ethers.parseEther("0.5");
      const sessionId = await createSession("test-session-5", owner, sessionKey, lowLimit);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Use some credit
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId,
        sessionKey,
        ethers.parseEther("0.3")
      );

      // Try to exceed
      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId,
          sessionKey,
          ethers.parseEther("0.3")
        )
      ).to.be.revertedWith("Daily spend limit exceeded");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });

    it("should reject when daily tx limit exceeded", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const lowTxLimit = 2n;
      const sessionId = await createSession("test-session-6", owner, sessionKey, DAILY_SPEND_LIMIT, lowTxLimit);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Use tx limit
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId,
        sessionKey,
        ethers.parseEther("0.1")
      );
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId,
        sessionKey,
        ethers.parseEther("0.1")
      );

      // Third tx should fail
      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId,
          sessionKey,
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("Daily tx limit exceeded");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("revokeLightweightSession", function () {
    it("should revoke session", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-7", owner, sessionKey);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Revoke
      await sessionManager.connect(walletSigner).revokeLightweightSession(sessionId);

      // Check revoked
      const session = await sessionManager.getLightSession(sessionId);
      expect(session.revoked).to.be.true;

      // Validation should fail
      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId,
          sessionKey,
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("Session revoked");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("dailyReset", function () {
    it("should reset daily limits after day boundary", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-8", owner, sessionKey);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Use credit
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId,
        sessionKey,
        ethers.parseEther("0.5")
      );

      // Warp to next day
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      // Should be able to use full limit again
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId,
        sessionKey,
        ethers.parseEther("0.9")
      );

      // Check usage reset
      const session = await sessionManager.getLightSession(sessionId);
      expect(session.dailySpendUsed).to.equal(ethers.parseEther("0.9"));
      expect(session.dailyTxUsed).to.equal(1n);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("sessionExpiry", function () {
    it("should reject expired session", async function () {
      const shortExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-9", owner, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, shortExpiry);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      // Warp past expiry
      await ethers.provider.send("evm_increaseTime", [7200]); // 2 hours
      await ethers.provider.send("evm_mine", []);

      // Should fail
      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId,
          sessionKey,
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("Session expired");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("getWalletSessions", function () {
    it("should return all sessions for a wallet", async function () {
      const sessionKey = await sessionKeySigner.getAddress();

      // Create multiple sessions
      const sessionIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const sid = await createSession(`test-session-${i + 10}`, owner, sessionKey);
        sessionIds.push(sid);
      }

      // Get sessions
      const sessions = await sessionManager.getWalletSessions(await wallet.getAddress());
      expect(sessions.length).to.equal(3);
    });
  });
});
