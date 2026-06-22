# AgentIX Data Flow Map

Per-contract analysis of who writes, reads, validates, transforms, consumes events, updates state, and caches state.

---

## CredentialRegistry (0xC3F474e08Fe68bBa39daCCE52FC4F11262364701)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `platform.ts` | `updateActiveRoot(newRoot)` | Merkle root of all active credentials |
| Backend `platform.ts` | `updateRevokedSecretRoot(newRoot)` | Merkle root of revoked credentials |
| Backend `blockchain.ts` | `setSessionManager(sm, allowed)` | Authorize SessionManager contract |
| Backend `externalAgent.ts` | `updateActiveRoot`, `updateRevokedSecretRoot` | Root updates on credential issue/revoke |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `merkle.ts` | `activeRoot()` | Current credential tree root |
| Backend `merkle.ts` | `revokedSecretRoot()` | Current revoked tree root |
| Backend `externalAgent.ts` | `isNullifierUsed(nullifier)` | Check if credential already used |
| SessionManager contract | `activeRoot()`, `revokedSecretRoot()`, `isNullifierUsed()` | ZK session creation validation |
| SDK `verifier.ts` | `activeRoot()`, `revokedSecretRoot()`, `isNullifierUsed()` | On-chain proof verification |

### Who Validates Data
- **SessionManager contract**: Validates public signals match `activeRoot`, `revokedSecretRoot`, nullifier state
- **Groth16Verifier contract**: Validates ZK proof cryptographic correctness

### Who Transforms Data
- **Backend `merkle.ts`**: Builds Poseidon Merkle tree from credentials, computes root
- **Backend `revocationTree.ts`**: Builds Sparse Merkle Tree for revoked secrets

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `ActiveRootUpdated`, `RevokedSecretRootUpdated` events → stores in `contract_events` table

### Who Caches State
- **Backend `merkle.ts`**: In-memory Merkle tree cache (60s TTL)
- **Backend `proof_cache` table**: Cached proof results

---

## SessionManager (0x98b4516fbf913c7fD94E87dE98788d4dD1da06E2)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `blockchain.ts` | `createSession(...)` | Create ZK session with proof |
| Backend `sessionsSimple.ts` | `createSession(...)` | Simplified session creation |
| Backend `sessions.ts` route | `createSession(...)` | Session via API |
| SDK `SessionManager.ts` | `submitSession(...)` | Submit session from client |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `sessions.ts` | `sessions(id)` | Session details |
| AgentWallet contract | `validateSession(...)`, `validateLightweightSession(...)` | Validate session before execution |
| AgentWallet contract | `getSessionType(id)` | Determine session type |
| SDK `verifier.ts` | `sessions(id)`, `lightSessions(id)` | Verify session authorization |

### Who Validates Data
- **SessionManager contract itself**: ZK proof verification, nullifier check, expiry check, spending limit check
- **AgentWallet contract**: Calls `validateSession()` before every `execute()`/`executeBatch()`

### Who Transforms Data
- **Backend `prover.ts` / `fastProver.ts`**: Generates ZK proofs for session creation
- **SDK `SessionManager.ts`**: Generates proofs client-side via `groth16.fullProve()`

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `SessionCreated`, `SessionUsed`, `SessionRevoked` events
- **Frontend `events/page.tsx`**: Displays session events

### Who Caches State
- **Backend `session_budgets` table**: Tracks session spending
- **Frontend `mock-api.ts`**: Client-side session caching (dev only)

---

## AgentWallet (0xB00c0a6A821D054098D3a9D87A93c1fE2A76b4e8 — implementation)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `blockchain.ts` | `execute(target, value, data)` | Execute whitelisted call |
| Backend `blockchain.ts` | `executeBatch(targets, values, data)` | Execute batch calls |
| Backend `agentTools.ts` | `execute()`, `executeBatch()` | Agent-driven execution |
| Runtime-local `server.ts` | `execute()`, `executeBatch()` | AI-driven execution |
| Owner | `setWhiteListedParty()` | Manage whitelist |
| Owner | `changeOwner()`, `acceptOwnership()` | Transfer ownership |
| Owner | `addDeposit()`, `withdrawDepositTo()` | Manage EntryPoint deposits |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `agentTools.ts` | `whiteListedParties(addr)` | Check if target is whitelisted |
| Backend `agentTools.ts` | `owner()` | Verify ownership |
| Runtime-local `server.ts` | `checkBalance()`, `getDeposit()` | Balance checks |
| SDK `verifier.ts` | `isValidSignature(digest, sig)` | EIP-1271 signature check |

