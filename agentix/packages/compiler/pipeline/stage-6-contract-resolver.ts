import { ParsedIntent } from '../types/intent';
import { ExecutionNode, ExecutionEdge } from '../types/execution-plan';

export interface ResolvedContract {
  name: string;
  address: string;
  abi: unknown[];
  function: string;
  selector: string;
}

export interface ContractResolution {
  contracts: ResolvedContract[];
  errors: string[];
}

const KNOWN_CONTRACTS: Record<string, { name: string; functions: string[] }> = {
  wallet_create: { name: 'AgentWalletFactory', functions: ['createWallet'] },
  wallet_execute: { name: 'AgentWallet', functions: ['execute'] },
  wallet_execute_batch: { name: 'AgentWallet', functions: ['executeBatch'] },
  wallet_deposit: { name: 'AgentWallet', functions: ['addDeposit'] },
  wallet_withdraw: { name: 'AgentWallet', functions: ['withdrawDepositTo'] },
  wallet_transfer_ownership: { name: 'AgentWallet', functions: ['changeOwner'] },
  session_create: { name: 'SessionManager', functions: ['createSession'] },
  session_create_lightweight: { name: 'SessionManager', functions: ['createLightweightSession'] },
  session_revoke: { name: 'SessionManager', functions: ['revokeSession(bytes32,address)'] },
  credential_issue: { name: 'CredentialRegistry', functions: ['updateActiveRoot'] },
  credential_revoke: { name: 'CredentialRegistry', functions: ['updateRevokedSecretRoot'] },
  organization_register: { name: 'OrganizationRegistry', functions: ['registerOrganization'] },
  organization_deactivate: { name: 'OrganizationRegistry', functions: ['deactivateOrganization'] },
  organization_reactivate: { name: 'OrganizationRegistry', functions: ['reactivateOrganization'] },
  capability_register: { name: 'CapabilityRegistry', functions: ['registerCapability'] },
  capability_revoke: { name: 'CapabilityRegistry', functions: ['revokeCapability'] },
  delegation_create: { name: 'DelegationManager', functions: ['updateDelegationRoot'] },
  delegation_revoke: { name: 'DelegationManager', functions: ['revokeDelegation'] },
  identity_link_credential: { name: 'AgentIdentity', functions: ['linkCredential'] },
  identity_update_metadata: { name: 'AgentIdentity', functions: ['updateMetadata'] },
  identity_deactivate: { name: 'AgentIdentity', functions: ['deactivate'] },
  identity_reactivate: { name: 'AgentIdentity', functions: ['reactivate'] },
};

export class ContractResolver {
  resolve(intent: ParsedIntent, contractAddresses?: Record<string, string>): ContractResolution {
    const errors: string[] = [];
    const contracts: ResolvedContract[] = [];

    const mapping = KNOWN_CONTRACTS[intent.normalizedAction];
    if (!mapping) {
      return {
        contracts: [],
        errors: [`No contract mapping for action: ${intent.normalizedAction}`],
      };
    }

    const address =
      (contractAddresses && contractAddresses[mapping.name]) ||
      this._getDefaultAddress(mapping.name);

    if (!address) {
      errors.push(`No address configured for contract: ${mapping.name}`);
      return { contracts: [], errors };
    }

    for (const func of mapping.functions) {
      contracts.push({
        name: mapping.name,
        address,
        abi: [],
        function: func,
        selector: this._computeSelector(func),
      });
    }

    return { contracts, errors };
  }

  resolveExecutionNodes(intent: ParsedIntent, contractAddresses?: Record<string, string>): { nodes: ExecutionNode[]; errors: string[] } {
    const resolution = this.resolve(intent, contractAddresses);
    if (resolution.errors.length > 0) {
      return { nodes: [], errors: resolution.errors };
    }

    const nodes: ExecutionNode[] = resolution.contracts.map((c, i) => ({
      id: `step_${i}`,
      type: 'contract_call' as const,
      call: {
        contractName: c.name,
        address: c.address,
        function: c.function,
        args: [intent.params],
        value: (intent.params.value as string) || '0',
        gasLimit: '500000',
      },
      retry: {
        maxAttempts: 3,
        backoffMs: 1000,
        backoffMultiplier: 2,
      },
      timeout: 30000,
      rollbackNodeIds: [],
      dependsOn: i > 0 ? [`step_${i - 1}`] : [],
      allowsParallel: false,
    }));

    return { nodes, errors: [] };
  }

  private _getDefaultAddress(name: string): string | undefined {
    try {
      // Runtime config lives at agentix/src/core/config — from
      // packages/compiler/pipeline/ that is ../../../src/core/config.
      const { loadConfig } = require('../../../src/core/config');
      const config = loadConfig();
      const keyMap: Record<string, string> = {
        AgentWalletFactory: 'agentWalletFactory',
        SessionManager: 'sessionManager',
        CredentialRegistry: 'credentialRegistry',
        OrganizationRegistry: 'organizationRegistry',
        CapabilityRegistry: 'capabilityRegistry',
        DelegationManager: 'delegationManager',
        AgentIdentity: 'agentIdentity',
      };
      const configKey = keyMap[name];
      if (!configKey) return undefined;
      return config.contracts[configKey as keyof typeof config.contracts];
    } catch {
      return undefined;
    }
  }

  private _computeSelector(func: string): string {
    const { id } = require('ethers');
    // Use full canonical signature for accurate selectors
    const sigMap: Record<string, string> = {
      'createWallet': 'createWallet(address,bytes32)',
      'execute': 'execute(address,uint256,bytes)',
      'executeBatch': 'executeBatch(address[],uint256[],bytes[])',
      'addDeposit': 'addDeposit()',
      'withdrawDepositTo': 'withdrawDepositTo(address,uint256)',
      'changeOwner': 'changeOwner(address)',
      'createSession': 'createSession(bytes32,address,uint256,uint256,uint64,uint128)',
      'createLightweightSession': 'createLightweightSession(bytes32,address,uint256,uint256,uint64,address[],bytes)',
      'revokeSession': 'revokeSession(bytes32)',
      'updateActiveRoot': 'updateActiveRoot(uint256)',
      'updateRevokedSecretRoot': 'updateRevokedSecretRoot(uint256)',
      'registerOrganization': 'registerOrganization(bytes32,string,address)',
      'deactivateOrganization': 'deactivateOrganization(bytes32)',
      'reactivateOrganization': 'reactivateOrganization(bytes32)',
      'registerCapability': 'registerCapability(bytes32,bytes32)',
      'revokeCapability': 'revokeCapability(bytes32)',
      'updateDelegationRoot': 'updateDelegationRoot(bytes32,bytes32,uint64)',
      'revokeDelegation': 'revokeDelegation(bytes32)',
      'linkCredential': 'linkCredential(uint256,uint256)',
      'updateMetadata': 'updateMetadata(uint256,bytes32)',
      'deactivate': 'deactivate(uint256)',
      'reactivate': 'reactivate(uint256)',
    };
    const fullSig = sigMap[func] || `${func}(...)`;
    return id(fullSig).slice(0, 10);
  }
}
