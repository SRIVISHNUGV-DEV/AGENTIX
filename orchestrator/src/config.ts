import { AgentIXConfig, CHAINS } from './types.js';
import { ConfigurationError } from './errors.js';

const REQUIRED_DEFAULTS: Partial<AgentIXConfig> = {
  chainId: CHAINS.BASE_SEPOLIA.chainId,
  rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/Pmq9QBdugAMgGijjyff5L',
  walletFactoryAddress: '0x6A4C643f59952CfBfEcEdaf182B3C98D778df2c1',
  sessionManagerAddress: '0x9b7B7d631098f046eaFb4637DC859eBA51e238C0',
  credentialRegistryAddress: '0xF1C30a96aa97faB2A29B2E8Cdc05fc321AA7511E',
  credentialVerifierAddress: '0x3056bB17323228d1829D2f6A2a96Af8e079095c2',
  delegationManagerAddress: '0x6Ee3cdeB9c1a1aE83CF0bb0E469B98736Cb07CB5',
  capabilityRegistryAddress: '0x90D4d0D35709D4e29765F5132DaD0E85Fc07aD6A',
  organizationRegistryAddress: '0xdF3e6819fC65966d0D43A3768Aaa40fd50B59443',
  entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
  agentIdentityAddress: '0xaF20A4CF58CF8E3DF6bF2545Ed9371d39E97cD71',
};

export function loadConfig(overrides?: Partial<AgentIXConfig>): AgentIXConfig {
  const fromEnv: Partial<AgentIXConfig> = {};

  if (process.env.AGENTIX_RPC_URL) fromEnv.rpcUrl = process.env.AGENTIX_RPC_URL;
  if (process.env.AGENTIX_CHAIN_ID) fromEnv.chainId = Number(process.env.AGENTIX_CHAIN_ID);
  if (process.env.AGENTIX_WALLET_FACTORY) fromEnv.walletFactoryAddress = process.env.AGENTIX_WALLET_FACTORY;
  if (process.env.AGENTIX_SESSION_MANAGER) fromEnv.sessionManagerAddress = process.env.AGENTIX_SESSION_MANAGER;
  if (process.env.AGENTIX_CREDENTIAL_REGISTRY) fromEnv.credentialRegistryAddress = process.env.AGENTIX_CREDENTIAL_REGISTRY;
  if (process.env.AGENTIX_VERIFIER) fromEnv.credentialVerifierAddress = process.env.AGENTIX_VERIFIER;
  if (process.env.AGENTIX_DELEGATION_MANAGER) fromEnv.delegationManagerAddress = process.env.AGENTIX_DELEGATION_MANAGER;
  if (process.env.AGENTIX_CAPABILITY_REGISTRY) fromEnv.capabilityRegistryAddress = process.env.AGENTIX_CAPABILITY_REGISTRY;
  if (process.env.AGENTIX_ORGANIZATION_REGISTRY) fromEnv.organizationRegistryAddress = process.env.AGENTIX_ORGANIZATION_REGISTRY;
  if (process.env.AGENTIX_ENTRY_POINT) fromEnv.entryPointAddress = process.env.AGENTIX_ENTRY_POINT;
  if (process.env.AGENTIX_IDENTITY) fromEnv.agentIdentityAddress = process.env.AGENTIX_IDENTITY;
  if (process.env.AGENTIX_DB_PATH) fromEnv.dbPath = process.env.AGENTIX_DB_PATH;

  const merged: AgentIXConfig = { ...REQUIRED_DEFAULTS, ...fromEnv, ...overrides } as AgentIXConfig;

  const required: (keyof AgentIXConfig)[] = [
    'rpcUrl', 'walletFactoryAddress', 'sessionManagerAddress',
    'credentialRegistryAddress', 'credentialVerifierAddress',
    'delegationManagerAddress', 'capabilityRegistryAddress',
    'organizationRegistryAddress', 'entryPointAddress',
  ];

  for (const key of required) {
    if (!merged[key]) {
      throw new ConfigurationError(key + ' is required. Set it via env, config file, or constructor.');
    }
  }

  return merged;
}
