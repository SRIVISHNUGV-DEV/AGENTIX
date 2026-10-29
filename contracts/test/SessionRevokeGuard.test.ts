import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/// @notice C-2 + C-7 regression tests.
///         C-2: revokeSession/revokeLightweightSession must bind the `wallet` parameter to the
///         session — previously any factory-wallet owner could permanently revoke anyone's
///         session by passing their own wallet.
///         C-7: revocation must work while paused (kill-switch); validation stays paused.
describe("SessionRevokeGuard (C-2, C-7)", function () {
  let sessionManager: any;
  let credentialRegistry: any;
  let factory: any;
  let walletAddr: string;
  let attackerWalletAddr: string;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let attacker: SignerWithAddress;
  let alice: SignerWithAddress;

  const DAILY_SPEND = ethers.parseEther("1");
  const DAILY_TX = 10n;

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

  /// Sets registry roots via the 2-day timelock (C-5).
  async function setRoots(activeRoot: string, revokedRoot: string) {
    await credentialRegistry.proposeActiveRoot(activeRoot);
    await credentialRegistry.proposeRevokedSecretRoot(revokedRoot);
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await credentialRegistry.acceptActiveRoot();
    await credentialRegistry.acceptRevokedSecretRoot();
  }

  async function createLightweight(sessionId: string) {
    const id = ethers.id(sessionId);
    const expiry = await getExpiry();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const smAddr = await sessionManager.getAddress();
    const messageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint256", "address[]"],
        [chainId, smAddr, walletAddr, id, sessionKey.address, DAILY_SPEND, DAILY_TX, expiry, []]
      )
    );
    const sig = await owner.signMessage(ethers.getBytes(messageHash));
    const w = await impersonate(walletAddr);
    await sessionManager.connect(w).createLightweightSession(
      id, sessionKey.address, DAILY_SPEND, DAILY_TX, expiry, [], sig
    );
    await stopImpersonate(walletAddr);
    return id;
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

  beforeEach(async function () {
    [owner, sessionKey, attacker, alice] = await ethers.getSigners();
    const entryPointAddr = ethers.Wallet.createRandom().address;

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

    walletAddr = await factory.createWallet.staticCall(owner.address);
    await factory.createWallet(owner.address);
    attackerWalletAddr = await factory.createWallet.staticCall(attacker.address);
    await factory.createWallet(attacker.address);
  });

  it("C-2 standard: attacker owning another wallet CANNOT revoke the victim session", async function () {
    const id = await createStandard("c2-std", 1000n);
    await expect(
      sessionManager.connect(attacker).revokeSession(id, attackerWalletAddr)
    ).to.be.revertedWithCustomError(sessionManager, "NotAuthorizedToRevoke");
    expect((await sessionManager.sessions(id)).revoked).to.equal(false);
  });

  it("C-2 lightweight: attacker owning another wallet CANNOT revoke the victim session", async function () {
    const id = await createLightweight("c2-light");
    await expect(
      sessionManager.connect(attacker).revokeLightweightSession(id, attackerWalletAddr)
    ).to.be.revertedWithCustomError(sessionManager, "NotAuthorizedToRevoke");
    expect((await sessionManager.getLightSession(id)).revoked).to.equal(false);
  });

  it("C-2: even the session key must pass the CORRECT wallet", async function () {
    const id = await createStandard("c2-key-wrong-wallet", 1000n);
    await expect(
      sessionManager.connect(sessionKey).revokeSession(id, attackerWalletAddr)
    ).to.be.revertedWithCustomError(sessionManager, "NotAuthorizedToRevoke");
  });

  it("C-2 positive: owner and session key CAN revoke with the correct wallet", async function () {
    const idStd = await createStandard("c2-std-ok", 1000n);
    await sessionManager.connect(owner).revokeSession(idStd, walletAddr);
    expect((await sessionManager.sessions(idStd)).revoked).to.equal(true);
    const idLight = await createLightweight("c2-light-ok");
    await sessionManager.connect(sessionKey).revokeLightweightSession(idLight, walletAddr);
    expect((await sessionManager.getLightSession(idLight)).revoked).to.equal(true);
  });

  it("C-7: revokeSession and revokeLightweightSession work WHILE PAUSED", async function () {
    const idStd = await createStandard("c7-std", 1000n);
    const idLight = await createLightweight("c7-light");
    await sessionManager.pause();
    await sessionManager.connect(sessionKey).revokeSession(idStd, walletAddr);
    expect((await sessionManager.sessions(idStd)).revoked).to.equal(true);
    await sessionManager.connect(sessionKey).revokeLightweightSession(idLight, walletAddr);
    expect((await sessionManager.getLightSession(idLight)).revoked).to.equal(true);
  });

  it("C-7 sanity: validation still reverts while paused", async function () {
    const id = await createLightweight("c7-validate-paused");
    await sessionManager.pause();
    const w = await impersonate(walletAddr);
    await expect(
      sessionManager.connect(w).validateLightweightSession(id, sessionKey.address, 0n, alice.address, "0x")
    ).to.be.revertedWithCustomError(sessionManager, "EnforcedPause");
    await stopImpersonate(walletAddr);
  });
});
