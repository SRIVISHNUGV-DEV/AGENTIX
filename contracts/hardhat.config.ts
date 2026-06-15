import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import fs from "fs";
import path from "path";

function loadEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }
  return env;
}

const backendEnv = loadEnvFile(path.resolve(__dirname, "../backend/.env"));
const contractsEnv = loadEnvFile(path.resolve(__dirname, ".env"));

const rpcUrl = backendEnv.RPC_URL || process.env.RPC_URL || contractsEnv.RPC_URL || "";
const privateKey = contractsEnv.PRIVATE_KEY || backendEnv.PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const etherscanApiKey = contractsEnv.ETHERSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";

const allAccounts = [privateKey];
for (let i = 1; i <= 4; i++) {
  const pk = contractsEnv[`PRIVATE_KEY_${i}`] || "";
  if (pk) allAccounts.push(pk);
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: rpcUrl,
      accounts: allAccounts.filter(Boolean)
    },
    baseSepolia: {
      url: rpcUrl,
      accounts: allAccounts.filter(Boolean),
      chainId: 84532
    }
  },
  etherscan: {
    apiKey: etherscanApiKey,
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
};

export default config;
