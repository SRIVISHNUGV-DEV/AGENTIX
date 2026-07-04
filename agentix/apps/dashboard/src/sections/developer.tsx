'use client';

import { useState, useEffect } from 'react';
import { Wrench, Terminal, Code, BookOpen, Play, Copy, Check, ChevronDown, ChevronRight, Shield, Wallet, KeyRound, CreditCard, User, GitBranch, ExternalLink } from 'lucide-react';
import { PageHeader, Card, CardHeader, Badge, Button, CodeBlock } from '@/components/ui';
import { fetchJSON, truncate, explorerAddress } from '@/lib/api';

const SDK_EXAMPLES = [
  { label: 'Create Wallet', code: `const ix = new AgentIX(config, signer);\nconst wallet = await ix.wallet.create('0x...');\nconsole.log('Wallet:', wallet.address);` },
  { label: 'Create Session', code: `const result = await ix.sessions.createLightweight({\n  sessionId: ethers.hexlify(ethers.randomBytes(32)),\n  sessionKey: '0x...',\n  dailySpendLimit: ethers.parseEther('0.1'),\n  dailyTxLimit: 10,\n  expiry: Math.floor(Date.now() / 1000) + 86400,\n  allowedTargets: ['0x...'],\n  ownerSignature: '0x...'\n});` },
  { label: 'Query Identity', code: `const identity = await ix.identity.getByWallet('0x...');\nconsole.log('Identity ID:', identity.identityId);\nconsole.log('Active:', identity.active);\nconsole.log('Metadata:', identity.metadataRoot);` },
  { label: 'Verify Credential', code: `const used = await ix.credentials.isNullifierUsed(nullifier);\nconsole.log('Nullifier used:', used);\n\nconst info = await ix.credentials.getInfo();\nconsole.log('Active root:', info.activeRoot);` },
];

