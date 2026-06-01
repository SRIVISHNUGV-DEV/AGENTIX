import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import fs from "fs";
import path from "path";

function loadBackendEnv() {
  const envPath = path.resolve(__dirname, "../backend/.env");

  if (!fs.existsSync(envPath)) {
    return {};
  }

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

const backendEnv = loadBackendEnv();
const rpcUrl = backendEnv.RPC_URL || process.env.RPC_URL || "";
const privateKey = backendEnv.PRIVATE_KEY || process.env.PRIVATE_KEY || "";

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
      accounts: privateKey ? [privateKey] : []
    }
  }
};

export default config;
