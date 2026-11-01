import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/// @notice C-1 regression tests: session spend limits must cover token transfers, not just ETH value.
///         A session key must NOT be able to drain ERC-20/721 tokens or the EntryPoint deposit
///         regardless of maxValue — even maxValue = 0. Token selectors require an allowlisted
///         target; protocol targets (wallet, SessionManager, registry, DelegationManager,
///         EntryPoint) are denied outright. The owner path is unaffected by these denials.
describe("SessionTokenGuard (C-1)", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let delegationManager: any;
  let factory: any;
  let wallet: any;
  let walletAddr: string;
  let entryPointAddr: string;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const DAILY_SPEND = ethers.parseEther("1");
  const DAILY_TX = 10n;
  const TOKEN_IFACE = new ethers.Interface([
    "function transfer(address,uint256)",
    "function approve(address,uint256)",
    "function transferFrom(address,address,uint256)",
    "function safeTransferFrom(address,address,uint256)",
  ]);
  const ENTRYPOINT_IFACE = new ethers.Interface([
    "function withdrawTo(address,uint256)",
  ]);

  async function impersonate(addr: string) {
    await ethers.provider.send("hardhat_setBalance", [addr, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [addr]);
    return ethers.getSigner(addr);
  }
  async function stopImpersonate(addr: string) {
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [addr]);
  }
  async function getExpiry(daysAhead = 30): Promise<bigint> {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block!.timestamp) + BigInt(daysAhead * 24 * 60 * 60);
  }

  async function createLightweight(
    sessionId: string,
    targets: string[],
    spendLimit: bigint = DAILY_SPEND,
    txLimit: bigint = DAILY_TX
  ) {
    const id = ethers.id(sessionId);
    const expiry = await getExpiry();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const smAddr = await sessionManager.getAddress();
    const messageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256", "address[]"],
        [chainId, smAddr, walletAddr, id, sessionKey.address, spendLimit, txLimit, expiry, targets]
      )
    );
    const sig = await owner.signMessage(ethers.getBytes(messageHash));
    const w = await impersonate(walletAddr);
    await sessionManager.connect(w).createLightweightSession(
      id, sessionKey.address, spendLimit, txLimit, expiry, targets, sig
    );
    await stopImpersonate(walletAddr);
    return id;
  }

  /// Sets registry roots via the 2-day timelock (C-5).
  async function setRoots(activeRoot: string, revokedRoot: string) {
    await credentialRegistry.proposeActiveRoot(activeRoot);
    await credentialRegistry.proposeRevokedSecretRoot(revokedRoot);
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await credentialRegistry.acceptActiveRoot();
    await credentialRegistry.acceptRevokedSecretRoot();
  }

  async function createStandard(sessionId: string, maxValue: bigint) {
    const id = ethers.id(sessionId);
    const expiry = await getExpiry();
    const activeRoot = ethers.id("active-root");
    const revokedRoot = ethers.id("revoked-root");
    const nullifier = ethers.id(`nullifier-${sessionId}`);
    await setRoots(activeRoot, revokedRoot);
    const publicSignals = [
      BigInt(activeRoot), BigInt(revokedRoot), maxValue, expiry,
      BigInt(walletAddr), 1n, BigInt(nullifier),
    ];
    const w = await impersonate(walletAddr);
    await sessionManager.connect(w).createSession(
      id, walletAddr, sessionKey.address, maxValue, expiry,
      [0, 0], [[0, 0], [0, 0]], [0, 0], publicSignals
    );
    await stopImpersonate(walletAddr);
    return id;
  }

  async function validateLight(id: string, value: bigint, target: string, data: string) {
    const w = await impersonate(walletAddr);
    try {
      return await sessionManager.connect(w).validateLightweightSession(
        id, sessionKey.address, value, target, data
      );
    } finally {
      await stopImpersonate(walletAddr);
    }
  }
  async function validateStd(id: string, value: bigint, target: string, data: string) {
    const w = await impersonate(walletAddr);
    try {
      return await sessionManager.connect(w).validateSession(
        id, sessionKey.address, value, target, data
      );
    } finally {
      await stopImpersonate(walletAddr);
    }
  }
  async function expectValidateLightRevert(id: string, value: bigint, target: string, data: string, err: string) {
    const w = await impersonate(walletAddr);
    try {
      await expect(
        sessionManager.connect(w).validateLightweightSession(id, sessionKey.address, value, target, data)
      ).to.be.revertedWithCustomError(sessionManager, err);
    } finally {
      await stopImpersonate(walletAddr);
    }
  }
  async function expectValidateStdRevert(id: string, value: bigint, target: string, data: string, err: string) {
    const w = await impersonate(walletAddr);
    try {
      await expect(
        sessionManager.connect(w).validateSession(id, sessionKey.address, value, target, data)
      ).to.be.revertedWithCustomError(sessionManager, err);
    } finally {
      await stopImpersonate(walletAddr);
    }
  }

  /// Builds a session-signed UserOp for wallet.execute(target, value, data) and runs validateUserOp
  /// from the impersonated EntryPoint. Returns the tx promise (do NOT await before expect()).
  /// Note: impersonation is intentionally left on here — each test redeploys fresh addresses,
  /// and stopping impersonation in a finally would race the in-flight tx.
  async function validateUserOpAsSession(target: string, value: bigint, data: string, sessionId: string) {
    const callData = wallet.interface.encodeFunctionData("execute", [target, value, data]);
    const userOpHash = ethers.id(`op-${sessionId}-${target}-${Date.now()}`);
    const sig = await sessionKey.signMessage(ethers.getBytes(userOpHash));
    const signature = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes"], [sessionId, sig]
    );
    const userOp = {
      sender: walletAddr, nonce: 0, initCode: "0x", callData,
      accountGasLimits: ethers.ZeroHash, preVerificationGas: 0,
      gasFees: ethers.ZeroHash, paymasterAndData: "0x", signature,
    };
    const ep = await impersonate(entryPointAddr);
    return wallet.connect(ep).validateUserOp(userOp, userOpHash, 0);
  }

  beforeEach(async function () {
    [owner, sessionKey, attacker, alice, bob] = await ethers.getSigners();
    entryPointAddr = ethers.Wallet.createRandom().address;

    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifierFactory.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    credentialRegistry = await ethers.getContractAt("CredentialRegistry", await credRegProxy.getAddress());

    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await WalletImpl.deploy();

    const placeholderAddr = "0x0000000000000000000000000000000000000001";
    const SessMgrImpl = await ethers.getContractFactory("SessionManager");
    const sessMgrImpl = await SessMgrImpl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await sessMgrImpl.getAddress(),
      sessMgrImpl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(), await credentialRegistry.getAddress(), placeholderAddr,
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(), await sessionManager.getAddress(), entryPointAddr,
      ])
    );
    factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());

    await sessionManager.proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.acceptWalletFactory();
    await credentialRegistry.setSessionManager(await sessionManager.getAddress(), true);

    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const delMgrImpl = await DelMgrImpl.deploy();
    const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const delMgrProxy = await DelMgrProxy.deploy(
      await delMgrImpl.getAddress(),
      delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delegationManager = await ethers.getContractAt("DelegationManager", await delMgrProxy.getAddress());
    await sessionManager.setDelegationManager(await delegationManager.getAddress());

    walletAddr = await factory.createWallet.staticCall(owner.address);
    await factory.createWallet(owner.address);
    wallet = await ethers.getContractAt("AgentWallet", walletAddr);
  });

  it("lightweight, no allowlist: ERC-20 transfer is DENIED even with value 0", async function () {
    const id = await createLightweight("c1-noallow-transfer", []);
    const data = TOKEN_IFACE.encodeFunctionData("transfer", [attacker.address, 1000n]);
    await expectValidateLightRevert(id, 0n, alice.address, data, "TargetNotAllowed");
  });

  it("lightweight, no allowlist: approve / transferFrom / safeTransferFrom are DENIED", async function () {
    const id = await createLightweight("c1-noallow-selectors", []);
    const datas = [
      TOKEN_IFACE.encodeFunctionData("approve", [attacker.address, ethers.MaxUint256]),
      TOKEN_IFACE.encodeFunctionData("transferFrom", [walletAddr, attacker.address, 1000n]),
      TOKEN_IFACE.encodeFunctionData("safeTransferFrom", [walletAddr, attacker.address, 1n]),
    ];
    for (const data of datas) {
      await expectValidateLightRevert(id, 0n, alice.address, data, "TargetNotAllowed");
    }
  });

  it("lightweight, token allowlisted: transfer to the allowlisted target SUCCEEDS, others DENIED", async function () {
    const id = await createLightweight("c1-allow-transfer", [alice.address]);
    const data = TOKEN_IFACE.encodeFunctionData("transfer", [attacker.address, 1000n]);
    await validateLight(id, 0n, alice.address, data);
    await expectValidateLightRevert(id, 0n, bob.address, data, "TargetNotAllowed");
  });

  it("lightweight, no allowlist: plain ETH call (empty data) still SUCCEEDS", async function () {
    const id = await createLightweight("c1-plain-eth", []);
    await validateLight(id, ethers.parseEther("0.1"), alice.address, "0x");
  });

  it("lightweight, allowlisted: non-token call to a non-allowlisted target is DENIED", async function () {
    const id = await createLightweight("c1-allow-nontoken", [alice.address]);
    await expectValidateLightRevert(id, 0n, bob.address, "0x", "TargetNotAllowed");
  });

  it("standard, no allowlist: token drain DENIED even with maxValue 0; allowlisting re-enables it", async function () {
    const id = await createStandard("c1-std", 0n);
    const data = TOKEN_IFACE.encodeFunctionData("transfer", [attacker.address, 1000n]);
    await expectValidateStdRevert(id, 0n, alice.address, data, "TargetNotAllowed");
    const w = await impersonate(walletAddr);
    await sessionManager.connect(w).setSessionTargets(id, [alice.address]);
    await stopImpersonate(walletAddr);
    await validateStd(id, 0n, alice.address, data);
  });

  it("standard: setSessionTargets rejects zero addresses and non-wallet callers", async function () {
    const id = await createStandard("c1-std-setter", 1000n);
    const w = await impersonate(walletAddr);
    await expect(
      sessionManager.connect(w).setSessionTargets(id, [ethers.ZeroAddress])
    ).to.be.revertedWithCustomError(sessionManager, "TargetNotAllowed");
    await stopImpersonate(walletAddr);
    await expect(
      sessionManager.connect(attacker).setSessionTargets(id, [alice.address])
    ).to.be.revertedWithCustomError(sessionManager, "NotBoundWallet");
  });

  it("denied targets beat the allowlist: wallet, SessionManager, registry, DelegationManager", async function () {
    const smAddr = await sessionManager.getAddress();
    const regAddr = await credentialRegistry.getAddress();
    const delAddr = await delegationManager.getAddress();
    const id = await createLightweight(
      "c1-denied", [walletAddr, smAddr, regAddr, delAddr]
    );
    for (const target of [walletAddr, smAddr, regAddr, delAddr]) {
      await expectValidateLightRevert(id, 0n, target, "0x", "TargetNotAllowed");
    }
  });

  it("wallet-level: session UserOp to the EntryPoint (deposit drain) is DENIED", async function () {
    const id = await createLightweight("c1-ep-drain", []);
    const data = ENTRYPOINT_IFACE.encodeFunctionData("withdrawTo", [attacker.address, 1000n]);
    await expect(
      validateUserOpAsSession(entryPointAddr, 0n, data, id)
    ).to.be.revertedWithCustomError(wallet, "SessionTargetDenied");
  });

  it("wallet-level: session UserOp token drain with no allowlist is DENIED", async function () {
    const id = await createLightweight("c1-wallet-drain", []);
    const data = TOKEN_IFACE.encodeFunctionData("transfer", [attacker.address, 1000n]);
    await expect(
      validateUserOpAsSession(alice.address, 0n, data, id)
    ).to.be.revertedWithCustomError(sessionManager, "TargetNotAllowed");
  });

  it("wallet-level: owner UserOp to the EntryPoint is UNAFFECTED (owner path has no session denials)", async function () {
    const data = ENTRYPOINT_IFACE.encodeFunctionData("withdrawTo", [owner.address, 1000n]);
    const callData = wallet.interface.encodeFunctionData("execute", [entryPointAddr, 0n, data]);
    const userOpHash = ethers.id("owner-op");
    const sig = await owner.signMessage(ethers.getBytes(userOpHash));
    const userOp = {
      sender: walletAddr, nonce: 0, initCode: "0x", callData,
      accountGasLimits: ethers.ZeroHash, preVerificationGas: 0,
      gasFees: ethers.ZeroHash, paymasterAndData: "0x", signature: sig,
    };
    const ep = await impersonate(entryPointAddr);
    await wallet.connect(ep).validateUserOp(userOp, userOpHash, 0);
    await stopImpersonate(entryPointAddr);
  });

  it("ETH limits still enforced after the change (lightweight daily spend)", async function () {
    const id = await createLightweight("c1-eth-limit", []);
    await expectValidateLightRevert(
      id, ethers.parseEther("2"), alice.address, "0x", "DailySpendLimitExceeded"
    );
  });
});