const PROTOCOL_DOCS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    desc: 'Initialize the runtime and connect to the network',
    icon: Terminal,
    content: `## Quick Start

### 1. Initialize the Runtime
\`\`\`bash
cd agentix
npm install && npm run build
node dist/src/index.js init
\`\`\`

This creates the \`~/.agentix/\` directory structure, initializes the SQLite database, and configures the RPC connection to Base Sepolia.

### 2. Verify System Health
\`\`\`bash
node dist/src/index.js doctor
\`\`\`

Runs 8-point diagnostics: Node.js, NPM, SQLite, Runtime, Database, Storage, Network, Contracts.

### 3. Start the Dashboard
\`\`\`bash
# Terminal 1: API Server
bun x tsx src/runtime/server.ts

# Terminal 2: Dashboard
cd apps/dashboard && npm run dev
\`\`\`

Open \`http://localhost:3000\` — the onboarding wizard guides you through connecting a wallet and deploying your first agent.

### 4. Create Your First Organization
Organizations are the top-level container for agents, credentials, and sessions. Request an org via the dashboard, then approve it (you're the admin on local dev).

### 5. Issue a Credential
Credentials use Poseidon(7) hashing over 7 fields: \`agentId, orgId, budget, wallet, expiry, version, secret\`. The commitment is inserted into the org's Merkle tree. A Groth16 ZK proof can then prove credential possession without revealing the secret.`
  },
  {
    id: 'wallet-operations',
    title: 'Wallet Operations',
    desc: 'ERC-4337 smart wallet creation and execution',
    icon: Wallet,
    content: `## ERC-4337 Smart Wallets

AgentIX deploys ERC-4337 compatible smart wallets via the \`AgentWalletFactory\`. Each wallet is a UUPS proxy clone of the \`AgentWallet\` implementation.

### Architecture
\`\`\`
AgentWalletFactory (proxy)
  └── createWallet(owner, salt, sessionManager, entryPoint)
        └── Deploys AgentWallet clone via ERC1967Proxy
              ├── owner: address (EOA that controls the wallet)
              ├── sessionManager: SessionManager contract address
              └── entryPoint: ERC-4337 EntryPoint (0x4337...08)
\`\`\`

### Key Operations
- **Execute**: \`wallet.execute(target, value, data)\` — only owner or EntryPoint
- **Batch Execute**: \`wallet.executeBatch(targets, values, datas)\` — atomic multi-call
- **Deposit**: \`wallet.addDeposit()\` — fund EntryPoint gas (payable)
- **Whitelist**: \`wallet.whitelistSelector(target, selector, allowed)\` — pre-approve selectors

### Two-Phase Client Flow
1. Client calls \`POST /api/wallets/create-tx\` → gets encoded factory calldata
2. User signs via MetaMask (\`eth_sendTransaction\`)
3. Client calls \`POST /api/wallets/confirm\` → server records in DB

### Security
- ProxyGuard validates all addresses — blocks interaction with implementation contracts
- Only proxy addresses are returned to clients
- \`receive()\` accepts ETH from anyone (standard smart contract wallet behavior)`
  },
  {
    id: 'session-management',
    title: 'Session Management',
    desc: 'Lightweight sessions with EIP-712 signing',
    icon: KeyRound,
    content: `## Session Management

Sessions authorize agents to execute transactions within defined limits without requiring the owner to sign every transaction.

### Lightweight Sessions
The primary session type. Created via a two-step process:

#### Step 1: Prepare (Server)
The server computes the exact \`messageHash\` the contract will verify:
\`\`\`solidity
bytes32 messageHash = keccak256(abi.encode(
    chainId, sessionManager, wallet, sessionId,
    sessionKey, dailySpendLimit, dailyTxLimit, expiry, allowedTargets
));
\`\`\`

#### Step 2: Sign (Client)
The wallet owner signs via \`personal_sign\` (EIP-191 prefix):
\`\`\`
\\x19Ethereum Signed Message:\\n32 + messageHash
\`\`\`

#### Step 3: Execute (Client → Contract)
The signed calldata is sent to the wallet, which forwards to \`SessionManager.createLightweightSession()\`.

### Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| \`sessionId\` | bytes32 | Unique identifier (random 32 bytes) |
| \`sessionKey\` | address | Address authorized to sign txs |
| \`dailySpendLimit\` | uint256 | Max wei spendable per day |
| \`dailyTxLimit\` | uint256 | Max transactions per day |
| \`expiry\` | uint64 | Unix timestamp when session expires |
| \`allowedTargets\` | address[] | Restrict to specific contracts (empty = any) |

### ERC-4337 Bundler Flow
For agent-signed transactions (no MetaMask):
1. Agent signs a UserOperation with its session key
2. Bundler wraps it in a UserOp and submits to EntryPoint
3. EntryPoint calls \`wallet.execute()\` which validates the session on-chain`
  },
  {
    id: 'credential-system',
    title: 'Credential System',
    desc: 'Poseidon(7) ZK credentials with Merkle trees',
    icon: CreditCard,
    content: `## ZK Credential System

Credentials are zero-knowledge proofs of authorization. They allow agents to prove they have valid credentials without revealing the underlying secret.

### Credential Structure
Each credential is a Poseidon(7) hash of:
\`\`\`
commitment = Poseidon(agentId, orgId, budgetLimit, wallet, expiry, version, secret)
\`\`\`

- \`agentId\`: Unique agent identifier within the org
- \`orgId\`: Numeric organization ID
- \`budgetLimit\`: Maximum ETH budget (in wei)
- \`wallet\`: The agent's wallet address
- \`expiry\`: Block number when credential expires
- \`version\`: Credential version (currently 1)
- \`secret\`: Random 32-byte secret (known only to the agent)

### Merkle Tree
Commitments are inserted into a depth-20 Poseidon Merkle tree (1,048,576 slots). The root is published on-chain via \`CredentialRegistry.updateActiveRoot()\`.

### ZK Proof Flow
1. Agent generates a Groth16 proof proving:
   - It knows a valid \`secret\` such that \`Poseidon(...)\` is in the Merkle tree
   - The credential is not revoked (not in the revocation tree)
   - The wallet address matches (bound in \`publicSignals[5]\`)
2. Verifier contract (\`Groth16Verifier\`) validates the proof on-chain
3. The nullifier is marked as used to prevent double-spending

### Revocation
Revoked credentials have their nullifier inserted into a separate revocation Merkle tree. The ZK circuit checks that the credential's nullifier is NOT in the revocation tree.

### Important
- Credentials REQUIRE an organization. Standalone wallets use lightweight sessions directly.
- The secret is shown once at issuance — store it securely.
- The backend signer must be registered as an issuer on the CredentialRegistry.`
  },
  {
    id: 'identity-system',
    title: 'Identity System',
    desc: 'On-chain agent identity linking',
    icon: User,
    content: `## AgentIdentity Contract

The \`AgentIdentity\` contract provides on-chain identity management, linking wallet addresses to persistent identity records.

### Key Functions
- \`identityOf(address wallet) → uint256\`: Get identity ID for a wallet
- \`walletOf(uint256 identityId) → address\`: Get wallet for an identity
- \`isActive(uint256 identityId) → bool\`: Check if identity is active
- \`metadataOf(uint256 identityId) → bytes32\`: Get metadata root hash
- \`timestampsOf(uint256 identityId) → (createdAt, updatedAt)\`

### Identity Lifecycle
1. **Register**: A wallet registers an identity on-chain
2. **Link Wallet**: Additional wallets can be linked to the same identity
3. **Link Credential**: Credentials can be linked to an identity
4. **Update Metadata**: The metadata root can be updated (stores arbitrary data off-chain)
5. **Deactivate/Reactivate**: Identity can be temporarily disabled

### Dashboard Integration
The Agents page shows identity status for each wallet. The identity is read directly from the contract — there's no local database copy. If \`identityOf(wallet)\` returns 0, no identity exists for that wallet.

### Use Cases
- Multi-wallet agent management (one identity, multiple wallets)
- Credential aggregation (all credentials linked to one identity)
- Reputation tracking (identity persists across wallet rotations)`
  },
  {
    id: 'delegation-capabilities',
    title: 'Delegations & Capabilities',
    desc: 'Scope-based delegation and capability grants',
    icon: GitBranch,
    content: `## Delegation System

The \`DelegationManager\` contract enables scope-based delegation — allowing one agent to act on behalf of another within defined boundaries.

### Delegation Model
- **Delegator**: The agent granting authority
- **Delegatee**: The agent receiving authority
- **Scope**: A named action domain (e.g., "trading", "governance")
- **Grant Root**: A Merkle root containing authorized delegation leaves

### Key Functions
- \`updateDelegationRoot(scopeHash, newRoot, expiresAt)\`: Publish a new delegation Merkle root
- \`verifyDelegation(leaf, proof, delegator, scopeHash)\`: Verify a delegation proof on-chain
- \`revokeDelegation(leafHash)\`: Revoke a specific delegation leaf
- \`revokeDelegator(delegator)\`: Revoke all delegations from a delegator

## Capability System

The \`CapabilityRegistry\` contract manages on-chain capability grants.

### Capability Model
- **Capability**: A named action (e.g., "transfer", "approve")
- **Grant Root**: Per-grantor-grantee Merkle root of authorized capabilities
- **Revocation**: Individual capability grants can be revoked

### Key Functions
- \`registerCapability(actionHash)\`: Register a new capability type
- \`updateGrantRoot(grantee, capabilityId, newRoot)\`: Update grant Merkle root
- \`verifyCapability(leaf, proof, grantor, grantee, capabilityId)\`: Verify on-chain
- \`revokeCapability(capabilityId)\`: Revoke a capability entirely`
  },
];

