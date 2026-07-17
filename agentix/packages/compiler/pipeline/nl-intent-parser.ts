// ─────────────────────────────────────────────────────────────────────────────
// NL Intent Parser — LLM-native intent classification
//
// Instead of regex patterns, this module generates a structured prompt + schema
// that the connected AI agent uses to classify free-text into a StructuredIntent.
// The agent IS the NLU layer — no model training, no embeddings, no latency
// from a separate inference call. The agent already understands the user.
//
// Flow:
//   1. Agent receives user's free-text request
//   2. Agent calls agentix_parse_intent({ natural_language: "..." })
//   3. MCP server returns action catalog + param schemas + classification rules
//   4. Agent classifies the text → StructuredIntent
//   5. Agent calls agentix_compile_intent({ action, params }) with the result
// ─────────────────────────────────────────────────────────────────────────────

import { KNOWN_ACTIONS, KnownAction } from '../types/intent';

// ── Action catalog with param schemas and examples ──────────────────────────

export interface ActionSpec {
  action: KnownAction;
  description: string;
  params: Record<string, { type: string; required: boolean; description: string }>;
  examples: string[];
  aliases: string[];
}

export const ACTION_CATALOG: ActionSpec[] = [
  {
    action: 'wallet_create',
    description: 'Deploy a new ERC-4337 smart wallet for an agent',
    params: {
      ownerAddress: { type: 'string (0x...)', required: true, description: 'Ethereum address of the wallet owner' },
      harnessId: { type: 'string', required: false, description: 'AI harness identifier (e.g. "claude-code")' },
    },
    examples: [
      'create a wallet for 0xABC...',
      'deploy a new agent wallet',
      'set up a wallet for my agent',
      'make wallet for owner 0x123...',
    ],
    aliases: ['new_wallet', 'deploy_wallet', 'make_wallet', 'create_wallet'],
  },
  {
    action: 'wallet_execute',
    description: 'Execute a transaction from an agent wallet (send ETH or call a contract)',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      target: { type: 'string (0x...)', required: true, description: 'Recipient or contract address' },
      value: { type: 'string (wei)', required: false, description: 'ETH value in wei (default: "0")' },
      data: { type: 'string (hex)', required: false, description: 'Calldata for contract interaction (default: "0x")' },
    },
    examples: [
      'send 5 ETH to 0xABC...',
      'transfer 0.1 eth to 0xDEF...',
      'execute transaction on wallet 0x123... targeting 0x456...',
      'pay 2 ETH from my agent wallet',
      'move some ETH to my cold wallet',
    ],
    aliases: ['send', 'transfer', 'pay', 'move_eth', 'execute'],
  },
  {
    action: 'wallet_execute_batch',
    description: 'Execute multiple transactions in a single batch from an agent wallet',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      targets: { type: 'string[]', required: true, description: 'Array of target addresses' },
      values: { type: 'string[]', required: true, description: 'Array of ETH values in wei' },
      calldatas: { type: 'string[]', required: true, description: 'Array of calldata hex strings' },
    },
    examples: [
      'batch execute 3 transactions from wallet 0x...',
      'send ETH to multiple recipients at once',
    ],
    aliases: ['batch_execute', 'batch_send'],
  },
  {
    action: 'wallet_deposit',
    description: 'Deposit ETH into the wallet or EntryPoint for gas',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      amount: { type: 'string (wei)', required: true, description: 'Amount to deposit in wei' },
    },
    examples: [
      'deposit 0.01 ETH to wallet 0x...',
      'fund my agent wallet with gas',
      'add gas deposit to the wallet',
    ],
    aliases: ['deposit', 'fund_wallet', 'add_gas'],
  },
  {
    action: 'wallet_withdraw',
    description: 'Withdraw ETH from the wallet EntryPoint deposit',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      amount: { type: 'string (wei)', required: true, description: 'Amount to withdraw in wei' },
    },
    examples: [
      'withdraw 0.01 ETH from wallet 0x...',
      'pull funds from the entrypoint deposit',
    ],
    aliases: ['withdraw', 'pull_funds'],
  },
  {
    action: 'wallet_transfer_ownership',
    description: 'Transfer wallet ownership to a new address (irreversible)',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      newOwner: { type: 'string (0x...)', required: true, description: 'New owner address' },
    },
    examples: [
      'transfer ownership of wallet 0x... to 0x...',
      'change wallet owner to 0xABC...',
    ],
    aliases: ['change_owner', 'transfer_ownership'],
  },
  {
    action: 'session_create',
    description: 'Create a ZK-proof-gated session (requires active credential)',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      sessionKey: { type: 'string (0x...)', required: true, description: 'Session key address' },
      maxValue: { type: 'string (wei)', required: true, description: 'Max spend per session in wei' },
      expiry: { type: 'number (unix)', required: true, description: 'Session expiry timestamp' },
      credentialId: { type: 'string', required: true, description: 'ID of the credential to use' },
    },
    examples: [
      'create a ZK session for wallet 0x...',
      'open a session with credential for 0.5 ETH limit',
    ],
    aliases: ['new_session', 'open_session', 'start_session'],
  },
  {
    action: 'session_create_lightweight',
    description: 'Create a lightweight session (owner-signed, no ZK proof)',
    params: {
      walletAddress: { type: 'string (0x...)', required: true, description: 'The agent wallet address' },
      sessionKey: { type: 'string (0x...)', required: false, description: 'Session key address' },
      dailyLimit: { type: 'string (wei)', required: false, description: 'Daily spend limit' },
      expiry: { type: 'number (unix)', required: false, description: 'Session expiry timestamp' },
    },
    examples: [
      'create a session on wallet 0x...',
      'start a lightweight session for my agent',
      'set up a session with 0.1 ETH daily limit',
    ],
    aliases: ['new_session', 'start_session', 'create_session'],
  },
  {
    action: 'session_revoke',
    description: 'Revoke an active session',
    params: {
      sessionId: { type: 'string', required: true, description: 'The session ID to revoke' },
    },
    examples: [
      'revoke session 0xABC...',
      'kill the current session',
      'end session on wallet 0x...',
      'stop the session',
    ],
    aliases: ['kill_session', 'end_session', 'revoke_session', 'stop_session'],
  },
  {
    action: 'session_validate',
    description: 'Check if a session is still valid',
    params: {
      sessionId: { type: 'string', required: true, description: 'The session ID' },
      signer: { type: 'string (0x...)', required: true, description: 'Session key address' },
    },
    examples: ['is session 0x... still valid?', 'check session status'],
    aliases: ['check_session', 'validate_session'],
  },
  {
    action: 'credential_issue',
    description: 'Issue a credential to an agent within an organization',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
      agentId: { type: 'number', required: true, description: 'Agent identifier' },
      budgetLimit: { type: 'string (wei)', required: true, description: 'Max budget for the credential' },
      expiry: { type: 'number (unix)', required: true, description: 'Credential expiry timestamp' },
      walletAddress: { type: 'string (0x...)', required: false, description: 'Bound wallet address' },
    },
    examples: [
      'issue credential to agent 42 in org 1',
      'give agent 7 a credential for 1 ETH budget',
      'create a credential for the next month',
      'authorize agent 42 with 0.5 ETH limit',
    ],
    aliases: ['new_credential', 'give_credential', 'issue_cred', 'create_credential'],
  },
  {
    action: 'credential_revoke',
    description: 'Revoke an agent credential',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
      agentId: { type: 'number', required: true, description: 'Agent identifier' },
    },
    examples: [
      'revoke credential of agent 42',
      'remove credential for agent 7 in org 1',
      'deauthorize agent 42',
    ],
    aliases: ['remove_credential', 'revoke_cred'],
  },
  {
    action: 'credential_update_root',
    description: 'Push a new Merkle root on-chain for the active or revoked tree',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
      rootType: { type: 'string', required: true, description: '"active" or "revoked"' },
    },
    examples: ['update the credential root for org 1', 'anchor the merkle root on-chain'],
    aliases: ['update_root', 'anchor_root'],
  },
  {
    action: 'organization_register',
    description: 'Register a new organization on-chain',
    params: {
      name: { type: 'string', required: true, description: 'Organization name' },
      ownerAddress: { type: 'string (0x...)', required: false, description: 'Owner address' },
    },
    examples: [
      'register organization "Acme AI"',
      'create a new org called "My Company"',
      'set up organization for my agents',
    ],
    aliases: ['new_org', 'register_org', 'create_org'],
  },
  {
    action: 'organization_deactivate',
    description: 'Deactivate an organization (revokes all its agents)',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
    },
    examples: ['deactivate org 1', 'shut down organization 0x...'],
    aliases: ['deactivate_org', 'disable_org'],
  },
  {
    action: 'organization_reactivate',
    description: 'Reactivate a previously deactivated organization',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
    },
    examples: ['reactivate org 1', 'bring organization back online'],
    aliases: ['reactivate_org', 'enable_org'],
  },
  {
    action: 'capability_register',
    description: 'Register a new capability (action the agent can perform)',
    params: {
      action: { type: 'string', required: true, description: 'The capability action name' },
      constraints: { type: 'object', required: false, description: 'Capability constraints' },
    },
    examples: [
      'register capability "send_email"',
      'add a new capability for data export',
    ],
    aliases: ['new_capability', 'add_capability', 'create_capability'],
  },
  {
    action: 'capability_revoke',
    description: 'Revoke a registered capability',
    params: {
      capabilityId: { type: 'string', required: true, description: 'Capability ID to revoke' },
    },
    examples: ['revoke capability "send_email"'],
    aliases: ['remove_capability'],
  },
  {
    action: 'delegation_create',
    description: 'Create a trust delegation from one agent to another',
    params: {
      delegator: { type: 'string (0x...)', required: true, description: 'Delegating address' },
      delegatee: { type: 'string (0x...)', required: true, description: 'Address being delegated to' },
      scope: { type: 'string', required: true, description: 'Delegation scope/permission' },
      expiry: { type: 'number (unix)', required: false, description: 'Delegation expiry' },
    },
    examples: [
      'create delegation from 0xABC... to 0xDEF...',
      'delegate authority to 0x123...',
      'trust 0x456... with read access',
    ],
    aliases: ['new_delegation', 'delegate', 'trust_agent'],
  },
  {
    action: 'delegation_revoke',
    description: 'Revoke an existing delegation',
    params: {
      delegationId: { type: 'string', required: true, description: 'Delegation ID to revoke' },
    },
    examples: ['revoke delegation 0x...', 'remove trust from 0x...'],
    aliases: ['remove_delegation'],
  },
  {
    action: 'identity_link_credential',
    description: 'Link a credential to an on-chain identity',
    params: {
      identityId: { type: 'number', required: true, description: 'Identity ID' },
      credentialId: { type: 'string', required: true, description: 'Credential ID' },
    },
    examples: ['link credential to identity 42'],
    aliases: ['link_credential'],
  },
  {
    action: 'identity_update_metadata',
    description: 'Update the metadata root for an identity',
    params: {
      identityId: { type: 'number', required: true, description: 'Identity ID' },
      metadataRoot: { type: 'string (bytes32)', required: true, description: 'New metadata Merkle root' },
    },
    examples: ['update metadata for identity 42'],
    aliases: ['update_identity'],
  },
  {
    action: 'proof_generate',
    description: 'Generate a Groth16 zero-knowledge proof for a credential',
    params: {
      organizationId: { type: 'string', required: true, description: 'Organization ID' },
      agentId: { type: 'number', required: true, description: 'Agent identifier' },
      sessionNonce: { type: 'string', required: true, description: 'Session nonce for nullifier uniqueness' },
    },
    examples: ['generate a ZK proof for agent 42 in org 1', 'create proof for my credential'],
    aliases: ['generate_proof', 'create_proof', 'prove_credential'],
  },
  {
    action: 'proof_verify',
    description: 'Verify an existing ZK proof',
    params: {
      proofHash: { type: 'string', required: true, description: 'Hash of the proof to verify' },
    },
    examples: ['verify proof 0x...', 'check if this proof is valid'],
    aliases: ['verify_proof'],
  },
];

