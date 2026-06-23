# AgentIX SDK Documentation

## Installation

```bash
npm install @agentix/sdk
```

## Quick Start

```typescript
import { AgentClient } from "@agentix/sdk";

// Initialize client
const client = new AgentClient("http://localhost:3001");
await client.init();

// Register an agent
const { agentId, orgId } = await client.registerAgent({
  agentName: "Trading Bot",
  orgId: 1,
  permissions: 255,
  expiry: Math.floor(Date.now() / 1000) + 86400,
});

// Create a session
const { session, sessionKey } = await client.createSession({ agentId });
```

## Classes

### AgentClient

Main client for agent lifecycle management.

```typescript
const client = new AgentClient(apiUrl?)
await client.init() // Required - generates secret and initializes Poseidon
```

**Methods:**

| Method | Description |
|--------|-------------|
| `init()` | Initialize client (generates secret, builds Poseidon) |
| `getSecret()` | Get the agent secret (bigint) |
| `computeCommitment(input)` | Compute Poseidon commitment for credential |
| `computeSecretHash()` | Compute Poseidon secret hash for revocation |
| `registerCredential(input)` | Register credential on backend |
| `registerAgent(input)` | Register new agent with platform |
| `createWallet(options?)` | Create ERC-4337 smart wallet |
| `revokeAgent(agentId)` | Revoke agent credential |
| `getAgentState(agentId)` | Get on-chain agent state |
| `getEvents(params?)` | Query on-chain events |
| `syncEvents()` | Trigger event sync |
| `fetchWellKnown()` | Get .well-known/agentix config |
| `verifyAtEndpoint(params)` | Verify proof via backend |
| `queryAuditLogs(params?)` | Query audit logs |
| `getAuditStats(orgId?)` | Get audit statistics |
| `fetchCircuitConfig()` | Get circuit configuration |
| `generateProofRemote(agentId, orgId, action, expiry?)` | Generate proof via backend |
| `verifyProof(proof)` | Verify Groth16 proof locally |
| `createSession(input)` | Create session with local proving |
| `createSessionRemote(input)` | Create session with remote proving |
| `sessionManager()` | Get SessionManager instance |

### SessionManager

Handles ZK proof generation and session submission.

```typescript
const manager = new SessionManager(apiUrl, secret)
```

**Methods:**

| Method | Description |
|--------|-------------|
| `fetchMerkleProof(agentId)` | Fetch Merkle proof from backend |
| `generateProof(agentId, orgId, permissions, expiry, nonce, proof)` | Generate Groth16 proof |
| `createSessionWallet()` | Create random session wallet |
| `submitSession(agentId, zk, sessionKey, sessionId?)` | Submit proof to create session |
| `createSessionId(agentId, sessionKey)` | Generate deterministic session ID |

### AgentVerifier

On-chain verification for credentials, capabilities, delegations, and sessions.

```typescript
import { AgentVerifier } from "@agentix/sdk";

const verifier = new AgentVerifier({
  chainId: 84532,
  rpcUrl: "https://base-sepolia.g.alchemy.com/v2/...",
  credentialRegistry: "0x83e0...",
  sessionManager: "0xcC0a...",
});
await verifier.init();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `verifyCredentialProof(proof, publicSignals, options?)` | Verify ZK credential proof |
| `verifyCapability(check)` | Verify capability grant |
| `verifyDelegation(params)` | Verify delegation chain |
| `verifySessionAuthorization(params)` | Verify session authorization |
| `verifyEIP1271Signature(wallet, digest, sig)` | Verify smart wallet signature |
| `getChainStatus()` | Get chain connectivity status |

**Static Methods:**

| Method | Description |
|--------|-------------|
| `computeGrantLeafHash(...)` | Compute capability grant leaf hash |
| `computeDelegationLeafHash(...)` | Compute delegation leaf hash |
| `computeCommitment(agentId, orgId, permissions, expiry, secret)` | Compute credential commitment |

### AuditClient

Audit logging client with batched flushing.

```typescript
const audit = new AuditClient(apiUrl)
audit.setContext(orgId, agentId)
audit.log({ action: "session.create.local", resourceType: "session" })
await audit.flush()
```

## Types

### CredentialInput

```typescript
interface CredentialInput {
  agentId: number    // Agent ID
  orgId: number      // Organization ID
  permissions: number // Permission bitmask (e.g., 255)
  expiry: number     // Unix timestamp
}
```

### AgentRegistrationInput

```typescript
interface AgentRegistrationInput {
  orgId?: number     // Existing org ID (creates new if omitted)
  orgName?: string   // Organization name (for new org)
  agentName?: string // Agent name
  permissions: number // Permission bitmask
  expiry: number     // Unix timestamp
}
```

### MerkleProof

```typescript
interface MerkleProof {
  activePathElements: string[]   // Merkle path for active tree
  activePathIndices: number[]    // Path indices (0=left, 1=right)
  activeRoot: string             // Active Merkle root
  revokedSiblings: string[]      // Revocation tree siblings
  revokedOldKey: string          // Revocation old key
  revokedOldValue: string        // Revocation old value
  revokedIsOld0: number          // Whether revocation is empty
  revokedRoot: string            // Revocation Merkle root
}
```

### ZKProof

```typescript
interface ZKProof {
  proof: any           // Groth16 proof object
  publicSignals: string[] // [nullifier, activeRoot, revokedRoot, maxValue, expiry]
}
```

### WellKnownConfig

```typescript
interface WellKnownConfig {
  issuer: string
  version: string
  description: string
  docs_url: string
  credential_registry: string | null
  session_manager: string | null
  circuits: CircuitInfo[]
  scopes: ScopeDefinition[]
  endpoints: Record<string, string>
  authentication: AuthConfig
  meta: NetworkMeta
}
```

## Error Handling

The SDK throws standard Error objects. Common errors:

| Error | Cause |
|-------|-------|
| `Circuit files not available` | Missing WASM/zkey in circuits/build/ |
| `Verification key not available` | Backend doesn't have VK configured |
| `Request failed: 401` | Authentication required |
| `Request failed: 404` | Resource not found |

## Security Notes

1. **Secrets never leave the client** in local proving mode
2. **Remote proving sends secret to backend** — only use when local proving unavailable
3. **Credentials are encrypted** in localStorage using Web Crypto API
4. **Session keys are random** — use `createSessionWallet()` for new sessions
5. **All API calls use HTTPS** in production

## Browser Compatibility

The SDK works in both Node.js and browsers:

- **Node.js**: Uses native `crypto` module
- **Browser**: Uses Web Crypto API
- **Circuit files**: Required for local proving (not available in browser)
- **Remote proving**: Available in all environments
