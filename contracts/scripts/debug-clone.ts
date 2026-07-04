import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const WalletImpl = await ethers.getContractFactory("AgentWallet");
  const walletImpl = await WalletImpl.deploy();
  const implAddr = await walletImpl.getAddress();

  const EP = ethers.Wallet.createRandom().address;
  const SM = "0x0000000000000000000000000000000000000001";

  const FactoryF = await ethers.getContractFactory("AgentWalletFactory");
  const factoryImpl = await FactoryF.deploy();
  const ProxyF = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ProxyF.deploy(
    await factoryImpl.getAddress(),
    factoryImpl.interface.encodeFunctionData("initialize", [implAddr, SM, EP])
  );
  const proxyAddr = await proxy.getAddress();
  const factory = await ethers.getContractAt("AgentWalletFactory", proxyAddr);

  const calldata = factory.interface.encodeFunctionData("createWallet(address)", [deployer.address]);

  const trace: any = await ethers.provider.send("debug_traceCall", [
    { from: deployer.address, to: proxyAddr, data: calldata, gas: 500000 },
    "latest",
    { disableStorage: true, disableMemory: false }
  ]);

  console.log("failed:", trace.failed);
  console.log("returnValue:", trace.returnValue);
  console.log("returnValue length:", trace.returnValue?.length);

  // Decode revert data if possible
  if (trace.returnValue && trace.returnValue !== "0x") {
    const sel = trace.returnValue.substring(0, 10);
    console.log("Revert selector:", sel);
    // Try to decode common OZ errors
    const errors = [
      "AlreadyInitializedError()", "InvalidOwnerError()", "InvalidSessionManagerError()",
      "InvalidEntryPointError()", "FailedDeployment()", "InvalidImplementationError()",
      "InvalidSessionManagerError()", "InvalidEntryPointError()",
      "TimelockActiveError()", "TimelockNotReadyError()",
      "WalletAlreadyExistsWithDifferentOwner()",
    ];
    for (const e of errors) {
      const s = ethers.id(e).substring(0, 10);
      if (s === sel) {
        console.log("MATCHED ERROR:", e);
      }
    }
  }

  // Find depth transitions and REVERT ops
  const logs = trace.structLogs;
  console.log("\n--- All REVERT/RETURN ops ---");
  for (let i = 0; i < logs.length; i++) {
    const op = logs[i];
    if (op.op === "REVERT" || op.op === "RETURN") {
      console.log(`[${i}] pc=${op.pc} op=${op.op} depth=${op.depth} gas=${op.gas}`);
      // Read size and offset from stack
      if (op.stack && op.stack.length >= 2) {
        const size = parseInt(op.stack[op.stack.length - 1], 16);
        const offset = parseInt(op.stack[op.stack.length - 2], 16);
        console.log(`    offset=${offset} size=${size}`);
        if (op.memory && size > 0 && size < 500) {
          const hex = op.memory.join("").substring(offset * 2, (offset + size) * 2);
          console.log(`    data=0x${hex}`);
          const sel = "0x" + hex.substring(0, 8);
          console.log(`    selector=${sel}`);
          for (const e of ["AlreadyInitializedError()", "InvalidOwnerError()", "InvalidSessionManagerError()", "InvalidEntryPointError()"]) {
            if (ethers.id(e).substring(0, 10) === sel) console.log(`    MATCHED: ${e}`);
          }
        }
      }
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