// ── Classification prompt returned to the agent ────────────────────────────

export function buildClassificationPrompt(): string {
  const actionList = ACTION_CATALOG.map((spec) => {
    const paramLines = Object.entries(spec.params)
      .map(([name, p]) => `    - ${name} (${p.type})${p.required ? ' [REQUIRED]' : ' [optional]'}: ${p.description}`)
      .join('\n');
    const exampleLines = spec.examples.map((e) => `    - "${e}"`).join('\n');
    const aliasStr = spec.aliases.length > 0 ? `\n  Aliases: ${spec.aliases.join(', ')}` : '';
    return `• ${spec.action}${aliasStr}\n  ${spec.description}\n  Params:\n${paramLines}\n  Example inputs:\n${exampleLines}`;
  }).join('\n\n');

  return `You are an intent classifier for the AgentIX blockchain agent system.

Given a user's natural language request, classify it into one of the known actions
and extract the relevant parameters.

## Known Actions

${actionList}

## Classification Rules

1. Pick the BEST matching action from the list above.
2. Extract all parameters the user mentioned or implied.
3. For addresses: must be 0x-prefixed hex (40 hex chars for addresses, 64 for IDs).
4. For values: convert human-readable amounts to wei strings (1 ETH = 1000000000000000000 wei).
5. For timestamps: convert relative time ("next month", "in 24 hours") to unix timestamps.
6. If the user's request is ambiguous, pick the most likely action and note ambiguity in metadata.
7. If the request doesn't match ANY action, return action: "unknown" with raw text in params.

## Response Format

Return a JSON object matching this schema:
{
  "action": "<one of the known actions>",
  "params": { ... },
  "source": "nl",
  "confidence": 0.0-1.0,
  "ambiguity": "none" | "low" | "medium" | "high",
  "notes": "<any clarification needed>"
}`;
}

