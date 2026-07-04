import { loadConfig } from "../core/config";

const PROTOCOL_DOCS = `
AgentIX V1 — Protocol Reference for AI Agents
═══════════════════════════════════════════════

## What is AgentIX?
AgentIX is a local-first operating system for AI agents. It manages credentials,
permissions, sessions, and smart wallet execution — all running locally on your machine.

Think of it as a trust layer for AI agents. Organizations issue credentials to agents,
and agents use those credentials to create sessions and execute transactions through
smart wallets on Base (Ethereum L2).

## How Organizations Work
An organization is the root entity. It registers on-chain and gets a credential anchor
that holds Merkle roots. Organizations issue credentials to AI agents.
- Create: agentix org create --name "My Org" --owner 0x...
- List: agentix org list

## How Credentials Work
Credentials are issued by organizations to agents. Each credential has:
- agentId (unique within the org)
- permissions (what the agent can do)
- expiry (when the credential expires)
- nullifier (unique hash for replay protection)
Credentials are stored locally and committed on-chain via Merkle roots.
- Issue: agentix cred issue --org <orgId> --agent <agentId> --permissions 1
- List: agentix cred list --org <orgId>

## How Merkle Trees Work
Each organization has two Merkle trees:
- ActiveTree: Contains all valid credentials
- RevokedTree: Contains revoked credential nullifiers
Trees use Poseidon hash and are committed on-chain for verification.
- Status: agentix tree status <orgId>
- Rebuild: agentix tree rebuild <orgId>

## How Proofs Work
ZK proofs (Groth16) prove credential validity without revealing the credential itself.
Public signals: nullifier, activeRoot, revokedRoot, permissions, sessionExpiry, wallet.
- Generate: agentix proof generate --org <orgId> --agent <agentId>
- Verify: agentix proof verify --hash <proofHash>

## How Sessions Work
Sessions authorize wallets to execute transactions. Two types:
- Lightweight: Created with owner signature (fast, no ZK proof needed)
- Full: Created with ZK proof of credential validity
Sessions have daily spend limits, daily tx limits, and expiry.
- Create: agentix session create --wallet <addr> --session-key <key>
- Validate: agentix session validate <sessionId> --signer <addr>

## How Replay Protection Works
Each credential has a unique nullifier. When a session is used, the nullifier is
marked as "used" on-chain. If someone tries to use the same nullifier again,
the transaction is rejected. This prevents replay attacks.

## How Wallets Work
AgentWallets are ERC-4337 smart accounts (like a bank account for your AI agent).
- Owner: Can manage sessions, whitelist addresses
- Whitelist: Addresses the wallet can send ETH to
- EntryPoint deposit: Pre-funded gas for sponsored transactions
- Create: agentix wallet create --owner <address>
- Execute: agentix wallet execute <wallet> --to <target> --value <eth>

## How Capabilities Work
Capabilities are on-chain registrations of what an organization's agents can do.
- Register: agentix capability register --org <orgId> --name "Trade" --description "Execute trades"
- List: agentix capability list --org <orgId>

## How Delegations Work
Delegations let an agent delegate specific scopes to another address.
- Create: agentix delegation create --delegator <addr> --delegatee <addr> --scope "trade"
- List: agentix delegation list --org <orgId>

## How Backups Work
AgentIX automatically backs up your local data. You can create, list, and restore backups.
- Create: agentix backup create
- List: agentix backup list
- Restore: agentix backup restore <id>

## How the Local Runtime Works
Everything runs locally on your machine:
- SQLite database at ~/.agentix/db/agentix.db
- MCP server provides tools to AI agents
- Dashboard at localhost:3000
- API server at localhost:3001
No centralized servers. Your data stays on your machine.

## How Proxies Work
All on-chain contracts use the proxy pattern (UUPS upgradeable). This means:
- Proxy addresses are stable (never change)
- Implementation can be upgraded
- NEVER interact with implementation addresses directly
Use 'agentix contracts list' to see all proxy addresses.

## How Authority Approval Works
New organizations must be approved by the authority before they can issue credentials.
This prevents unauthorized organizations from creating credentials.
- Submit request: agentix org request --name "My Org" --owner <addr>
- Approve: authority approves via EIP-712 signature

## How to Recover from Corruption
1. Check what's wrong: agentix doctor
2. List available backups: agentix backup list
3. Restore from backup: agentix backup restore <id>
4. Rebuild Merkle trees: agentix tree rebuild <orgId>
5. Verify everything works: agentix doctor

## How to Migrate Machines
1. Create a full backup: agentix backup create
2. Export it: agentix backup export <id> --file backup.tar.gz
3. On new machine: agentix init
4. Import the backup: agentix backup import --file backup.tar.gz
5. Verify: agentix doctor

## Getting ETH for Testing
Run: agentix fund --network baseSepolia --amount 10
This shows the best fiat on-ramp options (MoonPay, Coinbase, Transak, Ramp).
AgentIX only recommends official providers — never executes purchases.
`;

