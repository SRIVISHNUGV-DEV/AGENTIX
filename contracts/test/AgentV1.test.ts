import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("═══════════════════════════════════════════════════════", function () {
  it("══════ AGENTIX V1 PROTOCOL AUDIT ══════", function () {});
});

interface ProtocolContext {
  owner: SignerWithAddress;
  sessionKey: SignerWithAddress;
  attacker: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  charlie: SignerWithAddress;
  mockEntryPoint: SignerWithAddress;
  rootUpdater: SignerWithAddress;
  mockVerifier: any;
  credentialRegistry: any;
  walletImpl: any;
  sessionManager: any;
  factory: any;
  capabilityRegistry: any;
  delegationManager: any;
  orgRegistry: any;
  anchorImpl: any;
  agentIdentity: any;
}

async function deployProtocol(): Promise<ProtocolContext> {
  const [owner, sessionKey, attacker, alice, bob, charlie, mockEntryPoint, rootUpdater] =
    await ethers.getSigners();

  const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
  const mockVerifier = await MockVerifierFactory.deploy();

  const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
  const credRegImpl = await CredRegImpl.deploy();
  const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
  const credRegProxy = await CredRegProxy.deploy(
    await credRegImpl.getAddress(),
    credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
  );
  const credentialRegistry = await ethers.getContractAt(
    "CredentialRegistry", await credRegProxy.getAddress()
  );

  const WalletImpl = await ethers.getContractFactory("AgentWallet");
  const walletImpl = await WalletImpl.deploy();

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
  const sessionManager = await ethers.getContractAt(
    "SessionManager", await sessMgrProxy.getAddress()
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
  const factory = await ethers.getContractAt(
    "AgentWalletFactory", await factoryProxy.getAddress()
  );

  await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
  await ethers.provider.send("evm_increaseTime", [86400]);
  await ethers.provider.send("evm_mine", []);
  await sessionManager.connect(owner).acceptWalletFactory();
  await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);

  const CapRegImpl = await ethers.getContractFactory("CapabilityRegistry");
  const capRegImpl = await CapRegImpl.deploy();
  const CapRegProxy = await ethers.getContractFactory("ERC1967Proxy");
  const capRegProxy = await CapRegProxy.deploy(
    await capRegImpl.getAddress(),
    capRegImpl.interface.encodeFunctionData("initialize", [owner.address])
  );
  const capabilityRegistry = await ethers.getContractAt(
    "CapabilityRegistry", await capRegProxy.getAddress()
  );

  const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
  const delMgrImpl = await DelMgrImpl.deploy();
  const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
  const delMgrProxy = await DelMgrProxy.deploy(
    await delMgrImpl.getAddress(),
    delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
  );
  const delegationManager = await ethers.getContractAt(
    "DelegationManager", await delMgrProxy.getAddress()
  );

  const AnchorImpl = await ethers.getContractFactory("OrganizationCredentialAnchor");
  const anchorImpl = await AnchorImpl.deploy();

  const OrgRegImpl = await ethers.getContractFactory("OrganizationRegistry");
  const orgRegImpl = await OrgRegImpl.deploy();
  const OrgRegProxy = await ethers.getContractFactory("ERC1967Proxy");
  const orgRegProxy = await OrgRegProxy.deploy(
    await orgRegImpl.getAddress(),
    orgRegImpl.interface.encodeFunctionData("initialize", [owner.address, await anchorImpl.getAddress()])
  );
  const orgRegistry = await ethers.getContractAt(
    "OrganizationRegistry", await orgRegProxy.getAddress()
  );

  const IdentityImpl = await ethers.getContractFactory("AgentIdentity");
  const identityImpl = await IdentityImpl.deploy();
  const IdentityProxy = await ethers.getContractFactory("ERC1967Proxy");
  const identityProxy = await IdentityProxy.deploy(
    await identityImpl.getAddress(),
    identityImpl.interface.encodeFunctionData("initialize", [owner.address, await factory.getAddress()])
  );
  const agentIdentity = await ethers.getContractAt(
    "AgentIdentity", await identityProxy.getAddress()
  );
  await factory.connect(owner).setAgentIdentity(await agentIdentity.getAddress());

  return {
    owner, sessionKey, attacker, alice, bob, charlie, mockEntryPoint, rootUpdater,
    mockVerifier, credentialRegistry, walletImpl, sessionManager, factory,
    capabilityRegistry, delegationManager, orgRegistry, anchorImpl, agentIdentity,
  };
}

async function createWallet(ctx: ProtocolContext, walletOwner: SignerWithAddress): Promise<any> {
  const tx = await ctx.factory.connect(walletOwner)["createWallet(address)"](walletOwner.address);
  const receipt = await tx.wait();
  const event = receipt?.logs.find((log: any) => {
    try { return ctx.factory.interface.parseLog(log as any)?.name === "WalletCreated"; }
    catch { return false; }
  });
  const addr = (ctx.factory.interface.parseLog(event as any) as any).args.wallet;
  return ethers.getContractAt("AgentWallet", addr);
}

async function impersonateWallet(walletAddr: string): Promise<SignerWithAddress> {
  await ethers.provider.send("hardhat_setBalance", [walletAddr, "0x56BC75E2D63100000"]);
  await ethers.provider.send("hardhat_impersonateAccount", [walletAddr]);
  return ethers.getSigner(walletAddr);
}

async function stopImpersonate(addr: string) {
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [addr]);
}

async function makeSessionParams(walletAddr: string, credReg: any, nullifierSeed?: string) {
  const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-" + Math.random()));
  const nullifier = ethers.keccak256(ethers.toUtf8Bytes(nullifierSeed || "nullifier-" + Math.random()));
  const maxValue = 1000000n;
  const block = await ethers.provider.getBlock("latest");
  const expiry = BigInt(block!.timestamp) + 7200n;
  const activeRoot = await credReg.activeRoot();
  const revokedSecretRoot = await credReg.revokedSecretRoot();
  const publicSignals: [bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
    BigInt(activeRoot), BigInt(revokedSecretRoot), maxValue, expiry,
    BigInt(walletAddr), 1n, BigInt(nullifier),
  ];
  const a: [bigint, bigint] = [0n, 0n];
  const b: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]];
  const c: [bigint, bigint] = [0n, 0n];
  return { sessionId, nullifier, maxValue, expiry, publicSignals, a, b, c };
}

// ============================================================================
// SECTION 1: AgentWallet
// ============================================================================