// ── Param schema for StructuredIntent (used by compile_intent) ──────────────

export function getStructuredIntentSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...KNOWN_ACTIONS],
        description: 'The classified action',
      },
      params: {
        type: 'object',
        description: 'Extracted parameters matching the action schema',
        additionalProperties: true,
      },
      source: {
        type: 'string',
        enum: ['nl'],
        description: 'Intent source — always "nl" for natural language',
      },
    },
    required: ['action', 'params'],
  };
}

// ── Get action spec by name ─────────────────────────────────────────────────

export function getActionSpec(action: string): ActionSpec | undefined {
  return ACTION_CATALOG.find(
    (s) => s.action === action || s.aliases.includes(action)
  );
}

// ── Validate extracted params against action spec ───────────────────────────

export function validateExtractedParams(
  action: string,
  params: Record<string, unknown>
): { valid: boolean; missing: string[]; warnings: string[] } {
  const spec = getActionSpec(action);
  if (!spec) {
    return { valid: false, missing: [], warnings: [`Unknown action: ${action}`] };
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const [name, def] of Object.entries(spec.params)) {
    if (def.required && !(name in params)) {
      missing.push(name);
    }
  }

  // Validate addresses
  for (const [name, value] of Object.entries(params)) {
    const def = spec.params[name];
    if (!def) continue;
    if (def.type.includes('0x') && typeof value === 'string') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x[a-fA-F0-9]{64}$/.test(value)) {
        warnings.push(`Param "${name}" looks like an address but format is invalid: ${value}`);
      }
    }
  }

  return { valid: missing.length === 0, missing, warnings };
}
