import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { AgentWallet, AgentWalletFactory, SessionManager, MockVerifier, CredentialRegistry } from "../typechain-types";

describe("AgentWallet", function () {
  let wallet: AgentWallet;
  let walletImpl: AgentWallet;
  let factory: AgentWalletFactory;
  let sessionManager: SessionManager;
  let mockVerifier: MockVerifier;
  let credentialRegistry: CredentialRegistry;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, sessionKey, attacker, mockEntryPoint] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const CredentialRegistryFactory = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await CredentialRegistryFactory.deploy();

    const SessionManagerFactory = await ethers.getContractFactory("SessionManager");
    sessionManager = await SessionManagerFactory.deploy(
      await mockVerifier.getAddress(),
      await credentialRegistry.getAddress()
    );

    const AgentWalletFactory = await ethers.getContractFactory("AgentWallet");
    walletImpl = await AgentWalletFactory.deploy();

    const FactoryFactory = await ethers.getContractFactory("AgentWalletFactory");
    factory = await FactoryFactory.deploy(
      await walletImpl.getAddress(),
      await sessionManager.getAddress(),
      await mockEntryPoint.getAddress()
    );

    const tx = await factory.connect(owner).createWallet(await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; }
      catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress) as AgentWallet;
  });

  describe("Initialization", function () {
    it("Should prevent re-initialization", async function () {
      await expect(
        wallet.initialize(
          await attacker.getAddress(),
          await sessionManager.getAddress(),
          await mockEntryPoint.getAddress()
        )
      ).to.be.revertedWith("Already initialized");
    });

    it("Should reject zero-address owner", async function () {
      await expect(
        factory.connect(owner).createWallet(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid owner");
    });
  });

  describe("Owner Management", function () {
    it("Should allow owner to change owner", async function () {
      await wallet.connect(owner).changeOwner(await attacker.getAddress());
      expect(await wallet.owner()).to.equal(await attacker.getAddress());
    });

    it("Should prevent non-owner from changing owner", async function () {
      await expect(
        wallet.connect(attacker).changeOwner(await attacker.getAddress())
      ).to.be.revertedWith("Not owner");
    });

    it("Should reject zero-address new owner", async function () {
      await expect(
        wallet.connect(owner).changeOwner(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid owner");
    });
  });

  describe("Whitelist Management", function () {
    it("Should allow owner to whitelist an address", async function () {
      await wallet.connect(owner).setWhiteListedParty(await attacker.getAddress(), true);
      expect(await wallet.whiteListedParties(await attacker.getAddress())).to.be.true;
    });

    it("Should allow owner to batch whitelist", async function () {
      const addrs = [await attacker.getAddress(), await sessionKey.getAddress()];
      const statuses = [true, true];
      await wallet.connect(owner).setWhiteListedPartyBatch(addrs, statuses);
      expect(await wallet.whiteListedParties(addrs[0])).to.be.true;
      expect(await wallet.whiteListedParties(addrs[1])).to.be.true;
    });

    it("Should reject batch with mismatched arrays", async function () {
      await expect(
        wallet.connect(owner).setWhiteListedPartyBatch(
          [await attacker.getAddress()],
          [true, false]
        )
      ).to.be.revertedWith("Array length mismatch");
    });

    it("Should prevent non-owner from whitelisting", async function () {
      await expect(
        wallet.connect(attacker).setWhiteListedParty(await attacker.getAddress(), true)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Pause / Unpause", function () {
    it("Should allow owner to execute without pausing (pause removed)", async function () {
      const target = await attacker.getAddress();
      await wallet.connect(owner).setWhiteListedParty(target, true);
      await expect(
        wallet.connect(owner).execute(target, 0, "0x")
      ).to.emit(wallet, "ExecutionPerformed");
    });
  });

  describe("Execution", function () {
    it("Should allow owner to execute on whitelisted target", async function () {
      const target = await attacker.getAddress();
      await wallet.connect(owner).setWhiteListedParty(target, true);
      await expect(
        wallet.connect(owner).execute(target, 0, "0x")
      ).to.emit(wallet, "ExecutionPerformed");
    });

    it("Should reject execute on non-whitelisted target", async function () {
      await expect(
        wallet.connect(owner).execute(await attacker.getAddress(), 0, "0x")
      ).to.be.revertedWith("Not white listed");
    });

    it("Should allow batch execution on whitelisted targets", async function () {
      const targets = [await attacker.getAddress(), await sessionKey.getAddress()];
      await wallet.connect(owner).setWhiteListedPartyBatch(targets, [true, true]);
      await expect(
        wallet.connect(owner).executeBatch(targets, [0, 0], ["0x", "0x"])
      ).to.emit(wallet, "BatchExecutionPerformed");
    });
  });

  describe("Deposit / Withdraw", function () {
    it("Should accept deposits", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await wallet.getAddress(),
        value: depositAmount
      });
      const balance = await wallet.checkBalance();
      expect(balance).to.equal(depositAmount);
    });

    it("Should prevent non-owner from withdrawing", async function () {
      await expect(
        wallet.connect(attacker).withdrawDepositTo(await attacker.getAddress(), 0)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Constructor Self-Destruct Protection", function () {
    it("Should mark implementation as initialized", async function () {
      await expect(
        walletImpl.initialize(
          await attacker.getAddress(),
          await sessionManager.getAddress(),
          await mockEntryPoint.getAddress()
        )
      ).to.be.revertedWith("Already initialized");
    });
  });
});