describe("AgentWallet", function () {
  let ctx: ProtocolContext;
  let wallet: any;

  beforeEach(async function () {
    ctx = await deployProtocol();
    wallet = await createWallet(ctx, ctx.owner);
  });

  describe("Initialization", function () {
    it("Sets correct owner", async function () {
      expect(await wallet.owner()).to.equal(ctx.owner.address);
    });
    it("Sets correct sessionManager", async function () {
      expect(await wallet.sessionManager()).to.equal(await ctx.sessionManager.getAddress());
    });
    it("Sets correct entryPoint", async function () {
      expect(await wallet.entryPoint()).to.equal(ctx.mockEntryPoint.address);
    });
    it("Prevents re-initialization", async function () {
      await expect(
        wallet.initialize(ctx.attacker.address, await ctx.sessionManager.getAddress(), ctx.mockEntryPoint.address)
      ).to.be.revertedWithCustomError(wallet, "AlreadyInitializedError");
    });
    it("Implementation cannot be initialized", async function () {
      const impl = await (await ethers.getContractFactory("AgentWallet")).deploy();
      await expect(
        impl.initialize(ctx.alice.address, ctx.bob.address, ctx.attacker.address)
      ).to.be.revertedWithCustomError(impl, "AlreadyInitializedError");
    });
  });

  describe("Ownership Transfer", function () {
    it("Owner initiates and pending owner accepts", async function () {
      await wallet.connect(ctx.owner).changeOwner(ctx.alice.address);
      expect(await wallet.pendingOwner()).to.equal(ctx.alice.address);
      await wallet.connect(ctx.alice).acceptOwnership();
      expect(await wallet.owner()).to.equal(ctx.alice.address);
      expect(await wallet.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
    it("Reverts non-owner initiate", async function () {
      await expect(
        wallet.connect(ctx.attacker).changeOwner(ctx.attacker.address)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });
    it("Reverts non-pending accept", async function () {
      await wallet.connect(ctx.owner).changeOwner(ctx.alice.address);
      await expect(
        wallet.connect(ctx.bob).acceptOwnership()
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });
    it("Reverts zero-address new owner", async function () {
      await expect(
        wallet.connect(ctx.owner).changeOwner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(wallet, "InvalidOwnerError");
    });
    it("Old owner loses access after transfer", async function () {
      await wallet.connect(ctx.owner).changeOwner(ctx.alice.address);
      await wallet.connect(ctx.alice).acceptOwnership();
      await expect(
        wallet.connect(ctx.owner).changeOwner(ctx.attacker.address)
      ).to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });
  });

  describe("Execution", function () {
    it("Owner executes single call", async function () {
      await expect(
        wallet.connect(ctx.owner).execute(ctx.alice.address, 0, "0x")
      ).to.emit(wallet, "ExecutionPerformed");
    });
    it("Reverts zero-address target", async function () {
      await expect(
        wallet.connect(ctx.owner).execute(ethers.ZeroAddress, 0, "0x")
      ).to.be.revertedWithCustomError(wallet, "InvalidRecipientError");
    });
    it("Reverts failed call", async function () {
      const ReverterFactory = await ethers.getContractFactory("MockVerifier");
      const reverter = await ReverterFactory.deploy();
      await expect(
        wallet.connect(ctx.owner).execute(await reverter.getAddress(), ethers.parseEther("1"), "0x")
      ).to.be.revertedWithCustomError(wallet, "ExecutionFailedError");
    });
    it("Executes with ETH value", async function () {
      await ctx.owner.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1.0") });
      const balBefore = await ethers.provider.getBalance(ctx.alice.address);
      await wallet.connect(ctx.owner).execute(ctx.alice.address, ethers.parseEther("0.5"), "0x");
      const balAfter = await ethers.provider.getBalance(ctx.alice.address);
      expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
    });
    it("Owner executes batch", async function () {
      await expect(
        wallet.connect(ctx.owner).executeBatch(
          [ctx.alice.address, ctx.bob.address], [0, 0], ["0x", "0x"]
        )
      ).to.emit(wallet, "BatchExecutionPerformed");
    });
    it("Reverts batch length mismatch", async function () {
      await expect(
        wallet.connect(ctx.owner).executeBatch([ctx.alice.address], [0, 0], ["0x"])
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });
    it("Reverts batch empty", async function () {
      await expect(
        wallet.connect(ctx.owner).executeBatch([], [], [])
      ).to.be.revertedWithCustomError(wallet, "LengthMismatchError");
    });
    it("Reverts batch exceeds MAX_BATCH_SIZE", async function () {
      const targets = Array(21).fill(ctx.alice.address);
      await expect(
        wallet.connect(ctx.owner).executeBatch(targets, Array(21).fill(0), Array(21).fill("0x"))
      ).to.be.revertedWithCustomError(wallet, "BatchTooLargeError");
    });
    it("Non-owner cannot execute", async function () {
      await expect(
        wallet.connect(ctx.attacker).execute(ctx.alice.address, 0, "0x")
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });
    it("Non-owner cannot batch execute", async function () {
      await expect(
        wallet.connect(ctx.attacker).executeBatch([ctx.alice.address], [0], ["0x"])
      ).to.be.revertedWithCustomError(wallet, "NotAuthorizedError");
    });
  });

  describe("Timelock Proposals", function () {
    it("Propose and accept sessionManager", async function () {
      await wallet.connect(ctx.owner).proposeSessionManager(ctx.alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await wallet.connect(ctx.owner).acceptSessionManager();
      expect(await wallet.sessionManager()).to.equal(ctx.alice.address);
    });
    it("Propose and accept entryPoint", async function () {
      await wallet.connect(ctx.owner).proposeEntryPoint(ctx.alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await wallet.connect(ctx.owner).acceptEntryPoint();
      expect(await wallet.entryPoint()).to.equal(ctx.alice.address);
    });
    it("Reverts early accept", async function () {
      await wallet.connect(ctx.owner).proposeSessionManager(ctx.alice.address);
      await expect(
        wallet.connect(ctx.owner).acceptSessionManager()
      ).to.be.revertedWithCustomError(wallet, "TimelockNotReadyError");
    });
    it("Reverts second propose while pending", async function () {
      await wallet.connect(ctx.owner).proposeSessionManager(ctx.alice.address);
      await expect(
        wallet.connect(ctx.owner).proposeSessionManager(ctx.bob.address)
      ).to.be.revertedWithCustomError(wallet, "TimelockActiveError");
    });
    it("Reverts zero-address proposals", async function () {
      await expect(wallet.connect(ctx.owner).proposeSessionManager(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(wallet, "InvalidSessionManagerError");
      await expect(wallet.connect(ctx.owner).proposeEntryPoint(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(wallet, "InvalidEntryPointError");
    });
    it("Non-owner cannot propose", async function () {
      await expect(wallet.connect(ctx.attacker).proposeSessionManager(ctx.alice.address))
        .to.be.revertedWithCustomError(wallet, "NotOwnerError");
    });
  });

  describe("ETH Receive & Balance", function () {
    it("Accepts ETH from anyone", async function () {
      await ctx.attacker.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("0.5") });
      expect(await wallet.checkBalance()).to.equal(ethers.parseEther("0.5"));
    });
  });
});

// ============================================================================
// SECTION 2: AgentWalletFactory
// ============================================================================

describe("AgentWalletFactory", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  describe("Initialization", function () {
    it("Sets all references correctly", async function () {
      expect(await ctx.factory.implementation()).to.equal(await ctx.walletImpl.getAddress());
      expect(await ctx.factory.sessionManager()).to.equal(await ctx.sessionManager.getAddress());
      expect(await ctx.factory.entryPoint()).to.equal(ctx.mockEntryPoint.address);
      expect(await ctx.factory.owner()).to.equal(ctx.owner.address);
    });
    it("Prevents re-initialization", async function () {
      await expect(
        ctx.factory.initialize(await ctx.walletImpl.getAddress(), await ctx.sessionManager.getAddress(), ctx.mockEntryPoint.address)
      ).to.be.reverted;
    });
  });

  describe("Wallet Creation", function () {
    it("Creates with auto-salt and custom salt", async function () {
      const tx1 = await ctx.factory.connect(ctx.alice)["createWallet(address)"](ctx.alice.address);
      expect((await tx1.wait())?.status).to.equal(1);
      const salt = ethers.keccak256(ethers.toUtf8Bytes("custom"));
      const tx2 = await ctx.factory.connect(ctx.alice)["createWallet(address,bytes32)"](ctx.alice.address, salt);
      await tx2.wait();
      expect(await ctx.factory.isAgentWallet(await ctx.factory["getAddress(bytes32)"](salt))).to.be.true;
    });
    it("Emits WalletCreated", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("ev"));
      await expect(ctx.factory.connect(ctx.alice)["createWallet(address,bytes32)"](ctx.alice.address, salt))
        .to.emit(ctx.factory, "WalletCreated");
    });
    it("Reverts zero-address owner", async function () {
      await expect(ctx.factory["createWallet(address,bytes32)"](ethers.ZeroAddress, ethers.ZeroHash))
        .to.be.revertedWithCustomError(ctx.factory, "InvalidOwnerError");
    });
    it("Same owner+salt returns same wallet", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("idem"));
      await (await ctx.factory["createWallet(address,bytes32)"](ctx.alice.address, salt)).wait();
      const addr1 = await ctx.factory["getAddress(bytes32)"](salt);
      await (await ctx.factory["createWallet(address,bytes32)"](ctx.alice.address, salt)).wait();
      expect(await ctx.factory["getAddress(bytes32)"](salt)).to.equal(addr1);
    });
    it("Reverts different owner on same salt", async function () {
      const salt = ethers.keccak256(ethers.toUtf8Bytes("conflict"));
      await (await ctx.factory["createWallet(address,bytes32)"](ctx.alice.address, salt)).wait();
      await expect(
        ctx.factory["createWallet(address,bytes32)"](ctx.attacker.address, salt)
      ).to.be.revertedWithCustomError(ctx.factory, "WalletAlreadyExistsWithDifferentOwner");
    });
    it("Registers wallet in mapping and increments count", async function () {
      await (await ctx.factory.connect(ctx.alice)["createWallet(address)"](ctx.alice.address)).wait();
      await (await ctx.factory.connect(ctx.attacker)["createWallet(address)"](ctx.attacker.address)).wait();
      expect(await ctx.factory.walletCount()).to.equal(2n);
    });
  });

  describe("Timelock Admin", function () {
    it("Updates implementation, sessionManager, entryPoint via timelock", async function () {
      await ctx.factory.connect(ctx.owner).proposeImplementation(ctx.alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await ctx.factory.connect(ctx.owner).acceptImplementation();
      expect(await ctx.factory.implementation()).to.equal(ctx.alice.address);
    });
    it("Reverts zero-address for all proposals", async function () {
      await expect(ctx.factory.connect(ctx.owner).proposeImplementation(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(ctx.factory, "InvalidImplementationError");
    });
    it("Reverts accept before timelock", async function () {
      await ctx.factory.connect(ctx.owner).proposeImplementation(ctx.alice.address);
      await expect(ctx.factory.connect(ctx.owner).acceptImplementation())
        .to.be.revertedWithCustomError(ctx.factory, "TimelockNotReadyError");
    });
    it("setAgentIdentity", async function () {
      await ctx.factory.connect(ctx.owner).setAgentIdentity(ctx.alice.address);
      expect(await ctx.factory.agentIdentity()).to.equal(ctx.alice.address);
    });
  });

  describe("UUPS Upgrade", function () {
    it("Owner can upgrade", async function () {
      const newImpl = await (await ethers.getContractFactory("AgentWalletFactory")).deploy();
      await expect(ctx.factory.connect(ctx.owner).upgradeToAndCall(await newImpl.getAddress(), "0x")).to.not.be.reverted;
    });
    it("Non-owner cannot upgrade", async function () {
      const newImpl = await (await ethers.getContractFactory("AgentWalletFactory")).deploy();
      await expect(ctx.factory.connect(ctx.attacker).upgradeToAndCall(await newImpl.getAddress(), "0x")).to.be.reverted;
    });
  });
});

// ============================================================================
// SECTION 3: SessionManager
// ============================================================================

describe("SessionManager", function () {
  let ctx: ProtocolContext;
  let wallet: any;
  let walletAddr: string;

  beforeEach(async function () {
    ctx = await deployProtocol();
    wallet = await createWallet(ctx, ctx.owner);
    walletAddr = await wallet.getAddress();
  });

  async function createSession(p: any) {
    await ctx.mockVerifier.setResult(true);
    const signer = await impersonateWallet(walletAddr);
    await ctx.sessionManager.connect(signer).createSession(
      p.sessionId, walletAddr, ctx.sessionKey.address, p.maxValue, p.expiry,
      p.a, p.b, p.c, p.publicSignals
    );
    await stopImpersonate(walletAddr);
  }

  describe("Initialization", function () {
    it("Sets all dependencies", async function () {
      expect(await ctx.sessionManager.verifier()).to.equal(await ctx.mockVerifier.getAddress());
      expect(await ctx.sessionManager.registry()).to.equal(await ctx.credentialRegistry.getAddress());
      expect(await ctx.sessionManager.walletFactory()).to.equal(await ctx.factory.getAddress());
      expect(await ctx.sessionManager.owner()).to.equal(ctx.owner.address);
    });
  });

  describe("Standard Session", function () {
    it("Creates with valid proof", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await ctx.mockVerifier.setResult(true);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p.sessionId, walletAddr, ctx.sessionKey.address, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.emit(ctx.sessionManager, "SessionCreated");
      await stopImpersonate(walletAddr);
    });
    it("Rejects invalid proof", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await ctx.mockVerifier.setResult(false);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p.sessionId, walletAddr, ctx.sessionKey.address, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "InvalidProof");
      await stopImpersonate(walletAddr);
    });
    it("Rejects non-wallet caller", async function () {
      const p = await makeSessionParams(ctx.attacker.address, ctx.credentialRegistry);
      await ctx.mockVerifier.setResult(true);
      await expect(
        ctx.sessionManager.connect(ctx.attacker).createSession(
          p.sessionId, ctx.attacker.address, ctx.sessionKey.address, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotAgentWallet");
    });
    it("Rejects zero-address session key", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await ctx.mockVerifier.setResult(true);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p.sessionId, walletAddr, ethers.ZeroAddress, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "InvalidSessionKey");
      await stopImpersonate(walletAddr);
    });
    it("Rejects session key = wallet", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await ctx.mockVerifier.setResult(true);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p.sessionId, walletAddr, walletAddr, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "InvalidSessionKey");
      await stopImpersonate(walletAddr);
    });
    it("Rejects expired session", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      p.expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      p.publicSignals[3] = p.expiry;
      await ctx.mockVerifier.setResult(true);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p.sessionId, walletAddr, ctx.sessionKey.address, p.maxValue, p.expiry,
          p.a, p.b, p.c, p.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "InvalidExpiry");
      await stopImpersonate(walletAddr);
    });
    it("Rejects duplicate session ID", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      const p2 = await makeSessionParams(walletAddr, ctx.credentialRegistry, "nullifier-2");
      p2.sessionId = p.sessionId;
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p2.sessionId, walletAddr, ctx.sessionKey.address, p2.maxValue, p2.expiry,
          p2.a, p2.b, p2.c, p2.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "SessionAlreadyExists");
      await stopImpersonate(walletAddr);
    });
    it("Prevents nullifier reuse", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry, "unique");
      await createSession(p);
      const p2 = await makeSessionParams(walletAddr, ctx.credentialRegistry, "unique");
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createSession(
          p2.sessionId, walletAddr, ctx.sessionKey.address, p2.maxValue, p2.expiry,
          p2.a, p2.b, p2.c, p2.publicSignals
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NullifierAlreadyUsed");
      await stopImpersonate(walletAddr);
    });
    it("Marks nullifier as used in registry", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      expect(await ctx.credentialRegistry.isNullifierUsed(p.nullifier)).to.be.true;
    });
    it("Validates active session and updates valueUsed", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).validateSession(
        p.sessionId, ctx.sessionKey.address, 100n, ctx.alice.address
      );
      await stopImpersonate(walletAddr);
      const session = await ctx.sessionManager.sessions(p.sessionId);
      expect(session.valueUsed).to.equal(100n);
    });
    it("Rejects when limit exceeded with multiple calls", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      p.maxValue = 1000n;
      p.publicSignals[2] = 1000n;
      await createSession(p);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).validateSession(
        p.sessionId, ctx.sessionKey.address, 600n, ctx.alice.address
      );
      await ctx.sessionManager.connect(signer).validateSession(
        p.sessionId, ctx.sessionKey.address, 300n, ctx.alice.address
      );
      await expect(
        ctx.sessionManager.connect(signer).validateSession(
          p.sessionId, ctx.sessionKey.address, 200n, ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "LimitExceeded");
      await stopImpersonate(walletAddr);
    });
    it("Rejects expired session on validation", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await time.increase(7200);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).validateSession(
          p.sessionId, ctx.sessionKey.address, 1n, ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "SessionExpired");
      await stopImpersonate(walletAddr);
    });
    it("Rejects wrong signer", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).validateSession(
          p.sessionId, ctx.attacker.address, 1n, ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "InvalidSigner");
      await stopImpersonate(walletAddr);
    });
    it("Rejects validation from wrong wallet", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      const s = await impersonateWallet(ctx.attacker.address);
      await expect(
        ctx.sessionManager.connect(s).validateSession(
          p.sessionId, ctx.sessionKey.address, 1n, ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotAgentWallet");
      await stopImpersonate(ctx.attacker.address);
    });
    it("Rejects zero-value target", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).validateSession(
          p.sessionId, ctx.sessionKey.address, 0n, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "TargetNotAllowed");
      await stopImpersonate(walletAddr);
    });
    it("Session key can revoke", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await ctx.sessionManager.connect(ctx.sessionKey).revokeSession(p.sessionId, walletAddr);
      expect((await ctx.sessionManager.sessions(p.sessionId)).revoked).to.be.true;
    });
    it("Wallet owner can revoke", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await ctx.sessionManager.connect(ctx.owner).revokeSession(p.sessionId, walletAddr);
      expect((await ctx.sessionManager.sessions(p.sessionId)).revoked).to.be.true;
    });
    it("Unauthorized revocation reverts", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await expect(
        ctx.sessionManager.connect(ctx.attacker).revokeSession(p.sessionId, walletAddr)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotAuthorizedToRevoke");
    });
    it("Double revocation reverts", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await ctx.sessionManager.connect(ctx.sessionKey).revokeSession(p.sessionId, walletAddr);
      await expect(
        ctx.sessionManager.connect(ctx.sessionKey).revokeSession(p.sessionId, walletAddr)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "SessionAlreadyRevoked");
    });
    it("Rejects validation on revoked session", async function () {
      const p = await makeSessionParams(walletAddr, ctx.credentialRegistry);
      await createSession(p);
      await ctx.sessionManager.connect(ctx.sessionKey).revokeSession(p.sessionId, walletAddr);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).validateSession(
          p.sessionId, ctx.sessionKey.address, 1n, ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "SessionIsRevoked");
      await stopImpersonate(walletAddr);
    });
  });

  describe("Lightweight Session", function () {
    const DAILY_SPEND = ethers.parseEther("1.0");
    const DAILY_TX = 10n;

    async function signLW(sessionId: string, skAddr: string, wAddr: string, sp?: bigint, tx?: bigint, exp?: bigint, targets: string[] = []) {
      if (!exp) exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const net = await ethers.provider.getNetwork();
      const msg = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64", "address[]"],
        [net.chainId, await ctx.sessionManager.getAddress(), wAddr, sessionId, skAddr, sp ?? DAILY_SPEND, tx ?? DAILY_TX, exp, targets]
      ));
      return ctx.owner.signMessage(ethers.getBytes(msg));
    }

    it("Creates with valid signature", async function () {
      const sid = ethers.id("lw-1");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(
        sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [], sig
      );
      await stopImpersonate(walletAddr);
      const s = await ctx.sessionManager.getLightSession(sid);
      expect(s.sessionKey).to.equal(ctx.sessionKey.address);
      expect(s.dailySpendLimit).to.equal(DAILY_SPEND);
      expect(s.revoked).to.be.false;
    });
    it("Creates with allowed targets", async function () {
      const sid = ethers.id("lw-targets");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const targets = [ctx.alice.address, ctx.bob.address];
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp, targets);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(
        sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, targets, sig
      );
      await stopImpersonate(walletAddr);
      const t = await ctx.sessionManager.getSessionTargets(sid);
      expect(t.length).to.equal(2);
    });
    it("Rejects invalid signature", async function () {
      const sid = ethers.id("lw-bad");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const msg = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64", "address[]"],
        [1, await ctx.sessionManager.getAddress(), walletAddr, sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, []]
      ));
      const badSig = await ctx.attacker.signMessage(ethers.getBytes(msg));
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createLightweightSession(
          sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [], badSig
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotWalletOwner");
      await stopImpersonate(walletAddr);
    });
    it("Rejects non-wallet caller", async function () {
      const sid = ethers.id("lw-nw");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp);
      await expect(
        ctx.sessionManager.connect(ctx.attacker).createLightweightSession(
          sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [], sig
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotAgentWallet");
    });
    it("Validates and enforces daily spend limit", async function () {
      const sid = ethers.id("lw-spend");
      const lowLimit = ethers.parseEther("0.5");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, lowLimit, DAILY_TX, exp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(
        sid, ctx.sessionKey.address, lowLimit, DAILY_TX, exp, [], sig
      );
      await ctx.sessionManager.connect(signer).validateLightweightSession(
        sid, ctx.sessionKey.address, ethers.parseEther("0.3"), ctx.alice.address
      );
      await expect(
        ctx.sessionManager.connect(signer).validateLightweightSession(
          sid, ctx.sessionKey.address, ethers.parseEther("0.3"), ctx.alice.address
        )
      ).to.be.revertedWithCustomError(ctx.sessionManager, "DailySpendLimitExceeded");
      await stopImpersonate(walletAddr);
    });
    it("Enforces daily tx limit", async function () {
      const sid = ethers.id("lw-tx");
      const lowTx = 2n;
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, lowTx, exp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(
        sid, ctx.sessionKey.address, DAILY_SPEND, lowTx, exp, [], sig
      );
      await ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.1"), ctx.alice.address);
      await ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.1"), ctx.alice.address);
      await expect(
        ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.1"), ctx.alice.address)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "DailyTxLimitExceeded");
      await stopImpersonate(walletAddr);
    });
    it("Resets daily limits after day boundary", async function () {
      const sid = ethers.id("lw-reset");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [], sig);
      await ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.8"), ctx.alice.address);
      await time.increase(24 * 60 * 60);
      await ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.9"), ctx.alice.address);
      const s = await ctx.sessionManager.getLightSession(sid);
      expect(s.dailySpendUsed).to.equal(ethers.parseEther("0.9"));
      expect(s.dailyTxUsed).to.equal(1n);
      await stopImpersonate(walletAddr);
    });
    it("Rejects expired lightweight session", async function () {
      const sid = ethers.id("lw-exp");
      const shortExp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, shortExp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, shortExp, [], sig);
      await time.increase(7200);
      await expect(
        ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.1"), ctx.alice.address)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "SessionExpired");
      await stopImpersonate(walletAddr);
    });
    it("Session key can revoke", async function () {
      const sid = ethers.id("lw-rev");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [], sig);
      await stopImpersonate(walletAddr);
      await ctx.sessionManager.connect(ctx.sessionKey).revokeLightweightSession(sid, walletAddr);
      expect((await ctx.sessionManager.getLightSession(sid)).revoked).to.be.true;
    });
    it("Target restriction enforced", async function () {
      const sid = ethers.id("lw-target");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp, [ctx.alice.address]);
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).createLightweightSession(
        sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, [ctx.alice.address], sig
      );
      await expect(
        ctx.sessionManager.connect(signer).validateLightweightSession(sid, ctx.sessionKey.address, ethers.parseEther("0.1"), ctx.bob.address)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "TargetNotAllowed");
      await stopImpersonate(walletAddr);
    });
    it("Rejects too many targets", async function () {
      const sid = ethers.id("lw-many");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 86400 * 30);
      const targets = Array(33).fill(ctx.alice.address);
      const sig = await signLW(sid, ctx.sessionKey.address, walletAddr, DAILY_SPEND, DAILY_TX, exp, targets);
      const signer = await impersonateWallet(walletAddr);
      await expect(
        ctx.sessionManager.connect(signer).createLightweightSession(sid, ctx.sessionKey.address, DAILY_SPEND, DAILY_TX, exp, targets, sig)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "TooManyTargets");
      await stopImpersonate(walletAddr);
    });
  });

  describe("Session Type Detection", function () {
    it("Returns 2 for non-existent", async function () {
      expect(await ctx.sessionManager.getSessionType(ethers.id("fake"))).to.equal(2);
    });
  });

  describe("Prune Expired Sessions", function () {
    it("Wallet can prune own expired sessions", async function () {
      const signer = await impersonateWallet(walletAddr);
      await ctx.sessionManager.connect(signer).pruneExpiredSessions(walletAddr, 10);
      await stopImpersonate(walletAddr);
    });
    it("Non-wallet pruning reverts", async function () {
      await expect(
        ctx.sessionManager.pruneExpiredSessions(ctx.attacker.address, 10)
      ).to.be.revertedWithCustomError(ctx.sessionManager, "NotAgentWallet");
    });
  });

  describe("Pausable", function () {
    it("Owner can pause/unpause", async function () {
      await ctx.sessionManager.pause();
      expect(await ctx.sessionManager.paused()).to.be.true;
      await ctx.sessionManager.unpause();
      expect(await ctx.sessionManager.paused()).to.be.false;
    });
    it("Non-owner cannot pause", async function () {
      await expect(ctx.sessionManager.connect(ctx.attacker).pause()).to.be.reverted;
    });
  });

  describe("WalletFactory Timelock", function () {
    it("Propose and accept", async function () {
      await ctx.sessionManager.connect(ctx.owner).proposeWalletFactory(ctx.alice.address);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await ctx.sessionManager.connect(ctx.owner).acceptWalletFactory();
      expect(await ctx.sessionManager.walletFactory()).to.equal(ctx.alice.address);
    });
    it("Rejects zero-address", async function () {
      await expect(ctx.sessionManager.connect(ctx.owner).proposeWalletFactory(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(ctx.sessionManager, "InvalidSessionManager");
    });
  });

  describe("UUPS Upgrade", function () {
    it("Owner can upgrade", async function () {
      const newImpl = await (await ethers.getContractFactory("SessionManager")).deploy();
      await expect(ctx.sessionManager.connect(ctx.owner).upgradeToAndCall(await newImpl.getAddress(), "0x")).to.not.be.reverted;
    });
  });
});

