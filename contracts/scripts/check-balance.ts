import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Chain ID: ${network.chainId}`);
  if (balance < ethers.parseEther("0.01")) {
    console.warn("WARNING: Balance is very low! Deploying 7 contracts may fail.");
  }
}

main().catch(console.error);
