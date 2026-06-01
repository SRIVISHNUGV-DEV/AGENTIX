import { ethers } from "hardhat"

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log(`Deploying from: ${deployer.address}`)

  const capReg = await ethers.deployContract("CapabilityRegistry")
  await capReg.waitForDeployment()
  const capRegAddr = await capReg.getAddress()
  console.log(`CapabilityRegistry: ${capRegAddr}`)

  const delMan = await ethers.deployContract("DelegationManager")
  await delMan.waitForDeployment()
  const delManAddr = await delMan.getAddress()
  console.log(`DelegationManager: ${delManAddr}`)

  console.log(JSON.stringify({
    deployer: deployer.address,
    capabilityRegistry: capRegAddr,
    delegationManager: delManAddr,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
