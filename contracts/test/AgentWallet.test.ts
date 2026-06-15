import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentWallet", function () {
  let wallet: any;
  let walletImpl: any;
  let factory: any;
  let sessionManager: any;
  let mockVerifier: any;
  let credentialRegistry: any;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, sessionKey, attacker, mockEntryPoint] = await ethers.getSigners();

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

    // Deploy AgentWallet implementation (non-upgradeable clone source)
    const AgentWalletFactory = await ethers.getContractFactory("AgentWallet");
    walletImpl = await AgentWalletFactory.deploy();

    // Deploy AgentWalletFactory (UUPS)
    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImplContract = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImplContract.getAddress(),
      factoryImplContract.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        await mockEntryPoint.getAddress()
      ])
    );
    factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());

    const tx = await factory.connect(owner).createWallet(await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; }
      catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  describe("Initialization", function () {
    it("Should prevent re-initialization", async function () {
      await expect(
        wallet.initialize(
          await attacker.getAddress(),
          await sessionManager.getAddress(),
          await mockEntryPoint.getAddress()
        )
      ).to.be.revertedWithCustomError(wallet, "AlreadyInitializedError");
    });

    it("Should reject zero-address owner", async function () {
      await expect(
        factory.connect(owner).createWallet(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidOwnerError");
    });
  });

  describe("Owner Management", function () {
    it("Should allow owner to initiate ownership transfer", async function () {
      await wallet.connect(owner).changeOwner(await attacker.getAddress());
      expect(await wallet.pendingOwner()).to.equal(await attacker.getAddress());
    });

    it("Should allow pending owner to accept ownership", async function () {
      await wallet.connect(owner).changeOwner(await attacker.getAddress());
      await wallet.connect(attacker).acceptOwnership();
      expect(await wallet.owner()).to.equal(await attacker.getAddress());
    });

    it("Should prevent non-owner from initiating ownership transfer", async function () {
      await expect(
        wallet.connect(attacker).changeOwner(await attacker.getAddress())
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });

    it("Should prevent non-pending-owner from accepting ownership", async function () {
      await wallet.connect(owner).changeOwner(await attacker.getAddress());
      await expect(
        wallet.connect(sessionKey).acceptOwnership()
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });

    it("Should reject zero-address new owner", async function () {
      await expect(
        wallet.connect(owner).changeOwner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidOwnerError");
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
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });

    it("Should prevent non-owner from whitelisting", async function () {
      await expect(
        wallet.connect(attacker).setWhiteListedParty(await attacker.getAddress(), true)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
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
      ).to.be.revertedWithCustomError(wallet, "NotWhiteListedError");
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
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
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
      ).to.be.revertedWithCustomError(walletImpl, "AlreadyInitializedError");
    });
  });
});