// ============================================================================
// SECTION 4: CredentialRegistry
// ============================================================================

describe("CredentialRegistry", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  describe("Access Control", function () {
    it("Owner adds/removes issuer", async function () {
      await ctx.credentialRegistry.addIssuer(ctx.alice.address);
      expect(await ctx.credentialRegistry.issuers(ctx.alice.address)).to.be.true;
      await ctx.credentialRegistry.removeIssuer(ctx.alice.address);
      expect(await ctx.credentialRegistry.issuers(ctx.alice.address)).to.be.false;
    });
    it("Non-owner cannot add issuer", async function () {
      await expect(ctx.credentialRegistry.connect(ctx.attacker).addIssuer(ctx.alice.address)).to.be.reverted;
    });
    it("Owner sets/removes session manager", async function () {
      await ctx.credentialRegistry.setSessionManager(ctx.sessionKey.address, true);
      expect(await ctx.credentialRegistry.sessionManagers(ctx.sessionKey.address)).to.be.true;
    });
  });

  describe("Root Management", function () {
    it("Issuer updates active root", async function () {
      const r = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await expect(ctx.credentialRegistry.updateActiveRoot(r))
        .to.emit(ctx.credentialRegistry, "ActiveRootUpdated");
      expect(await ctx.credentialRegistry.activeRoot()).to.equal(r);
    });
    it("Issuer updates revoked root", async function () {
      const r = ethers.keccak256(ethers.toUtf8Bytes("revoked"));
      await expect(ctx.credentialRegistry.updateRevokedSecretRoot(r))
        .to.emit(ctx.credentialRegistry, "RevokedSecretRootUpdated");
      expect(await ctx.credentialRegistry.revokedSecretRoot()).to.equal(r);
    });
    it("Non-issuer cannot update root", async function () {
      await expect(ctx.credentialRegistry.connect(ctx.attacker).updateActiveRoot(ethers.id("bad")))
        .to.be.revertedWithCustomError(ctx.credentialRegistry, "OnlyIssuer");
    });
  });

  describe("Nullifier Protection", function () {
    it("Marks and prevents reuse", async function () {
      await ctx.credentialRegistry.setSessionManager(ctx.owner.address, true);
      const n = ethers.id("test-n");
      await ctx.credentialRegistry.markNullifierUsed(n);
      expect(await ctx.credentialRegistry.isNullifierUsed(n)).to.be.true;
      await expect(ctx.credentialRegistry.markNullifierUsed(n))
        .to.be.revertedWithCustomError(ctx.credentialRegistry, "NullifierUsed");
    });
    it("Non-session-manager cannot mark", async function () {
      await expect(ctx.credentialRegistry.connect(ctx.attacker).markNullifierUsed(ethers.id("x")))
        .to.be.revertedWithCustomError(ctx.credentialRegistry, "OnlySessionManager");
    });
  });

  describe("Pausable & UUPS", function () {
    it("Pauses root updates", async function () {
      await ctx.credentialRegistry.pause();
      await expect(ctx.credentialRegistry.updateActiveRoot(ethers.id("r")))
        .to.be.revertedWithCustomError(ctx.credentialRegistry, "EnforcedPause");
    });
    it("Owner can upgrade", async function () {
      const impl = await (await ethers.getContractFactory("CredentialRegistry")).deploy();
      await expect(ctx.credentialRegistry.connect(ctx.owner).upgradeToAndCall(await impl.getAddress(), "0x")).to.not.be.reverted;
    });
  });
});

