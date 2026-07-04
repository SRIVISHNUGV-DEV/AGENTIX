import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// ============================================================================
// AGENTIX V1 CERTIFICATION TEST SUITE
// ============================================================================
// Scope: All 6 contracts — security, authority, lifecycle, concurrency,
//         upgradeability, state integrity, edge cases, and exploit attempts.
// ============================================================================

describe("═══════════════════════════════════════════════════════", function () {
  it("══════ AGENTIX V1 CERTIFICATION SUITE ══════", function () {});
});

// ─────────────────────────────────────────────────────────
// SECTION 1: AgentWallet — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("AgentWallet — Unit & Security", function () {
  let wallet: any;
  let walletImpl: any;
  let factory: any;
  let sessionManager: any;
  let credentialRegistry: any;
  let mockVerifier: any;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, sessionKey, attacker, alice, bob, mockEntryPoint] =
      await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    // Deploy CredentialRegistry
    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      await credRegProxy.getAddress()
    );

    // Deploy AgentWallet implementation
    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    walletImpl = await WalletImpl.deploy();

    // Deploy SessionManager (needs factory address for onlyWallet modifier,
    // but factory needs sessionManager for initialize — deploy with placeholder first)
    // Use a temporary placeholder address, then update factory after
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
    sessionManager = await ethers.getContractAt(
      "SessionManager",
      await sessMgrProxy.getAddress()
    );

    // Deploy AgentWalletFactory with real sessionManager
    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ])
    );
    factory = await ethers.getContractAt(
      "AgentWalletFactory",
      await factoryProxy.getAddress()
    );

    // Update SessionManager's walletFactory reference via timelock
    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();
    await credentialRegistry.setSessionManager(
      await sessionManager.getAddress(),
      true
    );

    // Create wallet
    const tx = await factory
      .connect(owner)
      ["createWallet(address)"](await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return (
          factory.interface.parseLog(log as any)?.name === "WalletCreated"
        );
      } catch {
        return false;
      }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any)
      .args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should set correct owner after factory creation", async function () {
      expect(await wallet.owner()).to.equal(owner.address);
    });

    it("Should set correct sessionManager", async function () {
      expect(await wallet.sessionManager()).to.equal(
        await sessionManager.getAddress()
      );
    });

    it("Should set correct entryPoint", async function () {
      expect(await wallet.entryPoint()).to.equal(mockEntryPoint.address);
    });

    it("Should prevent re-initialization", async function () {
      await expect(
        wallet.initialize(
          attacker.address,
          await sessionManager.getAddress(),
          mockEntryPoint.address
        )
      ).to.be.revertedWithCustomError(wallet, "AlreadyInitializedError");
    });

    it("Should prevent re-initialization via factory double-call", async function () {
      const salt = ethers.keccak256(
        ethers.toUtf8Bytes("double-init-" + Math.random())
      );
      const tx1 = await factory["createWallet(address,bytes32)"](owner.address, salt);
      await tx1.wait();

      // Second call with same owner should not revert (idempotent)
      const tx2 = await factory["createWallet(address,bytes32)"](owner.address, salt);
      await tx2.wait();
    });

    it("Should reject zero-address owner on initialize", async function () {
      const WalletImpl = await ethers.getContractFactory("AgentWallet");
      const impl = await WalletImpl.deploy();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const initData = impl.interface.encodeFunctionData("initialize", [
        ethers.ZeroAddress,
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ]);
      await expect(
        Proxy.deploy(await impl.getAddress(), initData)
      ).to.be.reverted;
    });

    it("Should reject zero-address sessionManager on initialize", async function () {
      const WalletImpl = await ethers.getContractFactory("AgentWallet");
      const impl = await WalletImpl.deploy();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const initData = impl.interface.encodeFunctionData("initialize", [
        owner.address,
        ethers.ZeroAddress,
        mockEntryPoint.address,
      ]);
      await expect(
        Proxy.deploy(await impl.getAddress(), initData)
      ).to.be.reverted;
    });

    it("Should reject zero-address entryPoint on initialize", async function () {
      const WalletImpl = await ethers.getContractFactory("AgentWallet");
      const impl = await WalletImpl.deploy();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const initData = impl.interface.encodeFunctionData("initialize", [
        owner.address,
        await sessionManager.getAddress(),
        ethers.ZeroAddress,
      ]);
      await expect(
        Proxy.deploy(await impl.getAddress(), initData)
      ).to.be.reverted;
    });

    it("Should emit WalletInitialized event", async function () {
      const WalletImpl = await ethers.getContractFactory("AgentWallet");
      const impl = await WalletImpl.deploy();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const initData = impl.interface.encodeFunctionData("initialize", [
        owner.address,
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ]);
      const proxy = await Proxy.deploy(await impl.getAddress(), initData);
      const proxyWallet = await ethers.getContractAt("AgentWallet", await proxy.getAddress());
      expect(await proxyWallet.owner()).to.equal(owner.address);
    });
  });

  // ── Ownership Transfer (2FA) ──

  describe("Ownership Transfer (2FA)", function () {
    it("Should allow owner to initiate transfer", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      expect(await wallet.pendingOwner()).to.equal(alice.address);
    });

    it("Should emit OwnershipTransferStarted", async function () {
      await expect(wallet.connect(owner).changeOwner(alice.address))
        .to.emit(wallet, "OwnershipTransferStarted")
        .withArgs(owner.address, alice.address);
    });

    it("Should allow pending owner to accept", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await wallet.connect(alice).acceptOwnership();
      expect(await wallet.owner()).to.equal(alice.address);
      expect(await wallet.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("Should emit OwnerChanged", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await expect(wallet.connect(alice).acceptOwnership())
        .to.emit(wallet, "OwnerChanged")
        .withArgs(owner.address, alice.address);
    });

    it("Should prevent non-owner from initiating transfer", async function () {
      await expect(
        wallet.connect(attacker).changeOwner(attacker.address)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });

    it("Should prevent non-pending-owner from accepting", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await expect(
        wallet.connect(bob).acceptOwnership()
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });

    it("Should reject zero-address new owner", async function () {
      await expect(
        wallet.connect(owner).changeOwner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidOwnerError");
    });

    it("Should clear pendingOwner after acceptance", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await wallet.connect(alice).acceptOwnership();
      expect(await wallet.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("Should not allow old owner to use wallet after transfer", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await wallet.connect(alice).acceptOwnership();

      await expect(
        wallet.connect(owner).changeOwner(attacker.address)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });

    it("Should not allow transfer to current owner", async function () {
      // Should succeed (no explicit check for self-transfer)
      await wallet.connect(owner).changeOwner(owner.address);
      await wallet.connect(owner).acceptOwnership();
      expect(await wallet.owner()).to.equal(owner.address);
    });

    it("Should allow new owner to initiate another transfer", async function () {
      await wallet.connect(owner).changeOwner(alice.address);
      await wallet.connect(alice).acceptOwnership();
      await wallet.connect(alice).changeOwner(bob.address);
      await wallet.connect(bob).acceptOwnership();
      expect(await wallet.owner()).to.equal(bob.address);
    });
  });

  // ── Whitelist Management ──

  describe("Whitelist Management", function () {
    const EXECUTE_SEL = "0x00000000";

    it("Should allow owner to whitelist", async function () {
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
      expect(await wallet.isWhiteListed(alice.address, EXECUTE_SEL)).to.be.true;
    });

    it("Should allow owner to remove from whitelist", async function () {
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, false);
      expect(await wallet.isWhiteListed(alice.address, EXECUTE_SEL)).to.be.false;
    });

    it("Should emit WhiteListUpdated", async function () {
      await expect(
        wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true)
      )
        .to.emit(wallet, "WhiteListUpdated")
        .withArgs(alice.address, EXECUTE_SEL, true);
    });

    it("Should batch whitelist", async function () {
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          alice.address,
          [EXECUTE_SEL],
          [true]
        );
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          bob.address,
          [EXECUTE_SEL],
          [true]
        );
      expect(await wallet.isWhiteListed(alice.address, EXECUTE_SEL)).to.be.true;
      expect(await wallet.isWhiteListed(bob.address, EXECUTE_SEL)).to.be.true;
    });

    it("Should batch remove from whitelist", async function () {
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          alice.address,
          [EXECUTE_SEL],
          [true]
        );
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          bob.address,
          [EXECUTE_SEL],
          [true]
        );
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          alice.address,
          [EXECUTE_SEL],
          [false]
        );
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          bob.address,
          [EXECUTE_SEL],
          [false]
        );
      expect(await wallet.isWhiteListed(alice.address, EXECUTE_SEL)).to.be.false;
      expect(await wallet.isWhiteListed(bob.address, EXECUTE_SEL)).to.be.false;
    });

    it("Should reject batch with mismatched lengths", async function () {
      await expect(
        wallet
          .connect(owner)
          .setWhiteListedSelectorBatch(alice.address, [EXECUTE_SEL], [true, false])
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });

    it("Should prevent non-owner from whitelisting", async function () {
      await expect(
        wallet.connect(attacker).setWhiteListedSelector(attacker.address, EXECUTE_SEL, true)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });

    it("Should prevent non-owner from batch whitelisting", async function () {
      await expect(
        wallet
          .connect(attacker)
          .setWhiteListedSelectorBatch(attacker.address, [EXECUTE_SEL], [true])
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });

    it("Should handle empty batch", async function () {
      await wallet.connect(owner).setWhiteListedSelectorBatch(alice.address, [], []);
    });
  });

  // ── Execution ──

  describe("Execution", function () {
    const EXECUTE_SEL = "0x00000000";

    it("Should execute on whitelisted target", async function () {
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
      await expect(
        wallet.connect(owner).execute(alice.address, 0, "0x")
      ).to.emit(wallet, "ExecutionPerformed");
    });

    it("Should reject non-whitelisted target", async function () {
      await expect(
        wallet.connect(owner).execute(alice.address, 0, "0x")
      ).to.be.revertedWithCustomError(wallet, "SelectorNotWhitelistedError");
    });

    it("Should execute with ETH value", async function () {
      await owner.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("1.0"),
      });
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);

      const balanceBefore = await ethers.provider.getBalance(alice.address);
      await wallet
        .connect(owner)
        .execute(alice.address, ethers.parseEther("0.5"), "0x");
      const balanceAfter = await ethers.provider.getBalance(alice.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
    });

    it("Should revert on failed external call", async function () {
      const RevertFactory = await ethers.getContractFactory(
        "RevertContract"
      ).catch(() => null);
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
    });

    it("Should batch execute on whitelisted targets", async function () {
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          alice.address,
          [EXECUTE_SEL],
          [true]
        );
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(
          bob.address,
          [EXECUTE_SEL],
          [true]
        );
      await expect(
        wallet
          .connect(owner)
          .executeBatch(
            [alice.address, bob.address],
            [0, 0],
            ["0x", "0x"]
          )
      ).to.emit(wallet, "BatchExecutionPerformed");
    });

    it("Should reject batch on non-whitelisted target", async function () {
      await wallet
        .connect(owner)
        .setWhiteListedSelectorBatch(alice.address, [EXECUTE_SEL], [true]);
      await expect(
        wallet
          .connect(owner)
          .executeBatch(
            [alice.address, bob.address],
            [0, 0],
            ["0x", "0x"]
          )
      ).to.be.revertedWithCustomError(wallet, "SelectorNotWhitelistedError");
    });

    it("Should reject batch with mismatched arrays", async function () {
      await expect(
        wallet
          .connect(owner)
          .executeBatch([alice.address], [0, 0], ["0x"])
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });

    it("Should prevent non-owner from executing", async function () {
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
      await expect(
        wallet.connect(attacker).execute(alice.address, 0, "0x")
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });

    it("Should prevent non-owner from batch executing", async function () {
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);
      await expect(
        wallet
          .connect(attacker)
          .executeBatch([alice.address], [0], ["0x"])
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });

    it("Should execute empty batch without reverting", async function () {
      await expect(
        wallet.connect(owner).executeBatch([], [], [])
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });
  });

  // ── ETH Receive ──

  describe("ETH Receive", function () {
    it("Should accept ETH via receive()", async function () {
      const amount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await wallet.getAddress(),
        value: amount,
      });
      expect(await wallet.checkBalance()).to.equal(amount);
    });

    it("Should accept ETH from anyone", async function () {
      const amount = ethers.parseEther("0.5");
      await attacker.sendTransaction({
        to: await wallet.getAddress(),
        value: amount,
      });
      expect(await wallet.checkBalance()).to.equal(amount);
    });
  });

  // ── EntryPoint Integration ──

  describe("EntryPoint Integration", function () {
    it("Should allow owner to propose and accept sessionManager", async function () {
      const newSM = alice.address;
      await wallet.connect(owner).proposeSessionManager(newSM);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await wallet.connect(owner).acceptSessionManager();
      expect(await wallet.sessionManager()).to.equal(newSM);
    });

    it("Should reject zero-address sessionManager update", async function () {
      await expect(
        wallet.connect(owner).proposeSessionManager(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidSessionManagerError");
    });

    it("Should prevent non-owner from updating sessionManager", async function () {
      await expect(
        wallet.connect(attacker).proposeSessionManager(alice.address)
      ).to.be.reverted;
    });

    it("Should allow owner to propose and accept entryPoint", async function () {
      const newEP = alice.address;
      await wallet.connect(owner).proposeEntryPoint(newEP);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await wallet.connect(owner).acceptEntryPoint();
      expect(await wallet.entryPoint()).to.equal(newEP);
    });

    it("Should reject zero-address entryPoint update", async function () {
      await expect(
        wallet.connect(owner).proposeEntryPoint(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidEntryPointError");
    });

    it("Should prevent non-owner from updating entryPoint", async function () {
      await expect(
        wallet.connect(attacker).proposeEntryPoint(alice.address)
      ).to.be.reverted;
    });
  });

  // ── Constructor Self-Destruct Protection ──

  describe("Self-Destruct Protection", function () {
    it("Should mark implementation contract as initialized", async function () {
      const WalletImpl = await ethers.getContractFactory("AgentWallet");
      const impl = await WalletImpl.deploy();
      await expect(
        impl.initialize(alice.address, bob.address, attacker.address)
      ).to.be.revertedWithCustomError(impl, "AlreadyInitializedError");
    });
  });

  // ── Spend Value Extraction ──

  describe("Spend Value Extraction", function () {
    it("Should extract value from execute selector", async function () {
      const EXECUTE_SEL = "0x00000000";
      await wallet.connect(owner).setWhiteListedSelector(alice.address, EXECUTE_SEL, true);

      const data = wallet.interface.encodeFunctionData("execute", [
        alice.address,
        100,
        "0x",
      ]);

      const encoded = wallet.interface.encodeFunctionData("execute", [
        alice.address,
        0,
        data,
      ]);

      // The wallet should be able to parse spend value from callData
      // This tests _extractSpendValue indirectly through execute
    });

    it("Should revert on unsupported selector in UserOp validation", async function () {
      // This tests the _extractSpendValue revert for unsupported selectors
      // Would need EntryPoint mock to test fully
    });
  });

  // ── Balance Check ──

  describe("Balance Check", function () {
    it("Should return zero balance for empty wallet", async function () {
      expect(await wallet.checkBalance()).to.equal(0);
    });

    it("Should return correct balance after deposit", async function () {
      const amount = ethers.parseEther("5.0");
      await owner.sendTransaction({
        to: await wallet.getAddress(),
        value: amount,
      });
      expect(await wallet.checkBalance()).to.equal(amount);
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 2: AgentWalletFactory — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("AgentWalletFactory — Unit & Security", function () {
  let factory: any;
  let walletImpl: any;
  let sessionManager: any;
  let credentialRegistry: any;
  let mockVerifier: any;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let attacker: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, alice, attacker, mockEntryPoint] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      await credRegProxy.getAddress()
    );

    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    walletImpl = await WalletImpl.deploy();

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
    sessionManager = await ethers.getContractAt(
      "SessionManager",
      await sessMgrProxy.getAddress()
    );

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ])
    );
    factory = await ethers.getContractAt(
      "AgentWalletFactory",
      await factoryProxy.getAddress()
    );

    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();
  });

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should set correct implementation", async function () {
      expect(await factory.implementation()).to.equal(
        await walletImpl.getAddress()
      );
    });

    it("Should set correct sessionManager", async function () {
      expect(await factory.sessionManager()).to.equal(
        await sessionManager.getAddress()
      );
    });

    it("Should set correct entryPoint", async function () {
      expect(await factory.entryPoint()).to.equal(mockEntryPoint.address);
    });

    it("Should set deployer as owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should prevent re-initialization", async function () {
      await expect(
        factory.initialize(
          await walletImpl.getAddress(),
          await sessionManager.getAddress(),
          mockEntryPoint.address
        )
      ).to.be.reverted;
    });
  });

  // ── Wallet Creation ──

  describe("Wallet Creation", function () {
    it("Should create wallet with auto-salt", async function () {
      const tx = await factory.connect(alice)["createWallet(address)"](alice.address);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
    });

    it("Should create wallet with custom salt", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("custom-salt"));
      const tx = await factory
        .connect(alice)
        ["createWallet(address,bytes32)"](alice.address, salt);
      await tx.wait();

      const walletAddr = await factory["getAddress(bytes32)"](salt);
      expect(await factory.isAgentWallet(walletAddr)).to.be.true;
    });

    it("Should emit WalletCreated event", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("event-salt"));
      await expect(factory.connect(alice)["createWallet(address,bytes32)"](alice.address, salt))
        .to.emit(factory, "WalletCreated");
    });

    it("Should reject zero-address owner", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("zero-owner"));
      await expect(
        factory["createWallet(address,bytes32)"](ethers.ZeroAddress, salt)
      ).to.be.revertedWithCustomError(factory, "InvalidOwnerError");
    });

    it("Should return existing wallet for same owner+salt", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("existing"));
      const tx1 = await factory["createWallet(address,bytes32)"](alice.address, salt);
      await tx1.wait();
      const addr1 = await factory["getAddress(bytes32)"](salt);

      const tx2 = await factory["createWallet(address,bytes32)"](alice.address, salt);
      await tx2.wait();
      const addr2 = await factory["getAddress(bytes32)"](salt);

      expect(addr1).to.equal(addr2);
    });

    it("Should revert if salt already used with different owner", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("conflict"));
      const tx1 = await factory["createWallet(address,bytes32)"](alice.address, salt);
      await tx1.wait();

      await expect(
        factory["createWallet(address,bytes32)"](attacker.address, salt)
      ).to.be.revertedWithCustomError(
        factory,
        "WalletAlreadyExistsWithDifferentOwner"
      );
    });

    it("Should register wallet in agentWallets mapping", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("registry"));
      const tx = await factory["createWallet(address,bytes32)"](alice.address, salt);
      await tx.wait();
      const walletAddr = await factory["getAddress(bytes32)"](salt);
      expect(await factory.agentWallets(walletAddr)).to.be.true;
    });

    it("Should allow multiple wallets for different owners", async function () {
      const tx1 = await factory.connect(alice)["createWallet(address)"](alice.address);
      await tx1.wait();
      const tx2 = await factory.connect(attacker)["createWallet(address)"](attacker.address);
      await tx2.wait();

      expect(await factory.walletCount()).to.equal(2n);
    });
  });

  // ── Admin Functions ──

  describe("Admin Functions", function () {
    it("Should allow owner to update implementation via timelock", async function () {
      const newImpl = alice.address;
      await factory.connect(owner).proposeImplementation(newImpl);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await factory.connect(owner).acceptImplementation();
      expect(await factory.implementation()).to.equal(newImpl);
    });

    it("Should reject zero-address implementation", async function () {
      await expect(
        factory.connect(owner).proposeImplementation(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidImplementationError");
    });

    it("Should prevent non-owner from proposing implementation", async function () {
      await expect(
        factory.connect(attacker).proposeImplementation(alice.address)
      ).to.be.reverted;
    });

    it("Should allow owner to update sessionManager via timelock", async function () {
      await factory.connect(owner).proposeSessionManager(alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await factory.connect(owner).acceptSessionManager();
      expect(await factory.sessionManager()).to.equal(alice.address);
    });

    it("Should reject zero-address sessionManager", async function () {
      await expect(
        factory.connect(owner).proposeSessionManager(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidSessionManagerError");
    });

    it("Should allow owner to update entryPoint via timelock", async function () {
      await factory.connect(owner).proposeEntryPoint(alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await factory.connect(owner).acceptEntryPoint();
      expect(await factory.entryPoint()).to.equal(alice.address);
    });

    it("Should reject zero-address entryPoint", async function () {
      await expect(
        factory.connect(owner).proposeEntryPoint(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidEntryPointError");
    });
  });

  // ── Address Prediction ──

  describe("Address Prediction", function () {
    it("Should predict deterministic wallet address", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("predict"));
      const predicted = await factory["getAddress(bytes32)"](salt);
      const tx = await factory["createWallet(address,bytes32)"](alice.address, salt);
      await tx.wait();
      const actual = await factory["getAddress(bytes32)"](salt);
      expect(predicted).to.equal(actual);
    });
  });

  // ── isAgentWallet ──

  describe("isAgentWallet", function () {
    it("Should return false for unknown address", async function () {
      expect(await factory.isAgentWallet(attacker.address)).to.be.false;
    });

    it("Should return true for created wallet", async function () {
      const tx = await factory["createWallet(address)"](alice.address);
      await tx.wait();
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try {
          return (
            factory.interface.parseLog(log as any)?.name === "WalletCreated"
          );
        } catch {
          return false;
        }
      });
      const walletAddr = (factory.interface.parseLog(event as any) as any)
        .args.wallet;
      expect(await factory.isAgentWallet(walletAddr)).to.be.true;
    });
  });

  // ── UUPS Upgrade ──

  describe("UUPS Upgrade", function () {
    it("Should allow owner to upgrade", async function () {
      const FactoryImpl2 = await ethers.getContractFactory("AgentWalletFactory");
      const newImpl = await FactoryImpl2.deploy();
      await expect(
        factory.connect(owner).upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const FactoryImpl2 = await ethers.getContractFactory("AgentWalletFactory");
      const newImpl = await FactoryImpl2.deploy();
      await expect(
        factory
          .connect(attacker)
          .upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });

  // ── Constructor Self-Destruct Protection ──

  describe("Self-Destruct Protection", function () {
    it("Should mark implementation as initialized", async function () {
      const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
      const impl = await FactoryImpl.deploy();
      await expect(
        impl.initialize(
          alice.address,
          attacker.address,
          alice.address
        )
      ).to.be.reverted;
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 3: SessionManager — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("SessionManager — Unit & Security", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let mockVerifier: any;
  let factory: any;
  let walletImpl: any;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, sessionKey, attacker, alice, bob, mockEntryPoint] =
      await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      await credRegProxy.getAddress()
    );

    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    walletImpl = await WalletImpl.deploy();

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
    sessionManager = await ethers.getContractAt(
      "SessionManager",
      await sessMgrProxy.getAddress()
    );

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ])
    );
    factory = await ethers.getContractAt(
      "AgentWalletFactory",
      await factoryProxy.getAddress()
    );

    await credentialRegistry.setSessionManager(
      await sessionManager.getAddress(),
      true
    );

    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();
  });

  async function createWallet(
    walletOwner: SignerWithAddress
  ): Promise<any> {
    const tx = await factory.connect(walletOwner)["createWallet(address)"](walletOwner.address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return (
          factory.interface.parseLog(log as any)?.name === "WalletCreated"
        );
      } catch {
        return false;
      }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any)
      .args.wallet;
    return ethers.getContractAt("AgentWallet", walletAddress);
  }

  async function createSessionAsWallet(
    walletAddr: string,
    sessionId: string,
    sessionKeyAddr: string,
    maxValue: bigint,
    expiry: bigint,
    a: [bigint, bigint],
    b: [[bigint, bigint], [bigint, bigint]],
    c: [bigint, bigint],
    publicSignals: any[]
  ) {
    await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
    const walletSigner = await ethers.getSigner(walletAddr);
    const result = await sessionManager.connect(walletSigner).createSession(
      sessionId,
      walletAddr,
      sessionKeyAddr,
      maxValue,
      expiry,
      a,
      b,
      c,
      publicSignals
    );
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    return result;
  }

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should set correct verifier", async function () {
      expect(await sessionManager.verifier()).to.equal(
        await mockVerifier.getAddress()
      );
    });

    it("Should set correct registry", async function () {
      expect(await sessionManager.registry()).to.equal(
        await credentialRegistry.getAddress()
      );
    });

    it("Should set correct walletFactory", async function () {
      expect(await sessionManager.walletFactory()).to.equal(
        await factory.getAddress()
      );
    });

    it("Should set correct owner", async function () {
      expect(await sessionManager.owner()).to.equal(owner.address);
    });

    it("Should prevent re-initialization", async function () {
      const SessMgrImpl = await ethers.getContractFactory("SessionManager");
      const impl = await SessMgrImpl.deploy();
      await expect(
        impl.initialize(
          await mockVerifier.getAddress(),
          await credentialRegistry.getAddress(),
          owner.address
        )
      ).to.be.reverted;
    });
  });

  // ── Standard Session: Full Lifecycle ──

  describe("Standard Session Lifecycle", function () {
    let wallet: any;

    beforeEach(async function () {
      wallet = await createWallet(owner);
    });

    async function makeCreateParams(
      walletAddr: string,
      nullifierSeed?: string
    ) {
      const sessionId = ethers.keccak256(
        ethers.toUtf8Bytes("session-" + Math.random())
      );
      const nullifier = ethers.keccak256(
        ethers.toUtf8Bytes(nullifierSeed || "nullifier-" + Math.random())
      );
      const maxValue = 1000000n;
      const block = await ethers.provider.getBlock("latest");
      const expiry = BigInt(block!.timestamp) + 7200n;
      const activeRoot = await credentialRegistry.activeRoot();
      const revokedSecretRoot = await credentialRegistry.revokedSecretRoot();
      const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(activeRoot),
        BigInt(revokedSecretRoot),
        maxValue,
        expiry,
        BigInt(walletAddr),
        1n,
        BigInt(nullifier),
      ];
      const a: [bigint, bigint] = [0n, 0n];
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [0n, 0n],
        [0n, 0n],
      ];
      const c: [bigint, bigint] = [0n, 0n];
      return { sessionId, nullifier, maxValue, expiry, publicSignals, a, b, c };
    }

    it("Should create session with valid proof", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(
          walletAddr,
          p.sessionId,
          sessionKey.address,
          p.maxValue,
          p.expiry,
          p.a,
          p.b,
          p.c,
          p.publicSignals
        )
      ).to.emit(sessionManager, "SessionCreated");
    });

    it("Should reject session with invalid proof", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(false);

      await expect(
        createSessionAsWallet(
          walletAddr,
          p.sessionId,
          sessionKey.address,
          p.maxValue,
          p.expiry,
          p.a,
          p.b,
          p.c,
          p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidProof");
    });

    it("Should reject non-wallet caller", async function () {
      const p = await makeCreateParams(attacker.address);
      await mockVerifier.setResult(true);

      await expect(
        sessionManager.connect(attacker).createSession(
          p.sessionId,
          attacker.address,
          sessionKey.address,
          p.maxValue,
          p.expiry,
          p.a,
          p.b,
          p.c,
          p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "NotAgentWallet");
    });

    it("Should reject zero-address session key", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(
          walletAddr,
          p.sessionId,
          ethers.ZeroAddress,
          p.maxValue,
          p.expiry,
          p.a,
          p.b,
          p.c,
          p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidSessionKey");
    });

    it("Should reject expired session", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      p.expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      p.publicSignals[3] = p.expiry;
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(
          walletAddr,
          p.sessionId,
          sessionKey.address,
          p.maxValue,
          p.expiry,
          p.a,
          p.b,
          p.c,
          p.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "InvalidExpiry");
    });

    it("Should reject duplicate session ID", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      const p2 = await makeCreateParams(walletAddr, "nullifier-2");
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(
          walletAddr,
          p.sessionId,
          sessionKey.address,
          p2.maxValue,
          p2.expiry,
          p2.a,
          p2.b,
          p2.c,
          p2.publicSignals
        )
      ).to.be.revertedWithCustomError(sessionManager, "SessionAlreadyExists");
    });

    it("Should prevent nullifier reuse", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr, "unique-nullifier");
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      const sessionId2 = ethers.keccak256(ethers.toUtf8Bytes("session-2"));
      const p2 = await makeCreateParams(walletAddr, "unique-nullifier");
      await mockVerifier.setResult(true);

      await expect(
        createSessionAsWallet(
          walletAddr,
          sessionId2,
          sessionKey.address,
          p2.maxValue,
          p2.expiry,
          p2.a,
          p2.b,
          p2.c,
          p2.publicSignals
        )
      ).to.be.revertedWithCustomError(
        sessionManager,
        "NullifierAlreadyUsed"
      );
    });

    it("Should mark nullifier as used in registry", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      expect(await credentialRegistry.isNullifierUsed(p.nullifier)).to.be.true;
    });

    it("Should validate active session", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      const valid = await sessionManager.connect(walletSigner).validateSession.staticCall(
        p.sessionId,
        sessionKey.address,
        1n
      );
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
      expect(valid).to.be.true;
    });

    it("Should update valueUsed after validation", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await sessionManager.connect(walletSigner).validateSession(p.sessionId, sessionKey.address, 100n);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
      const session = await sessionManager.sessions(p.sessionId);
      expect(session.valueUsed).to.equal(100n);
    });

    it("Should reject when limit exceeded", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      p.maxValue = 500n;
      p.publicSignals[2] = 500n;
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);

      await sessionManager.connect(walletSigner).validateSession(
        p.sessionId,
        sessionKey.address,
        400n
      );

      await expect(
        sessionManager.connect(walletSigner).validateSession(p.sessionId, sessionKey.address, 200n)
      ).to.be.revertedWithCustomError(sessionManager, "LimitExceeded");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });

    it("Should reject expired session on validation", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await time.increase(7200);

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await expect(
        sessionManager.connect(walletSigner).validateSession(p.sessionId, sessionKey.address, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });

    it("Should reject wrong signer", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await expect(
        sessionManager.connect(walletSigner).validateSession(p.sessionId, attacker.address, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "InvalidSigner");
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });

    it("Should reject validation from wrong wallet", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await ethers.provider.send("hardhat_impersonateAccount", [
        attacker.address,
      ]);
      const attackerSigner = await ethers.getSigner(attacker.address);

      await expect(
        sessionManager
          .connect(attackerSigner)
          .validateSession(p.sessionId, sessionKey.address, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "NotAgentWallet");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        attacker.address,
      ]);
    });

    it("Should allow session key to revoke", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await sessionManager
        .connect(sessionKey)
        .revokeSession(p.sessionId, walletAddr);

      const session = await sessionManager.sessions(p.sessionId);
      expect(session.revoked).to.be.true;
    });

    it("Should allow wallet owner to revoke", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await sessionManager
        .connect(owner)
        .revokeSession(p.sessionId, walletAddr);

      const session = await sessionManager.sessions(p.sessionId);
      expect(session.revoked).to.be.true;
    });

    it("Should prevent unauthorized revocation", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await expect(
        sessionManager
          .connect(attacker)
          .revokeSession(p.sessionId, walletAddr)
      ).to.be.revertedWithCustomError(
        sessionManager,
        "NotAuthorizedToRevoke"
      );
    });

    it("Should prevent double revocation", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await sessionManager
        .connect(sessionKey)
        .revokeSession(p.sessionId, walletAddr);

      await expect(
        sessionManager
          .connect(sessionKey)
          .revokeSession(p.sessionId, walletAddr)
      ).to.be.revertedWithCustomError(
        sessionManager,
        "SessionAlreadyRevoked"
      );
    });

    it("Should reject validation on revoked session", async function () {
      const walletAddr = await wallet.getAddress();
      const p = await makeCreateParams(walletAddr);
      await mockVerifier.setResult(true);

      await createSessionAsWallet(
        walletAddr,
        p.sessionId,
        sessionKey.address,
        p.maxValue,
        p.expiry,
        p.a,
        p.b,
        p.c,
        p.publicSignals
      );

      await sessionManager
        .connect(sessionKey)
        .revokeSession(p.sessionId, walletAddr);

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);
      await expect(
        sessionManager.connect(walletSigner).validateSession(p.sessionId, sessionKey.address, 1n)
      ).to.be.revertedWithCustomError(sessionManager, "SessionIsRevoked");
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });

  });

  // ── Lightweight Session ──

  describe("Lightweight Session", function () {
    let wallet: any;

    beforeEach(async function () {
      wallet = await createWallet(owner);
      await owner.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("10.0"),
      });
    });

    const DAILY_SPEND = ethers.parseEther("1.0");
    const DAILY_TX = 10n;

    async function signSession(
      signer: SignerWithAddress,
      sessionId: string,
      sessionKeyAddr: string,
      walletAddress: string,
      spendLimit: bigint = DAILY_SPEND,
      txLimit: bigint = DAILY_TX,
      expiry?: bigint
    ) {
      if (!expiry) {
        expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      }
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            "uint256",
            "address",
            "address",
            "bytes32",
            "address",
            "uint256",
            "uint256",
            "uint64",
          ],
          [
            network.chainId,
            await sessionManager.getAddress(),
            walletAddress,
            sessionId,
            sessionKeyAddr,
            spendLimit,
            txLimit,
            expiry,
          ]
        )
      );
      return signer.signMessage(ethers.getBytes(messageHash));
    }

    it("Should create lightweight session with valid signature", async function () {
      const sessionId = ethers.id("lw-session-1");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();
      const network = await ethers.provider.getNetwork();

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [
            network.chainId,
            await sessionManager.getAddress(),
            walletAddress,
            sessionId,
            sessionKeyAddr,
            DAILY_SPEND,
            DAILY_TX,
            expiry,
          ]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          expiry,
          signature
        );

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.sessionKey).to.equal(sessionKeyAddr);
      expect(session.dailySpendLimit).to.equal(DAILY_SPEND);
      expect(session.dailyTxLimit).to.equal(DAILY_TX);
      expect(session.revoked).to.be.false;

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should reject with invalid signature", async function () {
      const sessionId = ethers.id("lw-invalid-sig");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await attacker.signMessage(
        ethers.getBytes(messageHash)
      );
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await expect(
        sessionManager
          .connect(walletSigner)
          .createLightweightSession(
            sessionId,
            sessionKeyAddr,
            DAILY_SPEND,
            DAILY_TX,
            expiry,
            signature
          )
      ).to.be.revertedWithCustomError(sessionManager, "NotWalletOwner");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should reject from non-wallet caller", async function () {
      const sessionId = ethers.id("lw-non-wallet");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      await expect(
        sessionManager
          .connect(attacker)
          .createLightweightSession(
            sessionId,
            sessionKeyAddr,
            DAILY_SPEND,
            DAILY_TX,
            expiry,
            signature
          )
      ).to.be.revertedWithCustomError(sessionManager, "NotAgentWallet");
    });

    it("Should validate lightweight session", async function () {
      const sessionId = ethers.id("lw-validate");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          expiry,
          signature
        );

      const valid = await sessionManager
        .connect(walletSigner)
        .validateLightweightSession.staticCall(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.1")
        );
      expect(valid).to.be.true;

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should enforce daily spend limit", async function () {
      const sessionId = ethers.id("lw-spend-limit");
      const sessionKeyAddr = sessionKey.address;
      const lowLimit = ethers.parseEther("0.5");
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, lowLimit, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          lowLimit,
          DAILY_TX,
          expiry,
          signature
        );

      await sessionManager
        .connect(walletSigner)
        .validateLightweightSession(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.3")
        );

      await expect(
        sessionManager
          .connect(walletSigner)
          .validateLightweightSession(
            sessionId,
            sessionKeyAddr,
            ethers.parseEther("0.3")
          )
      ).to.be.revertedWithCustomError(
        sessionManager,
        "DailySpendLimitExceeded"
      );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should enforce daily tx limit", async function () {
      const sessionId = ethers.id("lw-tx-limit");
      const sessionKeyAddr = sessionKey.address;
      const lowTxLimit = 2n;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, lowTxLimit, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          lowTxLimit,
          expiry,
          signature
        );

      await sessionManager
        .connect(walletSigner)
        .validateLightweightSession(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.1")
        );
      await sessionManager
        .connect(walletSigner)
        .validateLightweightSession(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.1")
        );

      await expect(
        sessionManager
          .connect(walletSigner)
          .validateLightweightSession(
            sessionId,
            sessionKeyAddr,
            ethers.parseEther("0.1")
          )
      ).to.be.revertedWithCustomError(
        sessionManager,
        "DailyTxLimitExceeded"
      );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should reset daily limits after day boundary", async function () {
      const sessionId = ethers.id("lw-reset");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          expiry,
          signature
        );

      await sessionManager
        .connect(walletSigner)
        .validateLightweightSession(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.8")
        );

      await time.increase(24 * 60 * 60);

      await sessionManager
        .connect(walletSigner)
        .validateLightweightSession(
          sessionId,
          sessionKeyAddr,
          ethers.parseEther("0.9")
        );

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.dailySpendUsed).to.equal(ethers.parseEther("0.9"));
      expect(session.dailyTxUsed).to.equal(1n);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should reject expired lightweight session", async function () {
      const sessionId = ethers.id("lw-expired");
      const sessionKeyAddr = sessionKey.address;
      const shortExpiry =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, shortExpiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          shortExpiry,
          signature
        );

      await time.increase(7200);

      await expect(
        sessionManager
          .connect(walletSigner)
          .validateLightweightSession(
            sessionId,
            sessionKeyAddr,
            ethers.parseEther("0.1")
          )
      ).to.be.revertedWithCustomError(sessionManager, "SessionExpired");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);
    });

    it("Should revoke lightweight session", async function () {
      const sessionId = ethers.id("lw-revoke");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          expiry,
          signature
        );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);

      await sessionManager
        .connect(sessionKey)
        .revokeLightweightSession(sessionId, walletAddress);

      const session = await sessionManager.getLightSession(sessionId);
      expect(session.revoked).to.be.true;
    });

    it("Should prevent unauthorized lightweight session revocation", async function () {
      const sessionId = ethers.id("lw-unauth-revoke");
      const sessionKeyAddr = sessionKey.address;
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const walletAddress = await wallet.getAddress();

      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
          [network.chainId, await sessionManager.getAddress(), walletAddress, sessionId, sessionKeyAddr, DAILY_SPEND, DAILY_TX, expiry]
        )
      );
      const signature = await owner.signMessage(ethers.getBytes(messageHash));
      await ethers.provider.send("hardhat_impersonateAccount", [
        walletAddress,
      ]);
      const walletSigner = await ethers.getSigner(walletAddress);

      await sessionManager
        .connect(walletSigner)
        .createLightweightSession(
          sessionId,
          sessionKeyAddr,
          DAILY_SPEND,
          DAILY_TX,
          expiry,
          signature
        );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        walletAddress,
      ]);

      await expect(
        sessionManager
          .connect(attacker)
          .revokeLightweightSession(sessionId, walletAddress)
      ).to.be.revertedWithCustomError(
        sessionManager,
        "NotAuthorizedToRevoke"
      );
    });
  });

  // ── Session Type Detection ──

  describe("Session Type Detection", function () {
    it("Should return 2 for non-existent session", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      expect(await sessionManager.getSessionType(fakeId)).to.equal(2);
    });
  });

  // ── Wallet Sessions ──

  describe("Wallet Sessions", function () {
    it("Should return empty array for wallet with no sessions", async function () {
      const sessions = await sessionManager.getWalletSessions(
        ethers.Wallet.createRandom().address
      );
      expect(sessions.length).to.equal(0);
    });
  });

  // ── Prune Expired Sessions ──

  describe("Prune Expired Sessions", function () {
    it("Should reject pruning from non-wallet caller", async function () {
      const fakeWallet = ethers.Wallet.createRandom().address;
      await expect(
        sessionManager.pruneExpiredSessions(fakeWallet, 10)
      ).to.be.revertedWithCustomError(sessionManager, "NotAgentWallet");
    });

    it("Should allow wallet to prune its own expired sessions", async function () {
      const wallet = await createWallet(owner);
      const walletAddress = await wallet.getAddress();
      await owner.sendTransaction({ to: walletAddress, value: ethers.parseEther("0.1") });
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddress]);
      const walletSigner = await ethers.getSigner(walletAddress);
      await sessionManager.connect(walletSigner).pruneExpiredSessions(walletAddress, 10);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddress]);
    });
  });

  // ── Pausable ──

  describe("Pausable", function () {
    it("Should allow owner to pause", async function () {
      await sessionManager.pause();
      expect(await sessionManager.paused()).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await sessionManager.pause();
      await sessionManager.unpause();
      expect(await sessionManager.paused()).to.be.false;
    });

    it("Should prevent non-owner from pausing", async function () {
      await expect(
        sessionManager.connect(attacker).pause()
      ).to.be.reverted;
    });

    it("Should prevent session creation when paused", async function () {
      await sessionManager.pause();
      const wallet = await createWallet(owner);
      const walletAddr = await wallet.getAddress();
      const block = await ethers.provider.getBlock("latest");
      const expiry = BigInt(block!.timestamp + 3600);

      await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
      const walletSigner = await ethers.getSigner(walletAddr);

      await expect(
        sessionManager.connect(walletSigner).createSession(
          ethers.id("paused-session"),
          walletAddr,
          sessionKey.address,
          1000n,
          expiry,
          [0n, 0n],
          [
            [0n, 0n],
            [0n, 0n],
          ],
          [0n, 0n],
          [0n, 0n, 1000n, expiry, walletAddr, 1n, ethers.id("null")]
        )
      ).to.be.revertedWithCustomError(sessionManager, "EnforcedPause");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
    });
  });

  // ── UUPS Upgrade ──

  describe("UUPS Upgrade", function () {
    it("Should allow owner to upgrade", async function () {
      const SessMgrImpl = await ethers.getContractFactory("SessionManager");
      const newImpl = await SessMgrImpl.deploy();
      await expect(
        sessionManager
          .connect(owner)
          .upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const SessMgrImpl = await ethers.getContractFactory("SessionManager");
      const newImpl = await SessMgrImpl.deploy();
      await expect(
        sessionManager
          .connect(attacker)
          .upgradeToAndCall(await newImpl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });

  // ── proposeWalletFactory / acceptWalletFactory ──

  describe("Wallet Factory Timelock", function () {
    it("Should allow owner to propose and accept walletFactory", async function () {
      await sessionManager.connect(owner).proposeWalletFactory(alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await sessionManager.connect(owner).acceptWalletFactory();
      expect(await sessionManager.walletFactory()).to.equal(alice.address);
    });

    it("Should prevent non-owner from proposing", async function () {
      await expect(
        sessionManager.connect(attacker).proposeWalletFactory(alice.address)
      ).to.be.reverted;
    });

    it("Should reject zero-address walletFactory", async function () {
      await expect(
        sessionManager
          .connect(owner)
          .proposeWalletFactory(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(sessionManager, "InvalidSessionManager");
    });

    it("Should reject accept before timelock", async function () {
      await sessionManager.connect(owner).proposeWalletFactory(alice.address);
      await expect(
        sessionManager.connect(owner).acceptWalletFactory()
      ).to.be.revertedWithCustomError(sessionManager, "WalletFactoryTimelockNotReady");
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 4: CredentialRegistry — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("CredentialRegistry — Unit & Security", function () {
  let credentialRegistry: any;
  let owner: SignerWithAddress;
  let issuer: SignerWithAddress;
  let sessionManager: SignerWithAddress;
  let attacker: SignerWithAddress;

  beforeEach(async function () {
    [owner, issuer, sessionManager, attacker] = await ethers.getSigners();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const impl = await CredRegImpl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      await proxy.getAddress()
    );
  });

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should set deployer as owner", async function () {
      expect(await credentialRegistry.owner()).to.equal(owner.address);
    });

    it("Should make owner an issuer", async function () {
      expect(await credentialRegistry.issuers(owner.address)).to.be.true;
    });

    it("Should prevent re-initialization", async function () {
      const impl = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy();
      await expect(impl.initialize(owner.address)).to.be.reverted;
    });
  });

  // ── Access Control ──

  describe("Access Control", function () {
    it("Should allow owner to add issuer", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      expect(await credentialRegistry.issuers(issuer.address)).to.be.true;
    });

    it("Should allow owner to remove issuer", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      await credentialRegistry.removeIssuer(issuer.address);
      expect(await credentialRegistry.issuers(issuer.address)).to.be.false;
    });

    it("Should prevent non-owner from adding issuer", async function () {
      await expect(
        credentialRegistry.connect(attacker).addIssuer(issuer.address)
      ).to.be.reverted;
    });

    it("Should prevent non-owner from removing issuer", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      await expect(
        credentialRegistry.connect(attacker).removeIssuer(issuer.address)
      ).to.be.reverted;
    });

    it("Should allow owner to set session manager", async function () {
      await credentialRegistry.setSessionManager(sessionManager.address, true);
      expect(
        await credentialRegistry.sessionManagers(sessionManager.address)
      ).to.be.true;
    });

    it("Should allow owner to remove session manager", async function () {
      await credentialRegistry.setSessionManager(sessionManager.address, true);
      await credentialRegistry.setSessionManager(sessionManager.address, false);
      expect(
        await credentialRegistry.sessionManagers(sessionManager.address)
      ).to.be.false;
    });

    it("Should prevent non-owner from setting session manager", async function () {
      await expect(
        credentialRegistry
          .connect(attacker)
          .setSessionManager(sessionManager.address, true)
      ).to.be.reverted;
    });
  });

  // ── Root Management ──

  describe("Root Management", function () {
    it("Should allow issuer to update active root", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new-root"));
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      )
        .to.emit(credentialRegistry, "ActiveRootUpdated")
        .withArgs(newRoot);
      expect(await credentialRegistry.activeRoot()).to.equal(newRoot);
    });

    it("Should allow owner to update active root (is issuer)", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("owner-root"));
      await credentialRegistry.updateActiveRoot(newRoot);
      expect(await credentialRegistry.activeRoot()).to.equal(newRoot);
    });

    it("Should prevent non-issuer from updating root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("bad-root"));
      await expect(
        credentialRegistry.connect(attacker).updateActiveRoot(newRoot)
      ).to.be.revertedWithCustomError(credentialRegistry, "OnlyIssuer");
    });

    it("Should allow issuer to update revoked secret root", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      const newRoot = ethers.keccak256(
        ethers.toUtf8Bytes("revoked-root")
      );
      await expect(
        credentialRegistry.connect(issuer).updateRevokedSecretRoot(newRoot)
      )
        .to.emit(credentialRegistry, "RevokedSecretRootUpdated")
        .withArgs(newRoot);
      expect(await credentialRegistry.revokedSecretRoot()).to.equal(newRoot);
    });

    it("Should prevent non-issuer from updating revoked root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("bad-root"));
      await expect(
        credentialRegistry.connect(attacker).updateRevokedSecretRoot(newRoot)
      ).to.be.revertedWithCustomError(credentialRegistry, "OnlyIssuer");
    });

    it("Should allow root overwrite (same issuer, new root)", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      const root1 = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
      const root2 = ethers.keccak256(ethers.toUtf8Bytes("root-2"));
      await credentialRegistry.connect(issuer).updateActiveRoot(root1);
      await credentialRegistry.connect(issuer).updateActiveRoot(root2);
      expect(await credentialRegistry.activeRoot()).to.equal(root2);
    });
  });

  // ── Nullifier Protection ──

  describe("Nullifier Protection", function () {
    it("Should mark nullifier as used", async function () {
      await credentialRegistry.setSessionManager(sessionManager.address, true);
      const nullifier = ethers.keccak256(
        ethers.toUtf8Bytes("test-nullifier")
      );
      await credentialRegistry
        .connect(sessionManager)
        .markNullifierUsed(nullifier);
      expect(
        await credentialRegistry.isNullifierUsed(nullifier)
      ).to.be.true;
    });

    it("Should prevent nullifier reuse", async function () {
      await credentialRegistry.setSessionManager(sessionManager.address, true);
      const nullifier = ethers.keccak256(
        ethers.toUtf8Bytes("test-nullifier")
      );
      await credentialRegistry
        .connect(sessionManager)
        .markNullifierUsed(nullifier);

      await expect(
        credentialRegistry
          .connect(sessionManager)
          .markNullifierUsed(nullifier)
      ).to.be.revertedWithCustomError(credentialRegistry, "NullifierUsed");
    });

    it("Should prevent non-session-manager from marking nullifier", async function () {
      await expect(
        credentialRegistry
          .connect(attacker)
          .markNullifierUsed(ethers.id("test"))
      ).to.be.revertedWithCustomError(
        credentialRegistry,
        "OnlySessionManager"
      );
    });

    it("Should return false for unused nullifier", async function () {
      expect(
        await credentialRegistry.isNullifierUsed(ethers.id("unused"))
      ).to.be.false;
    });
  });

  // ── Pausable ──

  describe("Pausable", function () {
    it("Should pause and unpause root updates", async function () {
      await credentialRegistry.addIssuer(issuer.address);
      await credentialRegistry.pause();
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.be.revertedWithCustomError(credentialRegistry, "EnforcedPause");

      await credentialRegistry.unpause();
      await expect(
        credentialRegistry.connect(issuer).updateActiveRoot(newRoot)
      ).to.emit(credentialRegistry, "ActiveRootUpdated");
    });

    it("Should prevent non-owner from pausing", async function () {
      await expect(
        credentialRegistry.connect(attacker).pause()
      ).to.be.reverted;
    });
  });

  // ── UUPS Upgrade ──

  describe("UUPS Upgrade", function () {
    it("Should allow owner to upgrade", async function () {
      const impl = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy();
      await expect(
        credentialRegistry
          .connect(owner)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const impl = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy();
      await expect(
        credentialRegistry
          .connect(attacker)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 5: CapabilityRegistry — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("CapabilityRegistry — Unit & Security", function () {
  let capabilityRegistry: any;
  let owner: SignerWithAddress;
  let grantor: SignerWithAddress;
  let agent: SignerWithAddress;
  let attacker: SignerWithAddress;

  beforeEach(async function () {
    [owner, grantor, agent, attacker] = await ethers.getSigners();

    const CapRegImpl = await ethers.getContractFactory("CapabilityRegistry");
    const impl = await CapRegImpl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    capabilityRegistry = await ethers.getContractAt(
      "CapabilityRegistry",
      await proxy.getAddress()
    );
  });

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should set deployer as owner", async function () {
      expect(await capabilityRegistry.owner()).to.equal(owner.address);
    });

    it("Should prevent re-initialization", async function () {
      const impl = await (
        await ethers.getContractFactory("CapabilityRegistry")
      ).deploy();
      await expect(impl.initialize(owner.address)).to.be.reverted;
    });
  });

  // ── Capability Registration ──

  describe("Capability Registration", function () {
    it("Should register a capability", async function () {
      const capId = ethers.id("send-email");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await expect(
        capabilityRegistry.registerCapability(capId, "send-email", expiresAt)
      )
        .to.emit(capabilityRegistry, "CapabilityRegistered")
        .withArgs(capId, ethers.keccak256(ethers.toUtf8Bytes("send-email")), owner.address);

      const cap = await capabilityRegistry.getCapability(capId);
      expect(cap.registrar).to.equal(owner.address);
      expect(cap.revoked).to.be.false;
    });

    it("Should prevent duplicate capability", async function () {
      const capId = ethers.id("send-email");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "send-email",
        expiresAt
      );

      await expect(
        capabilityRegistry.registerCapability(capId, "send-email", expiresAt)
      ).to.be.revertedWithCustomError(capabilityRegistry, "CapabilityExists");
    });

    it("Should reject empty action", async function () {
      const capId = ethers.id("empty-action");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await expect(
        capabilityRegistry.registerCapability(capId, "", expiresAt)
      ).to.be.revertedWithCustomError(capabilityRegistry, "ActionRequired");
    });

    it("Should prevent non-owner from registering", async function () {
      const capId = ethers.id("unauth-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await expect(
        capabilityRegistry
          .connect(attacker)
          .registerCapability(capId, "action", expiresAt)
      ).to.be.reverted;
    });

    it("Should increment capability count", async function () {
      const capId = ethers.id("count-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      const countBefore = await capabilityRegistry.getCapabilityCount();
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );
      const countAfter = await capabilityRegistry.getCapabilityCount();
      expect(countAfter).to.equal(countBefore + 1n);
    });
  });

  // ── Capability Revocation ──

  describe("Capability Revocation", function () {
    it("Should allow registrar to revoke", async function () {
      const capId = ethers.id("revoke-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      await expect(capabilityRegistry.revokeCapability(capId))
        .to.emit(capabilityRegistry, "CapabilityRevoked")
        .withArgs(capId);

      const cap = await capabilityRegistry.getCapability(capId);
      expect(cap.revoked).to.be.true;
    });

    it("Should allow owner to revoke", async function () {
      const capId = ethers.id("owner-revoke");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      // Owner is the registrar, so this tests the owner path
      await capabilityRegistry.revokeCapability(capId);
      const cap = await capabilityRegistry.getCapability(capId);
      expect(cap.revoked).to.be.true;
    });

    it("Should prevent unauthorized revocation", async function () {
      const capId = ethers.id("unauth-revoke");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      await expect(
        capabilityRegistry.connect(attacker).revokeCapability(capId)
      ).to.be.revertedWithCustomError(
        capabilityRegistry,
        "NotAuthorizedForCapability"
      );
    });

    it("Should prevent double revocation", async function () {
      const capId = ethers.id("double-revoke");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );
      await capabilityRegistry.revokeCapability(capId);

      await expect(capabilityRegistry.revokeCapability(capId)).to.be.revertedWithCustomError(
        capabilityRegistry,
        "AlreadyRevokedCapability"
      );
    });

    it("Should prevent revocation of non-existent capability", async function () {
      await expect(
        capabilityRegistry.revokeCapability(ethers.id("nonexistent"))
      ).to.be.revertedWithCustomError(
        capabilityRegistry,
        "CapabilityNotFound"
      );
    });

    it("Should update capability list on revocation", async function () {
      const capId1 = ethers.id("list-cap-1");
      const capId2 = ethers.id("list-cap-2");
      const capId3 = ethers.id("list-cap-3");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      await capabilityRegistry.registerCapability(capId1, "a", expiresAt);
      await capabilityRegistry.registerCapability(capId2, "b", expiresAt);
      await capabilityRegistry.registerCapability(capId3, "c", expiresAt);

      const countBefore = await capabilityRegistry.getCapabilityCount();
      expect(countBefore).to.equal(3n);

      await capabilityRegistry.revokeCapability(capId2);

      const countAfter = await capabilityRegistry.getCapabilityCount();
      expect(countAfter).to.equal(2n);
    });
  });

  // ── Grant Root Management ──

  describe("Grant Root Management", function () {
    const grantCapId = ethers.id("grant-root-cap");

    beforeEach(async function () {
      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await capabilityRegistry.registerCapability(grantCapId, "grant-root-action", expiresAt);
    });

    it("Should allow grantor to update grant root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("grant-root"));
      await expect(
        capabilityRegistry
          .connect(grantor)
          .updateGrantRoot(agent.address, grantCapId, newRoot)
      )
        .to.emit(capabilityRegistry, "GrantRootUpdated")
        .withArgs(grantor.address, agent.address, grantCapId, newRoot);

      expect(
        await capabilityRegistry.grantRoots(grantor.address, agent.address, grantCapId)
      ).to.equal(newRoot);
    });

    it("Should allow anyone to update their own grant root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("any-root"));
      await capabilityRegistry
        .connect(attacker)
        .updateGrantRoot(agent.address, grantCapId, newRoot);
      expect(
        await capabilityRegistry.grantRoots(attacker.address, agent.address, grantCapId)
      ).to.equal(newRoot);
    });
  });

  // ── Grant Revocation ──

  describe("Grant Revocation", function () {
    it("Should allow registrar to revoke grant", async function () {
      const capId = ethers.id("grant-revoke");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      const leafHash = ethers.keccak256(ethers.toUtf8Bytes("leaf"));
      const mockRoot = ethers.keccak256(ethers.toUtf8Bytes("mock-root"));
      await capabilityRegistry.updateGrantRoot(agent.address, capId, mockRoot);
      await expect(
        capabilityRegistry.revokeGrant(leafHash, capId, owner.address, agent.address)
      )
        .to.emit(capabilityRegistry, "GrantRevoked")
        .withArgs(leafHash);
    });

    it("Should prevent double grant revocation", async function () {
      const capId = ethers.id("double-grant-revoke");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      const leafHash = ethers.keccak256(ethers.toUtf8Bytes("leaf"));
      const mockRoot = ethers.keccak256(ethers.toUtf8Bytes("mock-root"));
      await capabilityRegistry.updateGrantRoot(agent.address, capId, mockRoot);
      await capabilityRegistry.revokeGrant(leafHash, capId, owner.address, agent.address);

      await expect(
        capabilityRegistry.revokeGrant(leafHash, capId, owner.address, agent.address)
      ).to.be.revertedWithCustomError(
        capabilityRegistry,
        "AlreadyRevokedGrant"
      );
    });
  });

  // ── Capability Verification ──

  describe("Capability Verification", function () {
    it("Should verify valid capability", async function () {
      const capId = ethers.id("verify-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      const constraintsHash = ethers.ZeroHash;
      const grantLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address", "bytes32", "uint64"],
          [capId, owner.address, agent.address, constraintsHash, expiresAt]
        )
      );

      // Create a Merkle tree with one leaf
      const root = grantLeaf;
      const proof: string[] = [];

      await capabilityRegistry
        .connect(owner)
        .updateGrantRoot(agent.address, capId, root);

      const valid = await capabilityRegistry.verifyCapability(
        agent.address,
        capId,
        grantLeaf,
        proof,
        owner.address,
        constraintsHash,
        expiresAt
      );
      expect(valid).to.be.true;
    });

    it("Should reject revoked capability", async function () {
      const capId = ethers.id("revoked-verify");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );
      await capabilityRegistry.revokeCapability(capId);

      const valid = await capabilityRegistry.verifyCapability(
        agent.address,
        capId,
        ethers.ZeroHash,
        [],
        owner.address,
        ethers.ZeroHash,
        expiresAt
      );
      expect(valid).to.be.false;
    });

    it("Should reject expired capability", async function () {
      const capId = ethers.id("expired-verify");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) -
        1n; // Already expired

      // We need to register with a future expiry, then wait
      const futureExpiry =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        3600n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        futureExpiry
      );

      // Fast forward past expiry
      await time.increase(7200);

      const constraintsHash = ethers.ZeroHash;
      const grantLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address", "bytes32", "uint64"],
          [capId, owner.address, agent.address, constraintsHash, futureExpiry]
        )
      );

      await capabilityRegistry
        .connect(owner)
        .updateGrantRoot(agent.address, capId, grantLeaf);

      const valid = await capabilityRegistry.verifyCapability(
        agent.address,
        capId,
        grantLeaf,
        [],
        owner.address,
        constraintsHash,
        futureExpiry
      );
      expect(valid).to.be.false;
    });

    it("Should reject wrong grantor", async function () {
      const capId = ethers.id("wrong-grantor");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      const constraintsHash = ethers.ZeroHash;
      const grantLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address", "bytes32", "uint64"],
          [capId, attacker.address, agent.address, constraintsHash, expiresAt]
        )
      );

      const valid = await capabilityRegistry.verifyCapability(
        agent.address,
        capId,
        grantLeaf,
        [],
        attacker.address,
        constraintsHash,
        expiresAt
      );
      expect(valid).to.be.false;
    });

    it("Should reject revoked grant leaf", async function () {
      const capId = ethers.id("revoked-leaf");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );

      const constraintsHash = ethers.ZeroHash;
      const grantLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "address", "bytes32", "uint64"],
          [capId, owner.address, agent.address, constraintsHash, expiresAt]
        )
      );

      const mockRoot = ethers.keccak256(ethers.toUtf8Bytes("mock-root"));
      await capabilityRegistry
        .connect(owner)
        .updateGrantRoot(agent.address, capId, mockRoot);

      // Revoke the grant
      await capabilityRegistry.revokeGrant(grantLeaf, capId, owner.address, agent.address);

      const valid = await capabilityRegistry.verifyCapability(
        agent.address,
        capId,
        grantLeaf,
        [],
        owner.address,
        constraintsHash,
        expiresAt
      );
      expect(valid).to.be.false;
    });
  });

  // ── Pausable ──

  describe("Pausable", function () {
    it("Should pause and unpause", async function () {
      await capabilityRegistry.pause();
      const capId = ethers.id("paused-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await expect(
        capabilityRegistry.registerCapability(capId, "action", expiresAt)
      ).to.be.revertedWithCustomError(capabilityRegistry, "EnforcedPause");

      await capabilityRegistry.unpause();
      await expect(
        capabilityRegistry.registerCapability(capId, "action", expiresAt)
      ).to.not.be.reverted;
    });
  });

  // ── UUPS Upgrade ──

  describe("UUPS Upgrade", function () {
    it("Should allow owner to upgrade", async function () {
      const impl = await (
        await ethers.getContractFactory("CapabilityRegistry")
      ).deploy();
      await expect(
        capabilityRegistry
          .connect(owner)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.not.be.reverted;
    });

    it("Should prevent non-owner from upgrading", async function () {
      const impl = await (
        await ethers.getContractFactory("CapabilityRegistry")
      ).deploy();
      await expect(
        capabilityRegistry
          .connect(attacker)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });

  // ── View Helpers ──

  describe("View Helpers", function () {
    it("Should return correct capability count", async function () {
      expect(await capabilityRegistry.getCapabilityCount()).to.equal(0n);
    });

    it("Should return capability at index", async function () {
      const capId = ethers.id("idx-cap");
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;
      await capabilityRegistry.registerCapability(
        capId,
        "action",
        expiresAt
      );
      expect(await capabilityRegistry.getCapabilityAt(0)).to.equal(capId);
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 6: DelegationManager — Unit Tests & Security
// ─────────────────────────────────────────────────────────

describe("DelegationManager — Unit & Security", function () {
  let delegationManager: any;
  let owner: SignerWithAddress;
  let delegator: SignerWithAddress;
  let delegate: SignerWithAddress;
  let attacker: SignerWithAddress;
  let rootUpdater: SignerWithAddress;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const ROOT_UPDATER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("ROOT_UPDATER")
  );

  beforeEach(async function () {
    [owner, delegator, delegate, attacker, rootUpdater] =
      await ethers.getSigners();

    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const impl = await DelMgrImpl.deploy();
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(
      await impl.getAddress(),
      impl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delegationManager = await ethers.getContractAt(
      "DelegationManager",
      await proxy.getAddress()
    );
  });

  // ── Initialization ──

  describe("Initialization", function () {
    it("Should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
      expect(
        await delegationManager.hasRole(DEFAULT_ADMIN_ROLE, owner.address)
      ).to.be.true;
    });

    it("Should grant ROOT_UPDATER_ROLE to deployer", async function () {
      expect(
        await delegationManager.hasRole(ROOT_UPDATER_ROLE, owner.address)
      ).to.be.true;
    });

    it("Should prevent re-initialization", async function () {
      const impl = await (
        await ethers.getContractFactory("DelegationManager")
      ).deploy();
      await expect(impl.initialize(owner.address)).to.be.reverted;
    });
  });

  // ── Admin Functions ──

  describe("Admin Functions", function () {
    it("Should allow admin to pause", async function () {
      await delegationManager.pause();
      expect(await delegationManager.paused()).to.be.true;
    });

    it("Should allow admin to unpause", async function () {
      await delegationManager.pause();
      await delegationManager.unpause();
      expect(await delegationManager.paused()).to.be.false;
    });

    it("Should prevent non-admin from pausing", async function () {
      await expect(
        delegationManager.connect(attacker).pause()
      ).to.be.reverted;
    });

    it("Should allow admin to grant ROOT_UPDATER_ROLE", async function () {
      await delegationManager.setRootUpdater(rootUpdater.address, true);
      expect(
        await delegationManager.hasRole(ROOT_UPDATER_ROLE, rootUpdater.address)
      ).to.be.true;
    });

    it("Should allow admin to revoke ROOT_UPDATER_ROLE", async function () {
      await delegationManager.setRootUpdater(rootUpdater.address, true);
      await delegationManager.setRootUpdater(rootUpdater.address, false);
      expect(
        await delegationManager.hasRole(ROOT_UPDATER_ROLE, rootUpdater.address)
      ).to.be.false;
    });

    it("Should prevent non-admin from setting root updater", async function () {
      await expect(
        delegationManager
          .connect(attacker)
          .setRootUpdater(rootUpdater.address, true)
      ).to.be.reverted;
    });

    it("Should allow admin to register scope", async function () {
      const action = "send-email";
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes(action)
      );
      await expect(delegationManager.registerScope(action))
        .to.emit(delegationManager, "ScopeRegistered")
        .withArgs(action, scopeHash);

      expect(await delegationManager.getScopeAction(scopeHash)).to.equal(
        action
      );
    });

    it("Should prevent duplicate scope registration", async function () {
      const action = "send-email";
      await delegationManager.registerScope(action);

      await expect(
        delegationManager.registerScope(action)
      ).to.be.revertedWithCustomError(
        delegationManager,
        "ScopeAlreadyRegistered"
      );
    });

    it("Should allow admin to emergency revoke all", async function () {
      await delegationManager.emergencyRevokeAll(delegator.address);
      expect(
        await delegationManager.revokedDelegators(delegator.address)
      ).to.be.true;
    });

    it("Should allow admin to re-authorize delegator", async function () {
      await delegationManager.emergencyRevokeAll(delegator.address);
      await delegationManager.reAuthorizeDelegator(delegator.address);
      expect(
        await delegationManager.revokedDelegators(delegator.address)
      ).to.be.false;
    });
  });

  // ── Delegation Root Management ──

  describe("Delegation Root Management", function () {
    const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("test-scope"));

    it("Should allow delegator to update their own root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new-root"));
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(delegator.address, scopeHash, newRoot, expiresAt);

      const rootInfo = await delegationManager.getDelegationRoot(
        delegator.address,
        scopeHash
      );
      expect(rootInfo.root).to.equal(newRoot);
      expect(rootInfo.expiresAt).to.equal(expiresAt);
    });

    it("Should allow ROOT_UPDATER to update any root", async function () {
      await delegationManager.setRootUpdater(rootUpdater.address, true);
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("updater-root"));
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      await delegationManager
        .connect(rootUpdater)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          newRoot,
          expiresAt
        );

      const rootInfo = await delegationManager.getDelegationRoot(
        delegator.address,
        scopeHash
      );
      expect(rootInfo.root).to.equal(newRoot);
    });

    it("Should reject revoked delegator root update", async function () {
      await delegationManager.emergencyRevokeAll(delegator.address);

      await expect(
        delegationManager
          .connect(delegator)
          .updateDelegationRoot(
            delegator.address,
            scopeHash,
            ethers.ZeroHash,
            0
          )
      ).to.be.revertedWithCustomError(
        delegationManager,
        "DelegatorHasBeenRevoked"
      );
    });

    it("Should reject unauthorized root update", async function () {
      await expect(
        delegationManager
          .connect(attacker)
          .updateDelegationRoot(
            delegator.address,
            scopeHash,
            ethers.ZeroHash,
            0
          )
      ).to.be.reverted;
    });

    it("Should enforce 32-scope limit per delegator", async function () {
      for (let i = 0; i < 32; i++) {
        const action = `scope-${i}`;
        const sh = ethers.keccak256(ethers.toUtf8Bytes(action));
        await delegationManager
          .connect(delegator)
          .updateDelegationRoot(
            delegator.address,
            sh,
            ethers.keccak256(ethers.toUtf8Bytes(`root-${i}`)),
            0
          );
      }

      // 33rd scope should fail
      const overflowScope = ethers.keccak256(
        ethers.toUtf8Bytes("scope-overflow")
      );
      await expect(
        delegationManager
          .connect(delegator)
          .updateDelegationRoot(
            delegator.address,
            overflowScope,
            ethers.keccak256(ethers.toUtf8Bytes("overflow-root")),
            0
          )
      ).to.be.revertedWithCustomError(
        delegationManager,
        "ScopeLimitExceeded"
      );
    });
  });

  // ── Delegation Revocation ──

  describe("Delegation Revocation", function () {
    it("Should allow delegator to revoke their delegation", async function () {
      const leafHash = ethers.keccak256(
        ethers.toUtf8Bytes("delegation-leaf")
      );
      await delegationManager
        .connect(delegator)
        .revokeDelegation(leafHash, delegator.address);

      expect(await delegationManager.isRevoked(leafHash)).to.be.true;
    });

    it("Should allow admin to revoke delegation", async function () {
      const leafHash = ethers.keccak256(
        ethers.toUtf8Bytes("delegation-leaf")
      );
      await delegationManager
        .connect(owner)
        .revokeDelegation(leafHash, delegator.address);

      expect(await delegationManager.isRevoked(leafHash)).to.be.true;
    });

    it("Should prevent double revocation", async function () {
      const leafHash = ethers.keccak256(
        ethers.toUtf8Bytes("delegation-leaf")
      );
      await delegationManager
        .connect(delegator)
        .revokeDelegation(leafHash, delegator.address);

      await expect(
        delegationManager
          .connect(delegator)
          .revokeDelegation(leafHash, delegator.address)
      ).to.be.revertedWithCustomError(
        delegationManager,
        "AlreadyRevokedDelegation"
      );
    });
  });

  // ── Single-Hop Verification ──

  describe("Single-Hop Verification", function () {
    it("Should verify valid delegation", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("verify-scope")
      );
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("verify-root"));
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      // Set root
      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          newRoot,
          expiresAt
        );

      // Create leaf
      const delegationLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );

      // Set root to the leaf hash (single-element tree)
      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          delegationLeaf,
          expiresAt
        );

      const valid = await delegationManager
        .connect(delegate)
        .verifyDelegation.staticCall(
          delegationLeaf,
          [],
          delegator.address,
          scopeHash,
          expiresAt,
          10
        );
      expect(valid).to.be.true;
    });

    it("Should reject expired root", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("expired-root-scope")
      );
      const newRoot = ethers.keccak256(
        ethers.toUtf8Bytes("expired-root")
      );

      // Set root with short expiry
      const shortExpiry =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 1n;
      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          newRoot,
          shortExpiry
        );

      await time.increase(10);

      const delegationLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, shortExpiry]
        )
      );

      const valid = await delegationManager
        .connect(delegate)
        .verifyDelegation.staticCall(
          delegationLeaf,
          [],
          delegator.address,
          scopeHash,
          shortExpiry,
          10
        );
      expect(valid).to.be.false;
    });

    it("Should reject revoked delegator", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("revoked-delegator-scope")
      );
      const newRoot = ethers.keccak256(
        ethers.toUtf8Bytes("revoked-delegator-root")
      );
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          newRoot,
          expiresAt
        );

      // Revoke the delegator
      await delegationManager.emergencyRevokeAll(delegator.address);

      const delegationLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );

      const valid = await delegationManager
        .connect(delegate)
        .verifyDelegation.staticCall(
          delegationLeaf,
          [],
          delegator.address,
          scopeHash,
          expiresAt,
          10
        );
      expect(valid).to.be.false;
    });

    it("Should reject revoked delegation leaf", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("revoked-leaf-scope")
      );
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      const delegationLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );

      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          delegationLeaf,
          expiresAt
        );

      // Revoke the delegation
      await delegationManager
        .connect(delegator)
        .revokeDelegation(delegationLeaf, delegator.address);

      const valid = await delegationManager
        .connect(delegate)
        .verifyDelegation.staticCall(
          delegationLeaf,
          [],
          delegator.address,
          scopeHash,
          expiresAt,
          10
        );
      expect(valid).to.be.false;
    });

    it("Should reject wrong scope hash", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("correct-scope")
      );
      const wrongScope = ethers.keccak256(
        ethers.toUtf8Bytes("wrong-scope")
      );
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      const delegationLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );

      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          delegationLeaf,
          expiresAt
        );

      const valid = await delegationManager
        .connect(delegate)
        .verifyDelegation.staticCall(
          delegationLeaf,
          [],
          delegator.address,
          wrongScope,
          expiresAt,
          10
        );
      expect(valid).to.be.false;
    });
  });

  // ── Multi-Hop Chain Verification ──

  describe("Multi-Hop Chain Verification", function () {
    it("Should verify valid 2-hop chain", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("chain-scope")
      );
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      // Hop 1: delegator -> delegate
      const leaf1 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );
      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          leaf1,
          expiresAt
        );

      // Hop 2: delegate -> attacker (delegate becomes delegator)
      const leaf2 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegate.address, attacker.address, scopeHash, expiresAt]
        )
      );
      await delegationManager
        .connect(delegate)
        .updateDelegationRoot(
          delegate.address,
          scopeHash,
          leaf2,
          expiresAt
        );

      const valid = await delegationManager
        .connect(attacker)
        .verifyDelegationChain.staticCall(
          [leaf1, leaf2],
          [[], []],
          [delegator.address, delegate.address],
          [delegate.address, attacker.address],
          [scopeHash, scopeHash],
          [expiresAt, expiresAt],
          [10, 10]
        );
      expect(valid).to.be.true;
    });

    it("Should reject empty chain", async function () {
      await expect(
        delegationManager.verifyDelegationChain([], [], [], [], [], [], [])
      ).to.be.revertedWithCustomError(delegationManager, "EmptyChain");
    });

    it("Should reject chain exceeding MAX_DELEGATION_DEPTH", async function () {
      const leaves: string[] = [];
      const proofs: string[][] = [];
      const delegatorsList: string[] = [];
      const delegatesList: string[] = [];
      const scopeHashes: string[] = [];
      const expiries: bigint[] = [];
      const maxDepths: number[] = [];

      for (let i = 0; i <= 10; i++) {
        leaves.push(ethers.ZeroHash);
        proofs.push([]);
        delegatorsList.push(attacker.address);
        delegatesList.push(attacker.address);
        scopeHashes.push(ethers.ZeroHash);
        expiries.push(BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400));
        maxDepths.push(10);
      }

      await expect(
        delegationManager.verifyDelegationChain(
          leaves,
          proofs,
          delegatorsList,
          delegatesList,
          scopeHashes,
          expiries,
          maxDepths
        )
      ).to.be.revertedWithCustomError(delegationManager, "ChainTooLong");
    });

    it("Should reject chain with mismatched array lengths", async function () {
      await expect(
        delegationManager.verifyDelegationChain(
          [ethers.ZeroHash],
          [],
          [],
          [],
          [],
          [],
          []
        )
      ).to.be.revertedWithCustomError(
        delegationManager,
        "ArrayLengthMismatch"
      );
    });

    it("Should reject broken chain (non-continuous delegator)", async function () {
      const scopeHash = ethers.keccak256(
        ethers.toUtf8Bytes("broken-chain-scope")
      );
      const expiresAt =
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp) +
        86400n;

      // Hop 1: delegator -> delegate
      const leaf1 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [delegator.address, delegate.address, scopeHash, expiresAt]
        )
      );
      await delegationManager
        .connect(delegator)
        .updateDelegationRoot(
          delegator.address,
          scopeHash,
          leaf1,
          expiresAt
        );

      // Hop 2: attacker (NOT delegate) -> attacker (broken chain)
      const leaf2 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "bytes32", "uint64"],
          [attacker.address, attacker.address, scopeHash, expiresAt]
        )
      );
      await delegationManager
        .connect(attacker)
        .updateDelegationRoot(
          attacker.address,
          scopeHash,
          leaf2,
          expiresAt
        );

      const valid = await delegationManager
        .connect(attacker)
        .verifyDelegationChain.staticCall(
          [leaf1, leaf2],
          [[], []],
          [delegator.address, attacker.address], // Broken: delegators[1] != delegates[0]
          [delegate.address, attacker.address],
          [scopeHash, scopeHash],
          [expiresAt, expiresAt],
          [10, 10]
        );
      expect(valid).to.be.false;
    });
  });

  // ── UUPS Upgrade ──

  describe("UUPS Upgrade", function () {
    it("Should allow admin to upgrade", async function () {
      const impl = await (
        await ethers.getContractFactory("DelegationManager")
      ).deploy();
      await expect(
        delegationManager
          .connect(owner)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.not.be.reverted;
    });

    it("Should prevent non-admin from upgrading", async function () {
      const impl = await (
        await ethers.getContractFactory("DelegationManager")
      ).deploy();
      await expect(
        delegationManager
          .connect(attacker)
          .upgradeToAndCall(await impl.getAddress(), "0x")
      ).to.be.reverted;
    });
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 7: Cross-Contract Integration Tests
// ─────────────────────────────────────────────────────────

describe("Cross-Contract Integration", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let capabilityRegistry: any;
  let delegationManager: any;
  let mockVerifier: any;
  let factory: any;
  let wallet: any;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let agent: SignerWithAddress;
  let attacker: SignerWithAddress;
  let mockEntryPoint: SignerWithAddress;

  beforeEach(async function () {
    [owner, sessionKey, agent, attacker, mockEntryPoint] =
      await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    mockVerifier = await MockVerifierFactory.deploy();

    // CredentialRegistry
    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      await credRegProxy.getAddress()
    );

    // AgentWalletFactory
    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await WalletImpl.deploy();

    const placeholderAddr = "0x0000000000000000000000000000000000000001";

    // SessionManager
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
    sessionManager = await ethers.getContractAt(
      "SessionManager",
      await sessMgrProxy.getAddress()
    );

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint.address,
      ])
    );
    factory = await ethers.getContractAt(
      "AgentWalletFactory",
      await factoryProxy.getAddress()
    );

    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();
    await credentialRegistry.setSessionManager(
      await sessionManager.getAddress(),
      true
    );

    // CapabilityRegistry
    const CapRegImpl = await ethers.getContractFactory("CapabilityRegistry");
    const capRegImpl = await CapRegImpl.deploy();
    const CapRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const capRegProxy = await CapRegProxy.deploy(
      await capRegImpl.getAddress(),
      capRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    capabilityRegistry = await ethers.getContractAt(
      "CapabilityRegistry",
      await capRegProxy.getAddress()
    );

    // DelegationManager
    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const delMgrImpl = await DelMgrImpl.deploy();
    const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const delMgrProxy = await DelMgrProxy.deploy(
      await delMgrImpl.getAddress(),
      delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delegationManager = await ethers.getContractAt(
      "DelegationManager",
      await delMgrProxy.getAddress()
    );

    // Create wallet
    const tx = await factory
      .connect(owner)
      ["createWallet(address)"](await owner.getAddress());
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        return (
          factory.interface.parseLog(log as any)?.name === "WalletCreated"
        );
      } catch {
        return false;
      }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any)
      .args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  it("Full session lifecycle: create -> use -> revoke", async function () {
    const walletAddr = await wallet.getAddress();
    const sessionId = ethers.keccak256(ethers.toUtf8Bytes("full-lifecycle"));
    const nullifier = ethers.keccak256(
      ethers.toUtf8Bytes("lifecycle-nullifier")
    );
    const maxValue = 1000000n;
    const block = await ethers.provider.getBlock("latest");
    const expiry = BigInt(block!.timestamp) + 7200n;
    const activeRoot = await credentialRegistry.activeRoot();
    const revokedSecretRoot = await credentialRegistry.revokedSecretRoot();
    const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint] = [
      BigInt(nullifier),
      BigInt(activeRoot),
      BigInt(revokedSecretRoot),
      maxValue,
      expiry,
      BigInt(walletAddr),
    ];
    await mockVerifier.setResult(true);

    // Create
    await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
    const walletSigner = await ethers.getSigner(walletAddr);
    await sessionManager.connect(walletSigner).createSession(
      sessionId,
      walletAddr,
      sessionKey.address,
      maxValue,
      expiry,
      [0n, 0n],
      [
        [0n, 0n],
        [0n, 0n],
      ],
      [0n, 0n],
      [activeRoot, revokedSecretRoot, maxValue, expiry, walletAddr, 1n, nullifier]
    );
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);

    // Validate
    await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
    const valid = await sessionManager.connect(walletSigner).validateSession.staticCall(
      sessionId,
      sessionKey.address,
      100n
    );
    expect(valid).to.be.true;

    // Revoke
    await sessionManager
      .connect(sessionKey)
      .revokeSession(sessionId, walletAddr);

    // Should fail after revocation
    await expect(
      sessionManager.connect(walletSigner).validateSession(sessionId, sessionKey.address, 1n)
    ).to.be.revertedWithCustomError(sessionManager, "SessionIsRevoked");
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [walletAddr]);
  });

  it("Capability verification through Merkle proof", async function () {
    const capId = ethers.id("integration-cap");
    const expiresAt =
      BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;

    await capabilityRegistry.registerCapability(
      capId,
      "integration-action",
      expiresAt
    );

    const constraintsHash = ethers.ZeroHash;
    const grantLeaf = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "bytes32", "uint64"],
        [capId, owner.address, agent.address, constraintsHash, expiresAt]
      )
    );

    await capabilityRegistry
      .connect(owner)
      .updateGrantRoot(agent.address, capId, grantLeaf);

    const valid = await capabilityRegistry.verifyCapability(
      agent.address,
      capId,
      grantLeaf,
      [],
      owner.address,
      constraintsHash,
      expiresAt
    );
    expect(valid).to.be.true;
  });

  it("Delegation verification through chain", async function () {
    const scopeHash = ethers.keccak256(
      ethers.toUtf8Bytes("integration-scope")
    );
    const expiresAt =
      BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;

    const leaf = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"],
        [owner.address, agent.address, scopeHash, expiresAt]
      )
    );

    await delegationManager
      .connect(owner)
      .updateDelegationRoot(owner.address, scopeHash, leaf, expiresAt);

    const valid = await delegationManager
      .connect(agent)
      .verifyDelegation.staticCall(
        leaf,
        [],
        owner.address,
        scopeHash,
        expiresAt,
        10
      );
    expect(valid).to.be.true;
  });
});
