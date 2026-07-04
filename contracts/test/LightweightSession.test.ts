import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LightweightSession", function () {
  let sessionManager: any;
  let wallet: any;
  let factory: any;
  let mockVerifier: any;
  let credentialRegistry: any;
  let owner: SignerWithAddress;
  let sessionKeySigner: SignerWithAddress;
  let other: SignerWithAddress;

  const DAILY_SPEND_LIMIT = ethers.parseEther("1.0");
  const DAILY_TX_LIMIT = 10n;

  async function getExpiry(daysAhead = 30): Promise<bigint> {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block!.timestamp) + BigInt(daysAhead * 24 * 60 * 60);
  }

  async function createSession(sessionId: string, walletOwner: SignerWithAddress, sessionKeyAddr: string, spendLimit: bigint = DAILY_SPEND_LIMIT, txLimit: bigint = DAILY_TX_LIMIT, expiry?: bigint) {
    if (!expiry) expiry = await getExpiry();
    const sessionIdBytes32 = ethers.id(sessionId);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const smAddr = await sessionManager.getAddress();
    const walletAddr = await wallet.getAddress();

    const messageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256"],
        [chainId, smAddr, walletAddr, sessionIdBytes32, sessionKeyAddr, spendLimit, txLimit, expiry]
      )
    );

    const signature = await walletOwner.signMessage(ethers.getBytes(messageHash));

    await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
    const walletSigner = await ethers.getSigner(walletAddr);

    await sessionManager.connect(walletSigner).createLightweightSession(
      sessionIdBytes32,
      sessionKeyAddr,
      spendLimit,
      txLimit,
      expiry,
      signature
    );

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);

    return sessionIdBytes32;
  }

  beforeEach(async function () {
    [owner, sessionKeySigner, other] = await ethers.getSigners();
    const entryPointAddress = ethers.Wallet.createRandom().address;

    // Deploy MockVerifier
    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    // Deploy CredentialRegistry (UUPS)
    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());

    // Deploy AgentWallet implementation
    const AgentWalletFactory = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await AgentWalletFactory.deploy();

    const placeholderAddr = "0x0000000000000000000000000000000000000001";

    // Deploy SessionManager (UUPS)
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

    // Deploy AgentWalletFactory (UUPS)
    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImplContract = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImplContract.getAddress(),
      factoryImplContract.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        entryPointAddress
      ])
    );
    factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());

    // Activate factory via timelock
    await sessionManager.proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.acceptWalletFactory();

    // Create wallet
    const tx = await factory.connect(owner).createWallet(await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return factory.interface.parseLog(log as any)?.name === "WalletCreated";
      } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);

    // Fund wallet
    await owner.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("10.0") });
  });

  describe("createLightweightSession", function () {
    it("should create session with valid owner signature", async function () {
      const sessionId = ethers.id("test-session-1");
      const sessionKey = await sessionKeySigner.getAddress();
      const expiry = await getExpiry();

      const walletOwner = await wallet.owner();

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const smAddr = await sessionManager.getAddress();
      const walletAddress = await wallet.getAddress();

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256"],
          [chainId, smAddr, walletAddress, sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, expiry]
        )
      );

      const signingAddress = (await owner.getAddress()).toLowerCase();
      const actualOwner = walletOwner.toLowerCase();

      expect(signingAddress).to.equal(actualOwner, "Wallet owner should match signer");

      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager.connect(walletSigner).createLightweightSession(
        sessionId,
        sessionKey,
        DAILY_SPEND_LIMIT,
        DAILY_TX_LIMIT,
        expiry,
        signature
      );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.sessionKey).to.equal(sessionKey);
      expect(session.dailySpendLimit).to.equal(DAILY_SPEND_LIMIT);
      expect(session.dailyTxLimit).to.equal(DAILY_TX_LIMIT);
      expect(session.revoked).to.be.false;
    });

    it("should reject session with invalid signature", async function () {
      const sessionId = ethers.id("test-session-2");
      const sessionKey = await sessionKeySigner.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const smAddr = await sessionManager.getAddress();
      const walletAddress = await wallet.getAddress();

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256"],
          [chainId, smAddr, walletAddress, sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, EXPIRY]
        )
      );

      const signature = await other.signMessage(ethers.getBytes(messageHash));

      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await expect(
        sessionManager.connect(walletSigner).createLightweightSession(
          sessionId,
          sessionKey,
          DAILY_SPEND_LIMIT,
          DAILY_TX_LIMIT,
          expiry,
          signature
        )
      ).to.be.revertedWithCustomError(sessionManager, "NotWalletOwner");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });

    it("should reject duplicate session", async function () {
      const sessionId = ethers.id("test-session-3");
      const sessionKey = await sessionKeySigner.getAddress();

      await createSession("test-session-3", owner, sessionKey);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const smAddr = await sessionManager.getAddress();
      const walletAddress = await wallet.getAddress();

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256"],
          [chainId, smAddr, walletAddress, sessionId, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, EXPIRY]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await expect(
        sessionManager.connect(walletSigner).createLightweightSession(
          sessionId,
          sessionKey,
          DAILY_SPEND_LIMIT,
          DAILY_TX_LIMIT,
          expiry,
          signature
        )
      ).to.be.revertedWithCustomError(sessionManager, "SessionAlreadyExists");

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

      const value = ethers.parseEther("0.1");
      const valid = await sessionManager.connect(walletSigner).validateLightweightSession.staticCall(
        sessionId, sessionKey, value
      );
      expect(valid).to.be.true;

      await sessionManager.connect(walletSigner).validateLightweightSession(sessionId, sessionKey, value);

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

      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId, sessionKey, ethers.parseEther("0.3")
      );

      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId, sessionKey, ethers.parseEther("0.3")
        )
      ).to.be.revertedWithCustomError(sessionManager, "DailySpendLimitExceeded");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });

    it("should reject when daily tx limit exceeded", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const lowTxLimit = 2n;
      const sessionId = await createSession("test-session-6", owner, sessionKey, DAILY_SPEND_LIMIT, lowTxLimit);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId, sessionKey, ethers.parseEther("0.1")
      );
      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId, sessionKey, ethers.parseEther("0.1")
      );

      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId, sessionKey, ethers.parseEther("0.1")
        )
      ).to.be.revertedWithCustomError(sessionManager, "DailyTxLimitExceeded");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("revokeLightweightSession", function () {
    it("should revoke session", async function () {
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-7", owner, sessionKey);

      await sessionManager.connect(sessionKeySigner).revokeLightweightSession(sessionId, await wallet.getAddress());

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.revoked).to.be.true;

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);
      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(sessionId, sessionKey, ethers.parseEther("0.1"))
      ).to.be.revertedWithCustomError(sessionManager, "SessionIsRevoked");
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

      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId, sessionKey, ethers.parseEther("0.5")
      );

      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await sessionManager.connect(walletSigner).validateLightweightSession(
        sessionId, sessionKey, ethers.parseEther("0.9")
      );

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.dailySpendUsed).to.equal(ethers.parseEther("0.9"));
      expect(session.dailyTxUsed).to.equal(1n);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("sessionExpiry", function () {
    it("should reject expired session", async function () {
      const shortExpiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
      const sessionKey = await sessionKeySigner.getAddress();
      const sessionId = await createSession("test-session-9", owner, sessionKey, DAILY_SPEND_LIMIT, DAILY_TX_LIMIT, shortExpiry);

      const walletAddress = await wallet.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await ethers.provider.send("evm_increaseTime", [7200]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        sessionManager.connect(walletSigner).validateLightweightSession(
          sessionId, sessionKey, ethers.parseEther("0.1")
        )
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  describe("getWalletSessions", function () {
    it("should return all sessions for a wallet", async function () {
      const sessionKey = await sessionKeySigner.getAddress();

      const sessionIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const sid = await createSession(`test-session-${i + 10}`, owner, sessionKey);
        sessionIds.push(sid);
      }

      const sessions = await sessionManager.getWalletSessions(await wallet.getAddress());
      expect(sessions.length).to.equal(3);
    });
  });
});