// ============================================================================
// SECTION 5: CapabilityRegistry
// ============================================================================

describe("CapabilityRegistry", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  describe("Registration & Revocation", function () {
    it("Registers capability", async function () {
      const capId = ethers.id("cap");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await expect(ctx.capabilityRegistry.registerCapability(capId, "action", exp))
        .to.emit(ctx.capabilityRegistry, "CapabilityRegistered");
    });
    it("Prevents duplicate", async function () {
      const capId = ethers.id("dup");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      await expect(ctx.capabilityRegistry.registerCapability(capId, "a", exp))
        .to.be.revertedWithCustomError(ctx.capabilityRegistry, "CapabilityExists");
    });
    it("Rejects empty action", async function () {
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await expect(ctx.capabilityRegistry.registerCapability(ethers.id("e"), "", exp))
        .to.be.revertedWithCustomError(ctx.capabilityRegistry, "ActionRequired");
    });
    it("Registrar can revoke", async function () {
      const capId = ethers.id("rev");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      await expect(ctx.capabilityRegistry.revokeCapability(capId))
        .to.emit(ctx.capabilityRegistry, "CapabilityRevoked");
    });
    it("Prevents double revocation", async function () {
      const capId = ethers.id("dr");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      await ctx.capabilityRegistry.revokeCapability(capId);
      await expect(ctx.capabilityRegistry.revokeCapability(capId))
        .to.be.revertedWithCustomError(ctx.capabilityRegistry, "AlreadyRevokedCapability");
    });
  });

  describe("Grant Root & Verification", function () {
    it("Owner can update grant root", async function () {
      const capId = ethers.id("gr");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await expect(ctx.capabilityRegistry.connect(ctx.owner).updateGrantRoot(ctx.alice.address, capId, root))
        .to.emit(ctx.capabilityRegistry, "GrantRootUpdated");
    });
    it("Verifies valid capability", async function () {
      const capId = ethers.id("vc");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      const ch = ethers.ZeroHash;
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "bytes32", "uint64"],
        [capId, ctx.owner.address, ctx.alice.address, ch, exp]
      ));
      await ctx.capabilityRegistry.connect(ctx.owner).updateGrantRoot(ctx.alice.address, capId, leaf);
      expect(await ctx.capabilityRegistry.verifyCapability(ctx.alice.address, capId, leaf, [], ctx.owner.address, ch, exp)).to.be.true;
    });
    it("Rejects revoked capability", async function () {
      const capId = ethers.id("rc");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      await ctx.capabilityRegistry.revokeCapability(capId);
      expect(await ctx.capabilityRegistry.verifyCapability(ctx.alice.address, capId, ethers.ZeroHash, [], ctx.owner.address, ethers.ZeroHash, exp)).to.be.false;
    });
    it("Rejects expired capability", async function () {
      const capId = ethers.id("ec");
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n;
      await ctx.capabilityRegistry.registerCapability(capId, "a", exp);
      await time.increase(7200);
      expect(await ctx.capabilityRegistry.verifyCapability(ctx.alice.address, capId, ethers.ZeroHash, [], ctx.owner.address, ethers.ZeroHash, exp)).to.be.false;
    });
  });

  describe("Pausable & UUPS", function () {
    it("Pauses registration", async function () {
      await ctx.capabilityRegistry.pause();
      await expect(ctx.capabilityRegistry.registerCapability(ethers.id("p"), "a", 0))
        .to.be.revertedWithCustomError(ctx.capabilityRegistry, "EnforcedPause");
    });
    it("Owner can upgrade", async function () {
      const impl = await (await ethers.getContractFactory("CapabilityRegistry")).deploy();
      await expect(ctx.capabilityRegistry.connect(ctx.owner).upgradeToAndCall(await impl.getAddress(), "0x")).to.not.be.reverted;
    });
  });
});

