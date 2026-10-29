import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/// @notice C-6 regression tests: delegation chain scope transitivity.
///         Every hop's scope must equal the first hop's scope — scopes are
///         opaque hashes, so equality is the only enforceable non-widening
///         rule on-chain. A chain like A→B for `read`, B→C for
///         `transfer_assets` is NOT valid, even if every hop's proof checks
///         out individually.
describe("DelegationChainScope (C-6)", function () {
  let delegationManager: any;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  const SCOPE = ethers.keccak256(ethers.toUtf8Bytes("read"));
  const OTHER_SCOPE = ethers.keccak256(ethers.toUtf8Bytes("transfer_assets"));

  function leafFor(delegator: string, delegate: string, scope: string, expiry: number) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "bytes32", "uint64"],
        [delegator, delegate, scope, expiry]
      )
    );
  }

  async function setRoot(delegator: SignerWithAddress, scope: string, root: string, expiry: number) {
    await delegationManager.connect(delegator).proposeDelegationRoot(delegator.address, scope, root, expiry);
    await ethers.provider.send("evm_increaseTime", [172800]);
    await ethers.provider.send("evm_mine", []);
    await delegationManager.connect(delegator).acceptDelegationRoot(delegator.address, scope);
  }

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const DelMgrImpl = await ethers.getContractFactory("DelegationManager");
    const delMgrImpl = await DelMgrImpl.deploy();
    const DelMgrProxy = await ethers.getContractFactory("ERC1967Proxy");
    const delMgrProxy = await DelMgrProxy.deploy(
      await delMgrImpl.getAddress(),
      delMgrImpl.interface.encodeFunctionData("initialize", [owner.address])
    );
    delegationManager = await ethers.getContractAt("DelegationManager", await delMgrProxy.getAddress());
  });

  it("C-6: 2-hop same-scope chain verifies true", async function () {
    const exp = 0;
    const l1 = leafFor(alice.address, bob.address, SCOPE, exp);
    const l2 = leafFor(bob.address, carol.address, SCOPE, exp);
    await setRoot(alice, SCOPE, l1, exp);
    await setRoot(bob, SCOPE, l2, exp);
    const ok = await delegationManager.connect(carol).verifyDelegationChain.staticCall(
      [l1, l2], [[], []],
      [alice.address, bob.address],
      [bob.address, carol.address],
      [SCOPE, SCOPE], [exp, exp], [10, 10]
    );
    expect(ok).to.be.true;
  });

  it("C-6: mixed-scope chain verifies false (scope widens at hop 2)", async function () {
    const exp = 0;
    const l1 = leafFor(alice.address, bob.address, SCOPE, exp);
    const l2 = leafFor(bob.address, carol.address, OTHER_SCOPE, exp);
    await setRoot(alice, SCOPE, l1, exp);
    await setRoot(bob, OTHER_SCOPE, l2, exp);
    const ok = await delegationManager.connect(carol).verifyDelegationChain.staticCall(
      [l1, l2], [[], []],
      [alice.address, bob.address],
      [bob.address, carol.address],
      [SCOPE, OTHER_SCOPE], [exp, exp], [10, 10]
    );
    expect(ok).to.be.false;
  });

  it("C-6: single-hop chain is unaffected by the scope rule", async function () {
    const exp = 0;
    const l1 = leafFor(alice.address, bob.address, SCOPE, exp);
    await setRoot(alice, SCOPE, l1, exp);
    const ok = await delegationManager.connect(bob).verifyDelegationChain.staticCall(
      [l1], [[]],
      [alice.address],
      [bob.address],
      [SCOPE], [exp], [10]
    );
    expect(ok).to.be.true;
  });
});