export function DeveloperPage() {
  const [selectedExample, setSelectedExample] = useState(SDK_EXAMPLES[0]);
  const [copied, setCopied] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchJSON<Record<string, string>>('/api/contracts').then(setContracts).catch(() => {});
  }, []);

  const copyCode = () => {
    navigator.clipboard.writeText(selectedExample.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderMarkdown = (md: string) => {
    return md.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h4 key={i} className="text-xs font-semibold mt-4 mb-1.5 text-foreground">{line.slice(4)}</h4>;
      if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold mt-5 mb-2 text-foreground">{line.slice(3)}</h3>;
      if (line.startsWith('#### ')) return <h5 key={i} className="text-[11px] font-semibold mt-3 mb-1 text-foreground/80">{line.slice(5)}</h5>;
      if (line.startsWith('```')) return null; // skip fences
      if (line.startsWith('- ')) return <div key={i} className="text-[11px] text-muted-foreground/80 ml-3 before:content-['•'] before:mr-2 before:text-muted-foreground/40">{line.slice(2)}</div>;
      if (line.startsWith('| ')) {
        const cells = line.split('|').filter(Boolean).map(c => c.trim());
        return <div key={i} className="text-[10px] font-mono text-muted-foreground/70 ml-3">{cells.join(' | ')}</div>;
      }
      if (line.trim() === '') return <div key={i} className="h-2" />;
      return <p key={i} className="text-[11px] text-muted-foreground/80 leading-relaxed">{line}</p>;
    });
  };

  return (
    <div>
      <PageHeader title="Developer Tools" description="SDK playground, protocol reference, and contract browser" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SDK Playground */}
        <Card>
          <CardHeader title="SDK Playground"
            action={<div className="flex gap-1"><Button variant="ghost" size="sm" icon={copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} onClick={copyCode} /><Button variant="ghost" size="sm" icon={<Play className="w-3 h-3" />} /></div>}
          />
          <div className="space-y-3">
            <div className="flex gap-1 flex-wrap">
              {SDK_EXAMPLES.map(ex => (
                <button key={ex.label} onClick={() => setSelectedExample(ex)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                    selectedExample.label === ex.label ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}>
                  {ex.label}
                </button>
              ))}
            </div>
            <CodeBlock>{selectedExample.code}</CodeBlock>
          </div>
        </Card>

        {/* Contract Browser */}
        <Card>
          <CardHeader title="Contract Browser" />
          <div className="space-y-2">
            {Object.entries(contracts).length > 0 ? Object.entries(contracts).map(([name, addr]) => (
              <div key={name} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
                <div>
                  <div className="text-xs font-medium">{name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">{addr}</div>
                </div>
                <a href={explorerAddress(addr)} target="_blank" rel="noopener noreferrer"
                  className="text-muted-foreground/40 hover:text-foreground transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )) : (
              <div className="text-xs text-muted-foreground/50 py-4 text-center">Loading contracts...</div>
            )}
          </div>
        </Card>

        {/* Protocol Reference — full width */}
        <Card className="lg:col-span-2">
          <CardHeader title="Protocol Reference" />
          <div className="space-y-1">
            {PROTOCOL_DOCS.map(doc => {
              const Icon = doc.icon;
              const isExpanded = expandedDoc === doc.id;
              return (
                <div key={doc.id} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-accent transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium">{doc.title}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">{doc.desc}</div>
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-border bg-secondary/20">
                      {renderMarkdown(doc.content)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Environment */}
        <Card className="lg:col-span-2">
          <CardHeader title="Environment" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Runtime</div><div className="text-xs font-mono mt-1">v1.0.0</div></div>
            <div><div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">SDK</div><div className="text-xs font-mono mt-1">v1.0.0</div></div>
            <div><div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Network</div><div className="text-xs font-mono mt-1">Base Sepolia (84532)</div></div>
            <div><div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Database</div><div className="text-xs font-mono mt-1">SQLite (WAL)</div></div>
            <div><div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Storage</div><div className="text-xs font-mono mt-1">~/.agentix/</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
