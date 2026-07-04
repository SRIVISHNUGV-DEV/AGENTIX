import hre from "hardhat";

const PROXIES = [
  {
    name: "CredentialRegistry",
    proxy: "0xaC0A72FaAF2596DD55A20049F0ab7584b58b3DEE",
    implementation: "0x3c3C568D47363aC38545197A3e779c41dF32C322",
    args: ["0x3c3C568D47363aC38545197A3e779c41dF32C322", "0x"]
  },
  {
    name: "SessionManager",
    proxy: "0x27532B3B2d0704715D5e81BDa8B0D272675751d1",
    implementation: "0xF91fe9c6E6Ac7D5D1b8bd78078B36D18ee0904cA",
    args: ["0xF91fe9c6E6Ac7D5D1b8bd78078B36D18ee0904cA", "0x"]
  },
  {
    name: "AgentWalletFactory",
    proxy: "0x9e6B32F7da3ef2C2dD1337757FbC25Eb72FdFfE3",
    implementation: "0x1bbAd274954B8e73cBCF0d007067C8333bbFDB34",
    args: ["0x1bbAd274954B8e73cBCF0d007067C8333bbFDB34", "0x"]
  },
  {
    name: "CapabilityRegistry",
    proxy: "0xa9ff494D1047bC9399858394B95aCf7066740aFC",
    implementation: "0x275e536DD14F12E114929Abdd24FacdCC4fB450e",
    args: ["0x275e536DD14F12E114929Abdd24FacdCC4fB450e", "0x"]
  },
  {
    name: "DelegationManager",
    proxy: "0x73f8591ccCdBfE1595aA4d2160e8F166E0243E38",
    implementation: "0x155A302DE9ec5f7a834e62120ac91e11Bd105F7d",
    args: ["0x155A302DE9ec5f7a834e62120ac91e11Bd105F7d", "0x"]
  },
  {
    name: "OrganizationRegistry",
    proxy: "0x6eeeEcB5c79eE664ab0019CC427F8Bf23a7fc8Fe",
    implementation: "0x8e1747e9D98ED4d9F02b335fB4042782e8147685",
    args: ["0x8e1747e9D98ED4d9F02b335fB4042782e8147685", "0x"]
  }
];

async function main() {
  console.log("Verifying ERC1967 proxies on Base Sepolia...\n");

  for (const p of PROXIES) {
    console.log(`Verifying ${p.name} proxy at ${p.proxy}...`);
    try {
      await hre.run("verify:verify", {
        address: p.proxy,
        constructorArguments: p.args
      });
      console.log(`   ✅ ${p.name} proxy verified`);
    } catch (err: any) {
      if (err.message?.includes("Already Verified")) {
        console.log(`   ⏭️  ${p.name} proxy already verified`);
      } else {
        console.error(`   ❌ ${p.name} proxy verification failed:`, err.message);
      }
    }
    console.log();
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