### Who Validates Data
- **AgentWallet contract itself**: Whitelist check, session validation, owner check, re-entrancy guard
- **SessionManager contract**: Called by AgentWallet to validate session

### Who Transforms Data
- **Backend `blockchain.ts`**: Encodes calldata, builds UserOperations for ERC-4337
- **Backend `bundler.ts`**: Packs UserOperation fields, submits to bundler

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `ExecutionPerformed`, `BatchExecutionPerformed`, `WhiteListUpdated`, `OwnershipTransferStarted`, `OwnerChanged` events

### Who Caches State
- **Backend `wallets` table**: Stores wallet address, owner, creation details
- **Backend `wallet_whitelist` table**: Cached whitelist entries

---

## AgentWalletFactory (0x36ECC27acd245dbac23Ca1bC72798E75BfbA4a84)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `blockchain.ts` | `createWallet(owner)` | Deploy new wallet clone |
| Backend `platform.ts` | `createWallet(...)` | Deploy via platform service |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| AgentWallet contract | `isAgentWallet(addr)` | Verify wallet is factory-created |
| SDK | `getAddress(salt)` | Predict wallet address |
| Backend | `walletCount()`, `agentWallets(addr)` | Factory state |

### Who Validates Data
- **AgentWalletFactory contract**: Zero-address checks, duplicate detection

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `WalletCreated` events → creates wallet records in DB

---

## CapabilityRegistry (0xa3166c63920305B7fBE11f97683B99F239bC7975)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `capabilityRegistry.ts` | `registerCapability(...)` | Define new capability |
| Backend `capabilityRegistry.ts` | `updateGrantRoot(grantee, root)` | Update Merkle root of grants |
| Backend `capabilityRegistry.ts` | `revokeGrant(leaf, capId)` | Revoke individual grant |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `capabilityRegistry.ts` | `verifyCapability(...)` | Full Merkle verification |
| SDK `verifier.ts` | `verifyCapability(...)`, `capabilities(...)`, `grantRoots(...)` | On-chain verification |
| MCP server | `verifyCapability(...)` | MCP tool verification |

### Who Validates Data
- **CapabilityRegistry contract**: Merkle proof verification, expiry check, revocation check

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `CapabilityRegistered`, `CapabilityRevoked`, `GrantRootUpdated`, `GrantRevoked`

---

## DelegationManager (0x355b30477125c6a2F1323095baf99D3781bABd3B)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| Backend `delegation.ts` | `updateDelegationRoot(...)` | Update delegation Merkle root |
| Backend `delegation.ts` | `revokeDelegation(leaf, delegator)` | Revoke delegation |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `delegation.ts` | `verifyDelegation(...)` | Single-hop verification |
| SDK `verifier.ts` | `verifyDelegation(...)`, `verifyDelegationChain(...)` | On-chain verification |
| MCP server | `verifyDelegation(...)` | MCP tool verification |

### Who Validates Data
- **DelegationManager contract**: Merkle proof verification, depth check, expiry check, chain continuity

### Who Consumes Events
- **Backend `eventSync.ts`**: Polls `DelegationRootUpdated`, `DelegationRevoked`

---

## Groth16Verifier (0x06A08E7E06296eBdA8d7Ea467e412aD75c2f2424)

### Who Writes Data
- Nobody (read-only contract)

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| SessionManager contract | `verifyProof(a, b, c, pubSignals)` | Validate ZK proof during session creation |
| Backend `externalAgent.ts` | `verifyProof(...)` | Direct verification |
| SDK `verifier.ts` | `verifyProof(...)` | On-chain verification |

### Who Validates Data
- **Groth16Verifier contract itself**: BN128 pairing operations

---

## EntryPoint (0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108)

### Who Writes Data
| Writer | Method | What |
|--------|--------|------|
| ERC-4337 Bundler | `handleOps(...)` | Execute UserOperations |
| AgentWallet | `addDeposit()` | Fund wallet gas |
| AgentWallet | `withdrawDepositTo()` | Withdraw gas funds |

### Who Reads Data
| Reader | Method | What |
|--------|--------|------|
| Backend `blockchain.ts` | `balanceOf(wallet)`, `getNonce(wallet)`, `getUserOpHash(hash)` | UserOp preparation |
| AgentWallet | `balanceOf(address(this))` | Check deposit balance |

