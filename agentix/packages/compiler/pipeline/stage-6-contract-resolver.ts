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
  credential_issue: { name: 'CredentialRegistry', functions: ['proposeActiveRoot'] },
  credential_revoke: { name: 'CredentialRegistry', functions: ['proposeRevokedSecretRoot'] },
  credential_update_root: { name: 'CredentialRegistry', functions: ['proposeActiveRoot'] },
  credential_accept_root: { name: 'CredentialRegistry', functions: ['acceptActiveRoot'] },
  credential_accept_revoked_root: { name: 'CredentialRegistry', functions: ['acceptRevokedSecretRoot'] },
  credential_cancel_root: { name: 'CredentialRegistry', functions: ['cancelActiveRoot'] },
  credential_cancel_revoked_root: { name: 'CredentialRegistry', functions: ['cancelRevokedSecretRoot'] },
  organization_register: { name: 'OrganizationRegistry', functions: ['registerOrganization'] },
  organization_deactivate: { name: 'OrganizationRegistry', functions: ['deactivateOrganization'] },
  organization_reactivate: { name: 'OrganizationRegistry', functions: ['reactivateOrganization'] },
  capability_register: { name: 'CapabilityRegistry', functions: ['registerCapability'] },
  capability_revoke: { name: 'CapabilityRegistry', functions: ['revokeCapability'] },
  delegation_create: { name: 'DelegationManager', functions: ['proposeDelegationRoot'] },
  delegation_accept_root: { name: 'DelegationManager', functions: ['acceptDelegationRoot'] },
  delegation_cancel_root: { name: 'DelegationManager', functions: ['cancelDelegationRoot'] },
  delegation_revoke: { name: 'DelegationManager', functions: ['revokeDelegation'] },
  // Anchor actions target per-organization instances, not a singleton
  // proxy: the address comes from params (see resolve() below), never
  // from config defaults.
  anchor_accept_root: { name: 'OrganizationCredentialAnchor', functions: ['acceptRoot'] },
  anchor_accept_revoked_root: { name: 'OrganizationCredentialAnchor', functions: ['acceptRevokedRoot'] },
  anchor_cancel_root: { name: 'OrganizationCredentialAnchor', functions: ['cancelRoot'] },
  anchor_cancel_revoked_root: { name: 'OrganizationCredentialAnchor', functions: ['cancelRevokedRoot'] },
  identity_link_credential: { name: 'AgentIdentity', functions: ['linkCredential'] },
  identity_update_metadata: { name: 'AgentIdentity', functions: ['updateMetadata'] },
  identity_deactivate: { name: 'AgentIdentity', functions: ['deactivate'] },
  identity_reactivate: { name: 'AgentIdentity', functions: ['reactivate'] },
};

export class ContractResolver {
  /**
   * Map a normalized action to its contract, address and function list.
   * Why: stage 6 is where an intent becomes concrete on-chain calls — the action-to-contract table (KNOWN_CONTRACTS) is the single source of truth.
   * @param intent - parsed intent; only normalizedAction is consulted.
   * @param contractAddresses - optional per-contract overrides, checked before config defaults. Anchor actions instead take their per-instance address from params.anchorAddress.
   * @returns { contracts, errors }: one ResolvedContract per function; errors is non-empty (and contracts empty) when the action is unmapped or no address resolves.
   * Maps to: contract AgentWalletFactory / AgentWallet / SessionManager / CredentialRegistry / OrganizationRegistry / CapabilityRegistry / DelegationManager / AgentIdentity.
   */
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
      // Anchor actions carry their per-instance address in params: there
      // is no singleton anchor proxy in config to default to.
      (mapping.name === 'OrganizationCredentialAnchor' && typeof intent.params?.anchorAddress === 'string'
        ? (intent.params.anchorAddress as string)
        : undefined) ||
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

  /**
   * Resolve an intent into the sequential execution nodes the plan will run.
   * Why: the plan needs nodes with retry/timeout/dependency metadata, not just contract addresses — this is the shape the executor consumes.
   * @param intent - parsed intent; its whole params bag is passed as the single call arg of every node.
   * @param contractAddresses - optional address overrides.
   * @returns { nodes, errors }: nodes are chained step_0..step_n with dependsOn on the previous node, 3 attempts with 1s→2x backoff, 30s timeout, 500000 gas; empty nodes plus errors on resolution failure.
   * Maps to: contract SessionManager.createSession et al. via the per-action function table.
   */
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

  /**
   * Read a contract's deployed address from the runtime config (agentix/src/core/config).
   * Why: resolution falls back to config only after explicit overrides and anchor params — config is the deployment's address book.
   * @param name - contract name as in KNOWN_CONTRACTS.
   * @returns The configured address, or undefined when the config is unresolvable or the contract has no key (e.g. OrganizationCredentialAnchor, which has no singleton).
   * Maps to: internal — ContractResolver.resolve.
   */
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

  /**
   * Compute the 4-byte function selector for a contract function name.
   * Why: selectors identify the call on-chain; the full canonical signature is used (not the bare name) so overloaded or differently-typed functions never collide.
   * @param func - function name as listed in KNOWN_CONTRACTS (may already carry a signature, e.g. 'revokeSession(bytes32,address)').
   * @returns The 0x-prefixed 4-byte selector (10 chars). Unknown functions fall back to `func(...)`, which still yields a deterministic (but wrong) selector — callers must only pass known functions.
   * @throws Propagates if the ethers `id` helper cannot be required.
   * Maps to: contract AgentWallet / SessionManager / CredentialRegistry function selectors.
   */
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
      'revokeSession': 'revokeSession(bytes32,address)',
      'proposeActiveRoot': 'proposeActiveRoot(bytes32)',
      'acceptActiveRoot': 'acceptActiveRoot()',
      'cancelActiveRoot': 'cancelActiveRoot()',
      'proposeRevokedSecretRoot': 'proposeRevokedSecretRoot(bytes32)',
      'acceptRevokedSecretRoot': 'acceptRevokedSecretRoot()',
      'cancelRevokedSecretRoot': 'cancelRevokedSecretRoot()',
      'proposeRoot': 'proposeRoot(bytes32)',
      'acceptRoot': 'acceptRoot()',
      'cancelRoot': 'cancelRoot()',
      'proposeRevokedRoot': 'proposeRevokedRoot(bytes32)',
      'acceptRevokedRoot': 'acceptRevokedRoot()',
      'cancelRevokedRoot': 'cancelRevokedRoot()',
      'registerOrganization': 'registerOrganization(bytes32,string,address)',
      'deactivateOrganization': 'deactivateOrganization(bytes32)',
      'reactivateOrganization': 'reactivateOrganization(bytes32)',
      'registerCapability': 'registerCapability(bytes32,bytes32)',
      'revokeCapability': 'revokeCapability(bytes32)',
      'proposeDelegationRoot': 'proposeDelegationRoot(address,bytes32,bytes32,uint64)',
      'acceptDelegationRoot': 'acceptDelegationRoot(address,bytes32)',
      'cancelDelegationRoot': 'cancelDelegationRoot(address,bytes32)',
      'revokeDelegation': 'revokeDelegation(bytes32,address)',
      'linkCredential': 'linkCredential(uint256,uint256)',
      'updateMetadata': 'updateMetadata(uint256,bytes32)',
      'deactivate': 'deactivate(uint256)',
      'reactivate': 'reactivate(uint256)',
    };
    const fullSig = sigMap[func] || `${func}(...)`;
    return id(fullSig).slice(0, 10);
  }
}
