import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Fuzz — AgentWallet", function () {
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
    // Activate factory via timelock
    await sessionManager.connect(owner).proposeWalletFactory(await factory.getAddress());
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);
    await sessionManager.connect(owner).acceptWalletFactory();

    const tx = await factory.connect(owner)["createWallet(address)"](owner.address);
    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try { return factory.interface.parseLog(log as any)?.name === "WalletCreated"; } catch { return false; }
    });
    const walletAddress = (factory.interface.parseLog(event as any) as any).args.wallet;
    wallet = await ethers.getContractAt("AgentWallet", walletAddress);
  });

  it("Fuzz: whitelist 200 addresses", async function () {
    const TEST_SELECTOR = "0x12345678";
    const addrs = Array.from({ length: 200 }, (_, i) => signers[i % signers.length].address);
    const uniqueAddrs = [...new Set(addrs)];
    for (const a of uniqueAddrs) {
      await wallet.setWhiteListedSelector(a, TEST_SELECTOR, true);
    }
    for (const a of uniqueAddrs) {
      expect(await wallet.whiteListedSelectors(a, TEST_SELECTOR)).to.be.true;
    }
  });

  it("Fuzz: ownership transfer cycles", async function () {
    for (let i = 0; i < 10; i++) {
      const currentOwnerAddr = await wallet.owner();
      const currentOwnerSigner = await ethers.getSigner(currentOwnerAddr);
      const nextIdx = (i + 2) % signers.length;
      const newOwner = signers[nextIdx].address;
      if (newOwner === currentOwnerAddr) continue;
      await wallet.connect(currentOwnerSigner).changeOwner(newOwner);
      await wallet.connect(signers[nextIdx]).acceptOwnership();
      expect(await wallet.owner()).to.equal(newOwner);
    }
  });

  it("Fuzz: ETH receive from random addresses", async function () {
    for (let i = 0; i < 10; i++) {
      const signer = signers[i % signers.length];
      await signer.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("0.01")
      });
    }
  });

  it("Fuzz: zero-address always rejected", async function () {
    await expect(wallet.changeOwner(ethers.ZeroAddress)).to.be.reverted;
    await expect(wallet.proposeSessionManager(ethers.ZeroAddress)).to.be.reverted;
  });

  it("Fuzz: non-owner cannot change whitelist", async function () {
    await expect(
      wallet.connect(signers[1]).setWhiteListedSelector(signers[2].address, "0x12345678", true)
    ).to.be.reverted;
  });
});
