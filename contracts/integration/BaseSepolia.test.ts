import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// AGENTIX V1 — BASE SEPOLIA INTEGRATION VERIFICATION
// ============================================================================
// Runs against live Base Sepolia deployment.
// Verifies: deployment, initialization, permissions, wiring, clones, ERC-4337.
// ============================================================================

const OUTPUT_PATH = path.join(__dirname, "..", "deploy-output.json");

function loadDeployment() {
  if (!fs.existsSync(OUTPUT_PATH)) throw new Error("deploy-output.json not found");
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
}

describe("═══════════════════════════════════════════════════════", function () {
  it("══════ AGENTIX V1 — BASE SEPOLIA VERIFICATION ══════", function () {});
});

// ─────────────────────────────────────────────────────────
// SECTION 1: Deployment Verification
// ─────────────────────────────────────────────────────────

describe("1. Deployment Verification", function () {
  let d: any;
  before(() => { d = loadDeployment().contracts; });

  it("Groth16Verifier has code", async function () {
    const code = await ethers.provider.getCode(d.groth16Verifier);
    expect(code.length).to.be.greaterThan(2);
  });

  it("CredentialRegistry proxy has code", async function () {
    const code = await ethers.provider.getCode(d.credentialRegistry.proxy);
    expect(code.length).to.be.greaterThan(2);
  });

  it("CredentialRegistry impl has code", async function () {
    const code = await ethers.provider.getCode(d.credentialRegistry.implementation);
    expect(code.length).to.be.greaterThan(2);
  });

  it("OrganizationCredentialAnchor impl has code", async function () {
    const code = await ethers.provider.getCode(d.organizationCredentialAnchor);
    expect(code.length).to.be.greaterThan(2);
  });

  it("OrganizationRegistry proxy has code", async function () {
    const code = await ethers.provider.getCode(d.organizationRegistry.proxy);
    expect(code.length).to.be.greaterThan(2);
  });

  it("SessionManager proxy has code", async function () {
    const code = await ethers.provider.getCode(d.sessionManager.proxy);
    expect(code.length).to.be.greaterThan(2);
  });

  it("AgentWallet impl has code", async function () {
    const code = await ethers.provider.getCode(d.agentWalletImplementation);
    expect(code.length).to.be.greaterThan(2);
  });

  it("AgentWalletFactory proxy has code", async function () {
    const code = await ethers.provider.getCode(d.agentWalletFactory.proxy);
    expect(code.length).to.be.greaterThan(2);
  });

  it("CapabilityRegistry proxy has code", async function () {
    const code = await ethers.provider.getCode(d.capabilityRegistry.proxy);
    expect(code.length).to.be.greaterThan(2);
  });

  it("DelegationManager proxy has code", async function () {
    const code = await ethers.provider.getCode(d.delegationManager.proxy);
    expect(code.length).to.be.greaterThan(2);
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 2: Initialization Verification
// ─────────────────────────────────────────────────────────

describe("2. Initialization Verification", function () {
  let d: any;
  let deployer: string;
  before(async () => {
    d = loadDeployment().contracts;
    deployer = loadDeployment().deployer;
  });

  it("CredentialRegistry owner is deployer", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    expect(await cr.owner()).to.equal(deployer);
  });

  it("CredentialRegistry issuer is deployer", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    expect(await cr.issuers(deployer)).to.equal(true);
  });

  it("OrganizationRegistry owner is deployer", async function () {
    const org = await ethers.getContractAt("OrganizationRegistry", d.organizationRegistry.proxy);
    expect(await org.owner()).to.equal(deployer);
  });

  it("SessionManager owner is deployer", async function () {
    const sm = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);
    expect(await sm.owner()).to.equal(deployer);
  });

  it("SessionManager verifier is set", async function () {
    const sm = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);
    const v = await sm.verifier();
    expect(v.toLowerCase()).to.equal(d.groth16Verifier.toLowerCase());
  });

  it("SessionManager registry is set", async function () {
    const sm = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);
    const r = await sm.registry();
    expect(r.toLowerCase()).to.equal(d.credentialRegistry.proxy.toLowerCase());
  });

  it("AgentWalletFactory owner is deployer", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    expect(await fac.owner()).to.equal(deployer);
  });

  it("AgentWalletFactory implementation is set", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const impl = await fac.implementation();
    expect(impl.toLowerCase()).to.equal(d.agentWalletImplementation.toLowerCase());
  });

  it("AgentWalletFactory sessionManager is set", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const sm = await fac.sessionManager();
    expect(sm.toLowerCase()).to.equal(d.sessionManager.proxy.toLowerCase());
  });

  it("AgentWalletFactory entryPoint is set", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const ep = await fac.entryPoint();
    expect(ep.toLowerCase()).to.equal(d.entryPoint.toLowerCase());
  });

  it("CapabilityRegistry owner is deployer", async function () {
    const cap = await ethers.getContractAt("CapabilityRegistry", d.capabilityRegistry.proxy);
    expect(await cap.owner()).to.equal(deployer);
  });

  it("DelegationManager deployer has DEFAULT_ADMIN_ROLE", async function () {
    const del = await ethers.getContractAt("DelegationManager", d.delegationManager.proxy);
    const DEFAULT_ADMIN = ethers.ZeroHash;
    expect(await del.hasRole(DEFAULT_ADMIN, deployer)).to.equal(true);
  });

  it("DelegationManager deployer has ROOT_UPDATER_ROLE", async function () {
    const del = await ethers.getContractAt("DelegationManager", d.delegationManager.proxy);
    const ROOT_UPDATER = ethers.keccak256(ethers.toUtf8Bytes("ROOT_UPDATER_ROLE"));
    expect(await del.hasRole(ROOT_UPDATER, deployer)).to.equal(true);
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 3: CredentialRegistry Wiring
// ─────────────────────────────────────────────────────────

describe("3. CredentialRegistry Wiring", function () {
  let d: any;
  before(() => { d = loadDeployment().contracts; });

  it("SessionManager is registered in CredentialRegistry", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    expect(await cr.sessionManagers(d.sessionManager.proxy)).to.equal(true);
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 4: UUPS Upgrade Verification
// ─────────────────────────────────────────────────────────

describe("4. UUPS Upgrade Verification", function () {
  let d: any;
  let deployer: SignerWithAddress;
  let attacker: SignerWithAddress;
  before(async () => {
    d = loadDeployment().contracts;
    [deployer, attacker] = await ethers.getSigners();
  });

  it("CredentialRegistry: re-initialize reverts", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    await expect(
      cr.initialize(attacker.address)
    ).to.be.revertedWithCustomError(cr, "InvalidInitialization");
  });

  it("SessionManager: re-initialize reverts", async function () {
    const sm = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);
    await expect(
      sm.initialize(d.groth16Verifier, d.credentialRegistry.proxy, d.agentWalletFactory.proxy)
    ).to.be.revertedWithCustomError(sm, "InvalidInitialization");
  });

  it("AgentWalletFactory: re-initialize reverts", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await expect(
      fac.initialize(d.agentWalletImplementation, d.sessionManager.proxy, d.entryPoint)
    ).to.be.revertedWithCustomError(fac, "InvalidInitialization");
  });

  it("CapabilityRegistry: re-initialize reverts", async function () {
    const cap = await ethers.getContractAt("CapabilityRegistry", d.capabilityRegistry.proxy);
    await expect(
      cap.initialize(attacker.address)
    ).to.be.revertedWithCustomError(cap, "InvalidInitialization");
  });

  it("DelegationManager: re-initialize reverts", async function () {
    const del = await ethers.getContractAt("DelegationManager", d.delegationManager.proxy);
    await expect(
      del.initialize(attacker.address)
    ).to.be.revertedWithCustomError(del, "InvalidInitialization");
  });

  it("CredentialRegistry impl: initialize on impl reverts", async function () {
    const crImpl = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.implementation);
    await expect(
      crImpl.initialize(deployer.address)
    ).to.be.revertedWithCustomError(crImpl, "InvalidInitialization");
  });

  it("SessionManager impl: initialize on impl reverts", async function () {
    const smImpl = await ethers.getContractAt("SessionManager", d.sessionManager.implementation);
    await expect(
      smImpl.initialize(d.groth16Verifier, d.credentialRegistry.proxy, d.agentWalletFactory.proxy)
    ).to.be.revertedWithCustomError(smImpl, "InvalidInitialization");
  });

  it("AgentWalletFactory impl: initialize on impl reverts", async function () {
    const facImpl = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.implementation);
    await expect(
      facImpl.initialize(d.agentWalletImplementation, d.sessionManager.proxy, d.entryPoint)
    ).to.be.revertedWithCustomError(facImpl, "InvalidInitialization");
  });

  it("CapabilityRegistry impl: initialize on impl reverts", async function () {
    const capImpl = await ethers.getContractAt("CapabilityRegistry", d.capabilityRegistry.implementation);
    await expect(
      capImpl.initialize(deployer.address)
    ).to.be.revertedWithCustomError(capImpl, "InvalidInitialization");
  });

  it("DelegationManager impl: initialize on impl reverts", async function () {
    const delImpl = await ethers.getContractAt("DelegationManager", d.delegationManager.implementation);
    await expect(
      delImpl.initialize(deployer.address)
    ).to.be.revertedWithCustomError(delImpl, "InvalidInitialization");
  });

  it("CredentialRegistry: non-owner upgrade reverts", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    await expect(
      cr.connect(attacker).upgradeToAndCall(d.credentialRegistry.implementation, "0x")
    ).to.be.revertedWithCustomError(cr, "OwnableUnauthorizedAccount");
  });

  it("AgentWalletFactory: non-owner upgrade reverts", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await expect(
      fac.connect(attacker).upgradeToAndCall(d.agentWalletFactory.implementation, "0x")
    ).to.be.revertedWithCustomError(fac, "OwnableUnauthorizedAccount");
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 5: Clone (EIP-1167) Verification
// ─────────────────────────────────────────────────────────

describe("5. Clone (EIP-1167) Verification", function () {
  let d: any;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  before(async () => {
    d = loadDeployment().contracts;
    [owner, alice, bob] = await ethers.getSigners();
  });

  it("createWallet deploys clone with auto-salt", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const tx = await fac.createWallet(alice.address);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "WalletCreated");
    expect(event).to.not.be.undefined;
  });

  it("isAgentWallet returns true for created wallet", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    expect(await fac.isAgentWallet(walletAddr)).to.equal(true);
  });

  it("wallet owner matches", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    const wallet = await ethers.getContractAt("AgentWallet", walletAddr);
    expect(await wallet.owner()).to.equal(alice.address);
  });

  it("wallet sessionManager matches factory", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    const wallet = await ethers.getContractAt("AgentWallet", walletAddr);
    const sm = await wallet.sessionManager();
    expect(sm.toLowerCase()).to.equal(d.sessionManager.proxy.toLowerCase());
  });

  it("wallet entryPoint matches factory", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    const wallet = await ethers.getContractAt("AgentWallet", walletAddr);
    const ep = await wallet.entryPoint();
    expect(ep.toLowerCase()).to.equal(d.entryPoint.toLowerCase());
  });

  it("duplicate wallet for same owner returns existing", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const tx1 = await fac.createWallet(alice.address);
    const r1 = await tx1.wait();
    const tx2 = await fac.createWallet(alice.address);
    const r2 = await tx2.wait();
    // Both should succeed, second is idempotent
    expect(r1.status).to.equal(1);
    expect(r2.status).to.equal(1);
  });

  it("different owner gets different wallet", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await fac.createWallet(bob.address);
    const aliceWallet = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    const bobWallet = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [bob.address, 84532, 0]
      ))
    );
    expect(aliceWallet).to.not.equal(bobWallet);
  });

  it("wallet rejects zero-address owner", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await expect(
      fac.createWallet(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(fac, "InvalidOwnerError");
  });

  it("wallet can receive ETH", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    await owner.sendTransaction({ to: walletAddr, value: ethers.parseEther("0.01") });
    const bal = await ethers.provider.getBalance(walletAddr);
    expect(bal).to.equal(ethers.parseEther("0.01"));
  });

  it("wallet initialize rejects re-init", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    const walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    const wallet = await ethers.getContractAt("AgentWallet", walletAddr);
    await expect(
      wallet.initialize(bob.address, d.sessionManager.proxy, d.entryPoint)
    ).to.be.revertedWithCustomError(wallet, "AlreadyInitializedError");
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 6: AgentWallet Execution
// ─────────────────────────────────────────────────────────

describe("6. AgentWallet Execution", function () {
  let d: any;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let walletAddr: string;
  let wallet: any;
  before(async () => {
    d = loadDeployment().contracts;
    [owner, alice] = await ethers.getSigners();
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await fac.createWallet(alice.address);
    walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    wallet = await ethers.getContractAt("AgentWallet", walletAddr);
  });

  it("owner can whitelist selector", async function () {
    // Whitelist transfer(address,uint256) on a random target
    const target = await owner.getAddress();
    const selector = ethers.id("transfer(address,uint256)").slice(0, 10);
    await expect(
      wallet.connect(alice).setWhiteListedSelector(target, selector, true)
    ).to.emit(wallet, "WhiteListUpdated");
  });

  it("non-owner cannot whitelist", async function () {
    const target = await owner.getAddress();
    const selector = ethers.id("transfer(address,uint256)").slice(0, 10);
    await expect(
      wallet.connect(owner).setWhiteListedSelector(target, selector, true)
    ).to.be.revertedWithCustomError(wallet, "OwnableUnauthorizedAccount");
  });

  it("execute rejects non-whitelisted target", async function () {
    const target = await owner.getAddress();
    await expect(
      wallet.connect(alice).execute(target, 0, "0x")
    ).to.be.revertedWithCustomError(wallet, "SelectorNotWhitelistedError");
  });

  it("execute succeeds with whitelisted target+selector", async function () {
    const target = await owner.getAddress();
    const selector = ethers.id("transfer(address,uint256)").slice(0, 10);
    await wallet.connect(alice).setWhiteListedSelector(target, selector, true);
    // Execute with empty calldata that matches selector format
    const data = selector + "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    await wallet.connect(alice).execute(target, 0, data);
  });

  it("execute rejects zero-length (bytes4(0) not whitelisted)", async function () {
    const target = await owner.getAddress();
    await expect(
      wallet.connect(alice).execute(target, 0, "0x")
    ).to.be.revertedWithCustomError(wallet, "SelectorNotWhitelistedError");
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 7: Lightweight Session Flow
// ─────────────────────────────────────────────────────────

describe("7. Lightweight Session Flow", function () {
  let d: any;
  let owner: SignerWithAddress;
  let sessionKey: SignerWithAddress;
  let alice: SignerWithAddress;
  let walletAddr: string;
  let wallet: any;
  let sessionManager: any;
  const SESSION_ID = ethers.keccak256(ethers.toUtf8Bytes("integration-test-session-1"));

  before(async () => {
    d = loadDeployment().contracts;
    [owner, sessionKey, alice] = await ethers.getSigners();
    sessionManager = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);

    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await fac.createWallet(alice.address);
    walletAddr = await fac.getAddress(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [alice.address, 84532, 0]
      ))
    );
    wallet = await ethers.getContractAt("AgentWallet", walletAddr);
  });

  it("create lightweight session with valid owner signature", async function () {
    const dailySpendLimit = ethers.parseEther("1");
    const dailyTxLimit = 10;
    const expiry = Math.floor(Date.now() / 1000) + 86400; // 24h

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "uint256", "address", "address", "bytes32",
        "address", "uint256", "uint256", "uint64"
      ],
      [
        84532, // chainid
        d.sessionManager.proxy,
        walletAddr,
        SESSION_ID,
        sessionKey.address,
        dailySpendLimit,
        dailyTxLimit,
        expiry
      ]
    ));
    const digest = ethers.keccak256(
      ethers.solidityPacked(["string", "bytes32"], ["\x19Ethereum Signed Message:\n32", messageHash])
    );
    const sig = await alice.signMessage(ethers.getBytes(messageHash));

    await sessionManager.connect(alice).createLightweightSession(
      SESSION_ID, sessionKey.address, dailySpendLimit, dailyTxLimit, expiry, sig
    );

    const session = await sessionManager.getLightSession(SESSION_ID);
    expect(session.sessionWallet).to.equal(walletAddr);
    expect(session.sessionKey).to.equal(sessionKey.address);
    expect(session.revoked).to.equal(false);
  });

  it("getSessionType returns 1 for lightweight", async function () {
    expect(await sessionManager.getSessionType(SESSION_ID)).to.equal(1);
  });

  it("duplicate session ID reverts", async function () {
    const dailySpendLimit = ethers.parseEther("1");
    const dailyTxLimit = 10;
    const expiry = Math.floor(Date.now() / 1000) + 86400;

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32", "address", "uint256", "uint256", "uint64"],
      [84532, d.sessionManager.proxy, walletAddr, SESSION_ID, sessionKey.address, dailySpendLimit, dailyTxLimit, expiry]
    ));
    const sig = await alice.signMessage(ethers.getBytes(messageHash));

    await expect(
      sessionManager.connect(alice).createLightweightSession(
        SESSION_ID, sessionKey.address, dailySpendLimit, dailyTxLimit, expiry, sig
      )
    ).to.be.revertedWithCustomError(sessionManager, "SessionAlreadyExists");
  });

  it("revoke lightweight session", async function () {
    await sessionManager.connect(alice).revokeLightweightSession(SESSION_ID, walletAddr);
    const session = await sessionManager.getLightSession(SESSION_ID);
    expect(session.revoked).to.equal(true);
  });

  it("validate revoked session reverts", async function () {
    await expect(
      sessionManager.connect(wallet).validateLightweightSession(SESSION_ID, sessionKey.address, 1)
    ).to.be.revertedWithCustomError(sessionManager, "SessionIsRevoked");
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 8: Organization Flow
// ─────────────────────────────────────────────────────────

describe("8. Organization Flow", function () {
  let d: any;
  let deployer: SignerWithAddress;
  let orgRegistry: any;
  const ORG_ID = ethers.keccak256(ethers.toUtf8Bytes("test-org-1"));

  before(async () => {
    d = loadDeployment().contracts;
    [deployer] = await ethers.getSigners();
    orgRegistry = await ethers.getContractAt("OrganizationRegistry", d.organizationRegistry.proxy);
  });

  it("register organization", async function () {
    const tx = await orgRegistry.registerOrganization(ORG_ID, "TestOrg", "ipfs://meta1");
    await tx.wait();
    const org = await orgRegistry.getOrganization(ORG_ID);
    expect(org.name).to.equal("TestOrg");
    expect(org.active).to.equal(true);
  });

  it("getOrganizationCount returns >= 1", async function () {
    const count = await orgRegistry.getOrganizationCount();
    expect(count).to.be.greaterThan(0);
  });

  it("organization cannot register same ID again", async function () {
    await expect(
      orgRegistry.registerOrganization(ORG_ID, "TestOrg2", "ipfs://meta2")
    ).to.be.reverted;
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 9: Capability Registry
// ─────────────────────────────────────────────────────────

describe("9. Capability Registry", function () {
  let d: any;
  let deployer: SignerWithAddress;
  let capReg: any;
  const CAP_ID = ethers.keccak256(ethers.toUtf8Bytes("test-cap-1"));

  before(async () => {
    d = loadDeployment().contracts;
    [deployer] = await ethers.getSigners();
    capReg = await ethers.getContractAt("CapabilityRegistry", d.capabilityRegistry.proxy);
  });

  it("register capability", async function () {
    await capReg.registerCapability(CAP_ID, "test-action", Math.floor(Date.now() / 1000) + 86400);
    const count = await capReg.getCapabilityCount();
    expect(count).to.equal(1n);
  });

  it("getCapability returns correct data", async function () {
    const cap = await capReg.getCapability(CAP_ID);
    expect(cap.action).to.equal("test-action");
    expect(cap.revoked).to.equal(false);
  });

  it("non-owner cannot register", async function () {
    const [, attacker] = await ethers.getSigners();
    await expect(
      capReg.connect(attacker).registerCapability(
        ethers.keccak256(ethers.toUtf8Bytes("attacker-cap")),
        "malicious",
        Math.floor(Date.now() / 1000) + 86400
      )
    ).to.be.revertedWithCustomError(capReg, "OwnableUnauthorizedAccount");
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 10: Delegation Manager
// ─────────────────────────────────────────────────────────

describe("10. Delegation Manager", function () {
  let d: any;
  let deployer: SignerWithAddress;
  let delMgr: any;

  before(async () => {
    d = loadDeployment().contracts;
    [deployer] = await ethers.getSigners();
    delMgr = await ethers.getContractAt("DelegationManager", d.delegationManager.proxy);
  });

  it("deployer has DEFAULT_ADMIN_ROLE", async function () {
    expect(await delMgr.hasRole(ethers.ZeroHash, deployer.address)).to.equal(true);
  });

  it("deployer has ROOT_UPDATER_ROLE", async function () {
    const ROOT_UPDATER = ethers.keccak256(ethers.toUtf8Bytes("ROOT_UPDATER_ROLE"));
    expect(await delMgr.hasRole(ROOT_UPDATER, deployer.address)).to.equal(true);
  });

  it("pause/unpause works", async function () {
    await delMgr.pause();
    expect(await delMgr.paused()).to.equal(true);
    await delMgr.unpause();
    expect(await delMgr.paused()).to.equal(false);
  });
});

// ─────────────────────────────────────────────────────────
// SECTION 11: Permissions Matrix
// ─────────────────────────────────────────────────────────

describe("11. Permissions Matrix", function () {
  let d: any;
  let deployer: SignerWithAddress;
  let attacker: SignerWithAddress;

  before(async () => {
    d = loadDeployment().contracts;
    [deployer, attacker] = await ethers.getSigners();
  });

  it("CredentialRegistry: non-owner cannot add issuer", async function () {
    const cr = await ethers.getContractAt("CredentialRegistry", d.credentialRegistry.proxy);
    await expect(
      cr.connect(attacker).addIssuer(attacker.address)
    ).to.be.revertedWithCustomError(cr, "OwnableUnauthorizedAccount");
  });

  it("SessionManager: non-owner cannot pause", async function () {
    const sm = await ethers.getContractAt("SessionManager", d.sessionManager.proxy);
    await expect(
      sm.connect(attacker).pause()
    ).to.be.revertedWithCustomError(sm, "OwnableUnauthorizedAccount");
  });

  it("AgentWalletFactory: non-owner cannot propose implementation", async function () {
    const fac = await ethers.getContractAt("AgentWalletFactory", d.agentWalletFactory.proxy);
    await expect(
      fac.connect(attacker).proposeImplementation(attacker.address)
    ).to.be.revertedWithCustomError(fac, "OwnableUnauthorizedAccount");
  });

  it("CapabilityRegistry: non-owner cannot pause", async function () {
    const cap = await ethers.getContractAt("CapabilityRegistry", d.capabilityRegistry.proxy);
    await expect(
      cap.connect(attacker).pause()
    ).to.be.revertedWithCustomError(cap, "OwnableUnauthorizedAccount");
  });

  it("DelegationManager: non-admin cannot pause", async function () {
    const del = await ethers.getContractAt("DelegationManager", d.delegationManager.proxy);
    await expect(
      del.connect(attacker).pause()
    ).to.be.revertedWithCustomError(del, "AccessControlUnauthorizedAccount");
  });
});