---

## Event Flow (Event-Driven Architecture)

```
Smart Contracts emit events
        │
        ▼
Backend eventSync.ts (polls every N seconds)
        │
        ├─► contract_events table (raw events)
        ├─► event_cursors table (last processed block)
        ├─► wallets table (from WalletCreated events)
        └─► organization_contracts table (from contract deployments)
                │
                ▼
Frontend events/page.tsx (polls backend /events endpoint)
        │
        └─► Display to user
```

---

## Complete End-to-End Data Flow: Credential Issuance

```
1. Frontend: User clicks "Issue Credential"
   │
2. Frontend → Backend: POST /agents/:id/credentials/issue
   │  (body: {orgId, agentId, permissions, expiry, metadata})
   │
3. Backend platform.ts:
   │  a. Generate 31-byte random secret
   │  b. Compute commitment = Poseidon(agentId, orgId, permissions, expiry, secret)
   │  c. Compute secretHash = Poseidon(secret, 0)
   │  d. Insert credential into DB (credentials table)
   │  e. Insert leaf into Merkle tree (merkle_tree table)
   │  f. Rebuild tree, compute new root
   │
4. Backend blockchain.ts:
   │  a. tx = credentialRegistry.updateActiveRoot(newRoot)
   │  b. tx.wait(1)
   │
5. Backend → Frontend: {credentialId, commitment, secret}
   │
6. Frontend stores secret in localStorage (CREDENTIAL-CLIENT-PLAINTEXT ISSUE)
   │
7. Event Sync:
   │  a. eventSync.ts detects ActiveRootUpdated event
   │  b. Stores in contract_events table
   │
8. Frontend displays credential in credentials list
```

---

## Complete End-to-End Data Flow: Agent Execution via Session

```
1. Agent needs to execute action
   │
2. Agent calls: POST /external/:agentId/execute
   │  (body: {action, params, proof?, sessionId?})
   │
3. Backend externalAgent.ts:
   │  a. Load agent from DB
   │  b. Load session from DB
   │  c. Validate session: not expired, not revoked, budget OK
   │  d. Validate ZK proof (if provided)
   │  e. Validate nullifier not used
   │  f. Mark nullifier used
   │
4. Backend agentTools.ts:
   │  a. Check agent has permission for action
   │  b. Lookup wallet
   │  c. Validate whitelist for target
   │  d. Construct calldata
   │
5. Backend blockchain.ts:
   │  a. Build UserOperation
   │  b. Sign with backend PRIVATE_KEY
   │  c. Submit via bundler
   │
6. AgentWallet contract:
   │  a. validateUserOp called by EntryPoint
   │  b. Check caller is EntryPoint
   │  c. Validate session: ISessionManager.validateSession(sessionId, signer, value)
   │  d. OR validate owner signature
   │  e. Check target is whitelisted
   │  f. Execute target.call{value}(data)
   │
7. Backend → Agent: {success, txHash, result}
   │
8. Event Sync detects ExecutionPerformed event
   │
9. Frontend displays in events timeline
```

---

## Complete End-to-End Data Flow: Session Creation

```
1. Backend/SDK creates session:
   │
2. ZK Path (Full):
   │  a. Generate secret (random 31 bytes)
   │  b. Compute nullifier = Poseidon(secret)
   │  c. Fetch Merkle proof from backend (GET /sessions/proof/:agentId)
   │  d. Generate Groth16 proof: groth16.fullProve(input, wasm, zkey)
   │  e. Submit session: POST /sessions
   │  f. Backend calls SessionManager.createSession(sessionId, wallet, sessionKey, maxValue, expiry, nullifier, a, b, c, publicSignals)
   │  g. SessionManager verifies proof, checks nullifier, marks nullifier used
   │
3. Lightweight Path:
   │  a. User signs EIP-191 message with wallet
   │  b. Backend calls SessionManager.createLightweightSession(sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry, ownerSignature)
   │  c. SessionManager verifies owner signature, creates session
   │
4. During Execution:
   │  a. AgentWallet.validateUserOp() calls SessionManager.validateSession()
   │  b. SessionManager checks: not expired, not revoked, signer matches, spend within limits
   │  c. Returns true/false to AgentWallet
   │  d. AgentWallet allows or rejects execution
```