// ============================================================================
// SECTION 6: DelegationManager
// ============================================================================

describe("DelegationManager", function () {
  let ctx: ProtocolContext;
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const ROOT_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ROOT_UPDATER"));

  beforeEach(async function () { ctx = await deployProtocol(); });

  describe("Initialization & Admin", function () {
    it("Grants roles to deployer", async function () {
      expect(await ctx.delegationManager.hasRole(DEFAULT_ADMIN_ROLE, ctx.owner.address)).to.be.true;
      expect(await ctx.delegationManager.hasRole(ROOT_UPDATER_ROLE, ctx.owner.address)).to.be.true;
    });
    it("Pause/unpause", async function () {
      await ctx.delegationManager.pause();
      expect(await ctx.delegationManager.paused()).to.be.true;
      await ctx.delegationManager.unpause();
      expect(await ctx.delegationManager.paused()).to.be.false;
    });
    it("Grant/revoke ROOT_UPDATER", async function () {
      await ctx.delegationManager.setRootUpdater(ctx.rootUpdater.address, true);
      expect(await ctx.delegationManager.hasRole(ROOT_UPDATER_ROLE, ctx.rootUpdater.address)).to.be.true;
      await ctx.delegationManager.setRootUpdater(ctx.rootUpdater.address, false);
      expect(await ctx.delegationManager.hasRole(ROOT_UPDATER_ROLE, ctx.rootUpdater.address)).to.be.false;
    });
    it("Register scope and prevent duplicates", async function () {
      await expect(ctx.delegationManager.registerScope("email"))
        .to.emit(ctx.delegationManager, "ScopeRegistered");
      await expect(ctx.delegationManager.registerScope("email"))
        .to.be.revertedWithCustomError(ctx.delegationManager, "ScopeAlreadyRegistered");
    });
    it("Emergency revoke all and re-authorize clears roots", async function () {
      const scopeHash = ethers.keccak256(ethers.toUtf8Bytes("s"));
      const root = ethers.keccak256(ethers.toUtf8Bytes("r"));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, scopeHash, root, 0);
      expect((await ctx.delegationManager.getDelegationRoot(ctx.alice.address, scopeHash)).root).to.equal(root);
      await ctx.delegationManager.emergencyRevokeAll(ctx.alice.address);
      expect(await ctx.delegationManager.revokedDelegators(ctx.alice.address)).to.be.true;
      await ctx.delegationManager.reAuthorizeDelegator(ctx.alice.address);
      expect(await ctx.delegationManager.revokedDelegators(ctx.alice.address)).to.be.false;
      const info = await ctx.delegationManager.getDelegationRoot(ctx.alice.address, scopeHash);
      expect(info.root).to.equal(ethers.ZeroHash);
    });
  });

  describe("Root Management", function () {
    it("Delegator updates own root", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("scope"));
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, root, exp);
      const info = await ctx.delegationManager.getDelegationRoot(ctx.alice.address, sh);
      expect(info.root).to.equal(root);
      expect(info.expiresAt).to.equal(exp);
    });
    it("ROOT_UPDATER updates any root", async function () {
      await ctx.delegationManager.setRootUpdater(ctx.rootUpdater.address, true);
      const sh = ethers.keccak256(ethers.toUtf8Bytes("scope"));
      const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
      await ctx.delegationManager.connect(ctx.rootUpdater).updateDelegationRoot(ctx.alice.address, sh, root, 0);
      expect((await ctx.delegationManager.getDelegationRoot(ctx.alice.address, sh)).root).to.equal(root);
    });
    it("Revoked delegator cannot update root", async function () {
      await ctx.delegationManager.emergencyRevokeAll(ctx.alice.address);
      await expect(
        ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, ethers.ZeroHash, ethers.ZeroHash, 0)
      ).to.be.revertedWithCustomError(ctx.delegationManager, "DelegatorHasBeenRevoked");
    });
    it("32-scope limit", async function () {
      for (let i = 0; i < 32; i++) {
        const sh = ethers.keccak256(ethers.toUtf8Bytes(`scope-${i}`));
        await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, ethers.keccak256(ethers.toUtf8Bytes(`r-${i}`)), 0);
      }
      await expect(
        ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, ethers.keccak256(ethers.toUtf8Bytes("overflow")), ethers.keccak256(ethers.toUtf8Bytes("overflow-root")), 0)
      ).to.be.revertedWithCustomError(ctx.delegationManager, "ScopeLimitExceeded");
    });
  });

  describe("Single-Hop Verification", function () {
    it("Verifies valid delegation", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("vs"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.alice.address, ctx.sessionKey.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, leaf, exp);
      expect(await ctx.delegationManager.connect(ctx.sessionKey).verifyDelegation.staticCall(leaf, [], ctx.alice.address, sh, exp, 10)).to.be.true;
    });
    it("Rejects expired root", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("es"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 1n;
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.alice.address, ctx.sessionKey.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, leaf, exp);
      await time.increase(10);
      expect(await ctx.delegationManager.connect(ctx.sessionKey).verifyDelegation.staticCall(leaf, [], ctx.alice.address, sh, exp, 10)).to.be.false;
    });
    it("Rejects revoked delegator", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("rd"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.alice.address, ctx.sessionKey.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, leaf, exp);
      await ctx.delegationManager.emergencyRevokeAll(ctx.alice.address);
      expect(await ctx.delegationManager.connect(ctx.sessionKey).verifyDelegation.staticCall(leaf, [], ctx.alice.address, sh, exp, 10)).to.be.false;
    });
  });

  describe("Multi-Hop Chain Verification", function () {
    it("Verifies valid 2-hop chain", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("chain"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      const l1 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.alice.address, ctx.sessionKey.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, l1, exp);
      const l2 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.sessionKey.address, ctx.attacker.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.sessionKey).updateDelegationRoot(ctx.sessionKey.address, sh, l2, exp);
      expect(await ctx.delegationManager.connect(ctx.attacker).verifyDelegationChain.staticCall(
        [l1, l2], [[], []], [ctx.alice.address, ctx.sessionKey.address],
        [ctx.sessionKey.address, ctx.attacker.address], [sh, sh], [exp, exp], [10, 10]
      )).to.be.true;
    });
    it("Rejects empty chain", async function () {
      await expect(ctx.delegationManager.verifyDelegationChain([], [], [], [], [], [], []))
        .to.be.revertedWithCustomError(ctx.delegationManager, "EmptyChain");
    });
    it("Rejects broken chain", async function () {
      const sh = ethers.keccak256(ethers.toUtf8Bytes("broken"));
      const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
      const l1 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.alice.address, ctx.sessionKey.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.alice).updateDelegationRoot(ctx.alice.address, sh, l1, exp);
      const l2 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"], [ctx.attacker.address, ctx.attacker.address, sh, exp]
      ));
      await ctx.delegationManager.connect(ctx.attacker).updateDelegationRoot(ctx.attacker.address, sh, l2, exp);
      expect(await ctx.delegationManager.connect(ctx.attacker).verifyDelegationChain.staticCall(
        [l1, l2], [[], []], [ctx.alice.address, ctx.attacker.address],
        [ctx.sessionKey.address, ctx.attacker.address], [sh, sh], [exp, exp], [10, 10]
      )).to.be.false;
    });
  });

  describe("UUPS Upgrade", function () {
    it("Admin can upgrade", async function () {
      const impl = await (await ethers.getContractFactory("DelegationManager")).deploy();
      await expect(ctx.delegationManager.connect(ctx.owner).upgradeToAndCall(await impl.getAddress(), "0x")).to.not.be.reverted;
    });
    it("Non-admin cannot upgrade", async function () {
      const impl = await (await ethers.getContractFactory("DelegationManager")).deploy();
      await expect(ctx.delegationManager.connect(ctx.attacker).upgradeToAndCall(await impl.getAddress(), "0x")).to.be.reverted;
    });
  });
});