export function getHelp(topic?: string): string {
  if (!topic) return PROTOCOL_DOCS;

  const topics: Record<string, string> = {
    organization: `
### Organizations
Register an organization:
  agentix org create --name "My Org" --owner 0x...

List organizations:
  agentix org list

Get organization details:
  agentix org get <orgId>
`,
    credential: `
### Credentials
Issue a credential:
  agentix cred issue --org <orgId> --agent <agentId> --permissions <bits> --expiry <seconds>

List credentials:
  agentix cred list --org <orgId>

Revoke a credential:
  agentix cred revoke --org <orgId> --agent <agentId>
`,
    session: `
### Sessions
Create a lightweight session:
  agentix session create --wallet <address> --session-key <key> --expiry <seconds>

Create a full session (with ZK proof):
  agentix session create-zk --wallet <address>

Validate a session:
  agentix session validate <sessionId> --signer <address> --value <amount>

Revoke a session:
  agentix session revoke <sessionId> --wallet <address>
`,
    wallet: `
### Wallets
Create a wallet via factory:
  agentix wallet create --owner <address>

Get wallet info:
  agentix wallet get <walletAddress>

Whitelist an address:
  agentix wallet whitelist <walletAddress> <partyAddress>

Execute a transaction:
  agentix wallet execute <walletAddress> --to <addr> --value <eth>
`,
    tree: `
### Merkle Trees
Show tree status:
  agentix tree status <orgId>

Rebuild tree:
  agentix tree rebuild <orgId>

Export tree:
  agentix tree export <orgId>

Import tree:
  agentix tree import <orgId> --file <path>

Snapshot tree:
  agentix tree snapshot <orgId>
`,
    delegation: `
### Delegations
Create a delegation:
  agentix delegation create --org <orgId> --delegator <addr> --delegatee <addr> --scope <scope>

List delegations:
  agentix delegation list --org <orgId>

Revoke a delegation:
  agentix delegation revoke <delegationId>
`,
    capability: `
### Capabilities
Register a capability:
  agentix capability register --org <orgId> --name "Capability" --description "Description"

List capabilities:
  agentix capability list --org <orgId>
`,
    backup: `
### Backups
Create backup:
  agentix backup create

List backups:
  agentix backup list

Restore backup:
  agentix backup restore <backupId>

Export backup:
  agentix backup export <backupId> --file <path>
`,
    trust: `
### Trust Boundary Documentation
The trust chain in AgentIX flows:

1. OrganizationRegistry (proxy) → Organization
2. OrganizationCredentialAnchor → Credential roots
3. CredentialRegistry (proxy) → Active/Revoked roots
4. SessionManager (proxy) → Sessions
5. AgentWalletFactory (proxy) → Wallets
6. AgentWallet → Transaction execution

NEVER:
- Interact with implementation contracts
- Mix organization data
- Delete Merkle tree data
- Skip proxy validation

ALWAYS:
- Validate addresses before interaction
- Use proxy addresses only
- Verify organization isolation
- Backup before destructive operations
`,
    proxy: `
### Proxy Enforcement
Every tool validates addresses via ProxyGuard:

1. Checks if address is an implementation contract
2. Blocks interaction with implementation addresses
3. Warns if address is not the expected proxy
4. Returns only proxy addresses

To see all proxy addresses:
  agentix contracts list
`,
    recovery: `
### Corruption Recovery
Steps to recover from data corruption:

1. Diagnose: agentix doctor
2. List backups: agentix backup list
3. Restore: agentix backup restore <id>
4. Rebuild trees: agentix tree rebuild <orgId>
5. Verify: agentix doctor

For database corruption:
  agentix doctor --check-db

For tree corruption:
  agentix tree rebuild <orgId> --force
`,
    migration: `
### Machine Migration
To migrate AgentIX to another machine:

1. Export all data:
   agentix backup create
   agentix backup export <id> --file backup.tar.gz

2. On new machine:
   agentix init
   agentix backup import --file backup.tar.gz
   agentix doctor

3. Verify:
   agentix contracts list
   agentix doctor --full
`,
  };

  return topics[topic] || `Unknown topic: ${topic}\nAvailable topics: ${Object.keys(topics).join(", ")}`;
}
