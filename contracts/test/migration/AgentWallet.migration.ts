import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Migration — AgentWallet (Non-upgradeable, Factory-managed)", function () {
  let wallet: any;
  let factory: any;
  let sessionManager: any;
  let owner: SignerWithAddress;
  let signers: SignerWithAddress[];

  beforeEach(async function () {
    [owner, ...signers] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy();

    const CredRegImpl = await ethers.getContractFactory("CredentialRegistry");
    const credRegImpl = await CredRegImpl.deploy();
    const CredRegProxy = await ethers.getContractFactory("ERC1967Proxy");
    const credRegProxy = await CredRegProxy.deploy(
      await credRegImpl.getAddress(),
      credRegImpl.interface.encodeFunctionData("initialize", [owner.address])
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

    const WalletImpl = await ethers.getContractFactory("AgentWallet");
    const walletImpl = await WalletImpl.deploy();
    const SessMgrImpl = await ethers.getContractFactory("SessionManager");
    const sessMgrImpl = await SessMgrImpl.deploy();
    const SessMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const sessMgrProxy = await SessMgrProxy.deploy(
      await sessMgrImpl.getAddress(),
      sessMgrImpl.interface.encodeFunctionData("initialize", [
        await mockVerifier.getAddress(),
        await credRegProxy.getAddress(),
        "0x0000000000000000000000000000000000000001"
      ])
    );
    sessionManager = await ethers.getContractAt("SessionManager", await sessMgrProxy.getAddress());

    const FactoryImpl = await ethers.getContractFactory("AgentWalletFactory");
    const factoryImpl = await FactoryImpl.deploy();
    const FactoryProxy = await ethers.getContractFactory("ERC1967Proxy");
    const mockEntryPoint = ethers.Wallet.createRandom().address;
    const factoryProxy = await FactoryProxy.deploy(
      await factoryImpl.getAddress(),
      factoryImpl.interface.encodeFunctionData("initialize", [
        await walletImpl.getAddress(),
        await sessionManager.getAddress(),
        mockEntryPoint
      ])
    );
    factory = await ethers.getContractAt("AgentWalletFactory", await factoryProxy.getAddress());
    await sessionManager.connect(owner).setWalletFactory(await factory.getAddress());

    const tx = await factory.connect(owner)["createWallet(address)"](owner.address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);

    // Populate state
    await wallet.setWhiteListedParty(signers[5].address, true);
  });

  it("Wallet ownership persists across factory upgrades", async function () {
    expect(await wallet.owner()).to.equal(owner.address);
    expect(await wallet.whiteListedParties(signers[5].address)).to.be.true;
  });

  it("Wallet remains functional after factory upgrade", async function () {
    const newImpl = await (await ethers.getContractFactory("AgentWallet")).deploy();
    await factory.setImplementation(await newImpl.getAddress());

    // Old wallet still works
    expect(await wallet.owner()).to.equal(owner.address);
    await wallet.setWhiteListedParty(signers[6].address, true);
    expect(await wallet.whiteListedParties(signers[6].address)).to.be.true;
  });

  it("New wallets use updated factory config", async function () {
    const newImpl = await (await ethers.getContractFactory("AgentWallet")).deploy();
    await factory.setImplementation(await newImpl.getAddress());

    const tx = await factory.connect(owner)["createWallet(address)"](signers[2].address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const newWalletAddr = (factory.interface.parseLog(event as any) as any).args.wallet;
    const newWallet = await ethers.getContractAt("AgentWallet", newWalletAddr);
    expect(await newWallet.owner()).to.equal(signers[2].address);
  });
});