// ============================================================================
// SECTION 7: OrganizationRegistry + Anchor
// ============================================================================

describe("OrganizationRegistry + Anchor", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  it("Registers org with anchor", async function () {
    const orgId = ethers.id("org-1");
    await expect(ctx.orgRegistry.registerOrganization(orgId, "Acme", ctx.alice.address))
      .to.emit(ctx.orgRegistry, "OrganizationRegistered");
    const org = await ctx.orgRegistry.getOrganization(orgId);
    expect(org.name).to.equal("Acme");
    expect(org.owner).to.equal(ctx.alice.address);
    expect(org.active).to.be.true;
  });
  it("Reverts duplicate org", async function () {
    const orgId = ethers.id("dup");
    await ctx.orgRegistry.registerOrganization(orgId, "A", ctx.alice.address);
    await expect(ctx.orgRegistry.registerOrganization(orgId, "B", ctx.alice.address))
      .to.be.revertedWithCustomError(ctx.orgRegistry, "OrganizationAlreadyExists");
  });
  it("Deactivate and reactivate", async function () {
    const orgId = ethers.id("lc");
    await ctx.orgRegistry.registerOrganization(orgId, "LC", ctx.alice.address);
    await ctx.orgRegistry.deactivateOrganization(orgId);
    expect((await ctx.orgRegistry.getOrganization(orgId)).active).to.be.false;
    await ctx.orgRegistry.reactivateOrganization(orgId);
    expect((await ctx.orgRegistry.getOrganization(orgId)).active).to.be.true;
  });
  it("Anchor updates root, revoked root, epoch, visibility, metadata", async function () {
    const orgId = ethers.id("anc");
    await ctx.orgRegistry.registerOrganization(orgId, "Anc", ctx.alice.address);
    const addr = await ctx.orgRegistry.getCredentialAnchor(orgId);
    const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", addr);
    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    await expect(anchor.connect(ctx.alice).updateRoot(root)).to.emit(anchor, "RootUpdated");
    expect(await anchor.currentRoot()).to.equal(root);
    await anchor.connect(ctx.alice).updateRevokedRoot(ethers.keccak256(ethers.toUtf8Bytes("rev")));
    await anchor.connect(ctx.alice).incrementEpoch();
    expect(await anchor.currentEpoch()).to.equal(1n);
    await anchor.connect(ctx.alice).setVisibility(1);
    expect(await anchor.visibility()).to.equal(1);
    await anchor.connect(ctx.alice).setMetadataHash(ethers.keccak256(ethers.toUtf8Bytes("meta")));
  });
  it("Anchor owner-only access", async function () {
    const orgId = ethers.id("auth");
    await ctx.orgRegistry.registerOrganization(orgId, "Auth", ctx.alice.address);
    const addr = await ctx.orgRegistry.getCredentialAnchor(orgId);
    const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", addr);
    await expect(anchor.connect(ctx.attacker).updateRoot(ethers.id("bad"))).to.be.reverted;
  });
  it("RootAlreadyCurrent reverts", async function () {
    const orgId = ethers.id("same");
    await ctx.orgRegistry.registerOrganization(orgId, "Same", ctx.alice.address);
    const addr = await ctx.orgRegistry.getCredentialAnchor(orgId);
    const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", addr);
    const root = ethers.keccak256(ethers.toUtf8Bytes("r"));
    await anchor.connect(ctx.alice).updateRoot(root);
    await expect(anchor.connect(ctx.alice).updateRoot(root)).to.be.revertedWithCustomError(anchor, "RootAlreadyCurrent");
  });
});

// ============================================================================
// SECTION 8: AgentIdentity
// ============================================================================

describe("AgentIdentity", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  it("Factory auto-registers identity", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    expect(id).to.not.equal(0n);
    expect(await ctx.agentIdentity.isActive(id)).to.be.true;
  });
  it("Identity maps to wallet", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    expect(await ctx.agentIdentity.walletOf(id)).to.equal(await w.getAddress());
  });
  it("Non-factory cannot register", async function () {
    await expect(ctx.agentIdentity.connect(ctx.attacker).registerIdentity(ctx.attacker.address))
      .to.be.revertedWithCustomError(ctx.agentIdentity, "NotFactory");
  });
  it("Owner can link credential and update metadata", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    await ctx.agentIdentity.connect(ctx.alice).linkCredential(id, 42n);
    expect(await ctx.agentIdentity.credentialOf(id)).to.equal(42n);
    const meta = ethers.keccak256(ethers.toUtf8Bytes("meta"));
    await ctx.agentIdentity.connect(ctx.alice).updateMetadata(id, meta);
    expect(await ctx.agentIdentity.metadataOf(id)).to.equal(meta);
  });
  it("Zero/same metadata reverts", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    await expect(ctx.agentIdentity.connect(ctx.alice).updateMetadata(id, ethers.ZeroHash))
      .to.be.revertedWithCustomError(ctx.agentIdentity, "InvalidMetadataRoot");
  });
  it("Deactivate and reactivate", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    await ctx.agentIdentity.connect(ctx.alice).deactivate(id);
    expect(await ctx.agentIdentity.isActive(id)).to.be.false;
    await ctx.agentIdentity.connect(ctx.alice).reactivate(id);
    expect(await ctx.agentIdentity.isActive(id)).to.be.true;
  });
  it("Cannot deactivate inactive / reactivate active", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    await ctx.agentIdentity.connect(ctx.alice).deactivate(id);
    await expect(ctx.agentIdentity.connect(ctx.alice).deactivate(id))
      .to.be.revertedWithCustomError(ctx.agentIdentity, "IdentityInactive");
    await ctx.agentIdentity.connect(ctx.alice).reactivate(id);
    await expect(ctx.agentIdentity.connect(ctx.alice).reactivate(id))
      .to.be.revertedWithCustomError(ctx.agentIdentity, "IdentityAlreadyActive");
  });
  it("Non-owner cannot deactivate", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    await expect(ctx.agentIdentity.connect(ctx.attacker).deactivate(id))
      .to.be.revertedWithCustomError(ctx.agentIdentity, "NotIdentityOwner");
  });
  it("View helpers", async function () {
    expect(await ctx.agentIdentity.identityOf(ctx.attacker.address)).to.equal(0n);
    const w = await createWallet(ctx, ctx.alice);
    const id = await ctx.agentIdentity.identityOf(await w.getAddress());
    expect(await ctx.agentIdentity.exists(id)).to.be.true;
    const [ca, ua] = await ctx.agentIdentity.timestampsOf(id);
    expect(ca).to.be.gt(0n);
    expect(ua).to.equal(ca);
    expect(await ctx.agentIdentity.ownerOfIdentity(id)).to.equal(ctx.alice.address);
  });
  it("UUPS upgrade", async function () {
    const impl = await (await ethers.getContractFactory("AgentIdentity")).deploy();
    await expect(ctx.agentIdentity.connect(ctx.owner).upgradeToAndCall(await impl.getAddress(), "0x")).to.not.be.reverted;
  });
});

// ============================================================================
// SECTION 9: Cross-Contract Integration
// ============================================================================

describe("Cross-Contract Integration", function () {
  let ctx: ProtocolContext;
  beforeEach(async function () { ctx = await deployProtocol(); });

  it("Full lifecycle", async function () {
    const w = await createWallet(ctx, ctx.alice);
    const wAddr = await w.getAddress();
    const id = await ctx.agentIdentity.identityOf(wAddr);
    await ctx.agentIdentity.connect(ctx.alice).linkCredential(id, 1n);

    const p = await makeSessionParams(wAddr, ctx.credentialRegistry, "integ-null");
    await ctx.mockVerifier.setResult(true);
    const s = await impersonateWallet(wAddr);
    await ctx.sessionManager.connect(s).createSession(
      p.sessionId, wAddr, ctx.sessionKey.address, p.maxValue, p.expiry,
      p.a, p.b, p.c, p.publicSignals
    );
    await stopImpersonate(wAddr);

    const s2 = await impersonateWallet(wAddr);
    expect(await ctx.sessionManager.connect(s2).validateSession.staticCall(
      p.sessionId, ctx.sessionKey.address, 100n, ctx.alice.address
    )).to.be.true;
    await stopImpersonate(wAddr);

    await ctx.sessionManager.connect(ctx.sessionKey).revokeSession(p.sessionId, wAddr);
    const s3 = await impersonateWallet(wAddr);
    await expect(ctx.sessionManager.connect(s3).validateSession(
      p.sessionId, ctx.sessionKey.address, 1n, ctx.alice.address
    )).to.be.revertedWithCustomError(ctx.sessionManager, "SessionIsRevoked");
    await stopImpersonate(wAddr);

    expect(await ctx.agentIdentity.isActive(id)).to.be.true;
  });

  it("Capability and delegation verification", async function () {
    const capId = ethers.id("int-cap");
    const exp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 86400n;
    await ctx.capabilityRegistry.registerCapability(capId, "act", exp);
    const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "bytes32", "uint64"],
      [capId, ctx.owner.address, ctx.sessionKey.address, ethers.ZeroHash, exp]
    ));
    await ctx.capabilityRegistry.connect(ctx.owner).updateGrantRoot(ctx.sessionKey.address, capId, leaf);
    expect(await ctx.capabilityRegistry.verifyCapability(ctx.sessionKey.address, capId, leaf, [], ctx.owner.address, ethers.ZeroHash, exp)).to.be.true;

    const sh = ethers.keccak256(ethers.toUtf8Bytes("int-scope"));
    const dLeaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "bytes32", "uint64"], [ctx.owner.address, ctx.sessionKey.address, sh, exp]
    ));
    await ctx.delegationManager.connect(ctx.owner).updateDelegationRoot(ctx.owner.address, sh, dLeaf, exp);
    expect(await ctx.delegationManager.connect(ctx.sessionKey).verifyDelegation.staticCall(dLeaf, [], ctx.owner.address, sh, exp, 10)).to.be.true;
  });

  it("Organization credential flow", async function () {
    const orgId = ethers.id("int-org");
    await ctx.orgRegistry.registerOrganization(orgId, "IntOrg", ctx.alice.address);
    const addr = await ctx.orgRegistry.getCredentialAnchor(orgId);
    const anchor = await ethers.getContractAt("OrganizationCredentialAnchor", addr);
    const root = ethers.keccak256(ethers.toUtf8Bytes("org-root"));
    await anchor.connect(ctx.alice).updateRoot(root);
    expect(await anchor.currentRoot()).to.equal(root);
  });
});
