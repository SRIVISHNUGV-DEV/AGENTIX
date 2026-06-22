# AgentIX Dependency Graph

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER / AI AGENT                             │
└──────────────┬──────────────────────────────────────┬───────────────┘
               │                                      │
               ▼                                      ▼
┌──────────────────────┐              ┌──────────────────────────┐
│  Frontend (Next.js)  │              │  SDK / CLI / MCP Client  │
│  Port 3000           │              │  @agentix/sdk, atx CLI   │
└──────────┬───────────┘              └──────────┬───────────────┘
           │                                     │
           │  /api/* proxy routes                │  HTTP REST
           ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Backend (Express)                                │
│                     Port 3001                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Routes: auth, agents, credentials, sessions, wallets, events,      │
│          proofs, externalAgents, dashboard, audit, covenant,        │
│          circuit, wellknown, verify, v1, simple, sessionsSimple,    │
│          agentAuth, ai, orgs                                         │
├─────────────────────────────────────────────────────────────────────┤
│  Services: blockchain, credential, session, platform, prover,       │
│            fastProver, merkle, revocationTree, bundler,              │
│            externalAgent, eventSync, capabilityRegistry,            │
│            capabilityPolicy, delegation, audit, anomalyDetection,   │
│            agentComms, agentReconnect, taskQueue, agentLoop,        │
│            agentTools, sessionKey, provisioning, actionAuth,        │
│            scopeParser, proofQueue                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Middleware: auth, security, agentixAuth, validate, rateLimiter     │
├─────────────────────────────────────────────────────────────────────┤
│  Integrations: covenant-client, session-validator, middleware,      │
│                wallet-manager, budget-tracker                        │
├─────────────────────────────────────────────────────────────────────┤
│  MCP Server: 15 tools (stdio + SSE)                                 │
└──────────┬──────────────────────────────────────────┬───────────────┘
           │                                          │
           │  ethers.js v6                            │  snarkjs / rapidsnark
           ▼                                          ▼
┌──────────────────────────┐              ┌──────────────────────────┐
│  Base Sepolia (84532)     │              │  ZK Prover               │
│  RPC: Alchemy/Infura      │              │  rapidsnark (WSL)        │
├──────────────────────────┤              │  snarkjs fallback        │
│  CredentialRegistry       │              │  Circuit WASM + zKey     │
│  SessionManager           │              └──────────────────────────┘
│  AgentWalletFactory       │
│  AgentWallet (clones)     │              ┌──────────────────────────┐
│  CapabilityRegistry       │              │  Database                │
│  DelegationManager        │              │  PostgreSQL 15           │
│  Groth16Verifier          │              │  35+ tables              │
│  EntryPoint (4337)        │              └──────────────────────────┘
└──────────────────────────┘
                                           ┌──────────────────────────┐
                                           │  Cache / Queue           │
                                           │  Redis 7                 │
                                           │  Rate limiting, Bull     │
                                           │  queue, session cache    │
                                           └──────────────────────────┘
```

## Component Dependencies

### Frontend → Backend
| Frontend Module | Backend Endpoint | Method |
|----------------|-----------------|--------|
| `api/auth/login` | `/auth/login` | POST |
| `api/auth/register` | `/auth/register` | POST |
| `api/auth/me` | `/auth/me` | GET |
| `api/auth/logout` | `/auth/logout` | POST |
| `api/ai/*` | `/ai/*` | ALL |
| `api/external/*` | `/external/*` | ALL |
| `api/platform/orgs` | `/orgs` | GET/POST |
| `api/platform/orgs/[orgId]` | `/orgs/[orgId]` | DELETE |
| `api/platform/orgs/[orgId]/deploy` | `/orgs/[orgId]/deploy-contracts` | POST |
| `api/platform/orgs/[orgId]/fund` | `/orgs/[orgId]/fund` | POST |
| `api/platform/agents` | `/agents` | GET/POST |
| `api/platform/agents/[agentId]/*` | `/agents/[agentId]/*` | POST |
| `api/platform/wallets/*` | `/wallets/*` | POST/GET/DELETE |
| `lib/dashboard-api.ts` | `/dashboard/*` | ALL |
| `lib/external-agents-api.ts` | `/api/external/*` | ALL |
| `lib/mock-api.ts` | `/orgs`, `/agents`, `/wallets`, etc. | GET/POST |
| `lib/session.ts` | `/external/:id/sessions/*` | ALL |
| `lib/ai-api.ts` | `/api/ai/*` | ALL |
| `lib/wallet-action.ts` | (signs EIP-191 for wallet auth) | — |

### Backend → Smart Contracts
| Backend Service | Contract | Methods |
|----------------|----------|---------|
| `blockchain.ts` | CredentialRegistry | `updateActiveRoot`, `updateRevokedSecretRoot`, `setSessionManager` |
| `blockchain.ts` | SessionManager | `createSession` |
| `blockchain.ts` | AgentWalletFactory | `createWallet` |
| `blockchain.ts` | AgentWallet | `setWhiteListedParty`, `setWhiteListedPartyBatch`, `execute`, `executeBatch` |
| `blockchain.ts` | EntryPoint | `balanceOf`, `depositTo`, `getNonce`, `getUserOpHash` |
| `platform.ts` | CredentialRegistry | `updateActiveRoot`, `updateRevokedSecretRoot` |
| `platform.ts` | AgentWalletFactory | `createWallet` |
| `capabilityRegistry.ts` | CapabilityRegistry | `registerCapability`, `updateGrantRoot`, `revokeGrant`, `grantRoots`, `capabilities`, `verifyCapability` |
| `delegation.ts` | DelegationManager | `updateDelegationRoot`, `revokeDelegation`, `delegationRoots`, `verifyDelegation` |
| `provisioning.ts` | AgentWallet | `addDeposit`, `getDeposit` |
| `agentTools.ts` | AgentWallet | `execute`, `executeBatch` |
| `eventSync.ts` | All contracts | Event polling (read-only) |
| `bundler.ts` | EntryPoint | `getNonce`, `getUserOpHash` |
| `externalAgent.ts` | CredentialRegistry | `activeRoot`, `revokedSecretRoot`, `isNullifierUsed` |
| `externalAgent.ts` | Groth16Verifier | `verifyProof` |
| `externalAgent.ts` | SessionManager | `sessions`, `lightSessions` |

### Backend → Database
| Service | Tables Read | Tables Written |
|---------|------------|----------------|
| `auth.ts` | `users`, `auth_sessions` | `auth_sessions` |
| `blockchain.ts` | `organization_contracts`, `shared_contracts`, `wallets`, `proof_cache` | `organization_contracts`, `wallets` |
| `platform.ts` | `credentials`, `wallets`, `revoked_secrets`, `merkle_tree` | `credentials`, `wallets`, `revoked_secrets`, `merkle_tree` |
| `merkle.ts` | `merkle_tree`, `merkle_tree_state`, `credentials` | `merkle_tree`, `merkle_tree_state` |
| `revocationTree.ts` | `revoked_secrets` | `revoked_secrets` |
| `externalAgent.ts` | `external_agents`, `agent_vault_credentials`, `agent_funding_accounts`, `agent_whitelisted_contracts`, `agents`, `credentials`, `used_nullifiers` | All |
| `eventSync.ts` | `contract_events`, `event_cursors`, `wallets`, `organization_contracts` | `contract_events`, `event_cursors`, `wallets` |
| `capabilityRegistry.ts` | `agent_capabilities`, `capability_grants`, `external_agents` | `agent_capabilities`, `capability_grants` |
| `delegation.ts` | `agent_delegations`, `external_agents` | `agent_delegations` |
| `audit.ts` | `audit_log` | `audit_log` |
| `anomalyDetection.ts` | `agent_execution_logs`, `agent_sessions`, `session_usage`, `audit_log` | `anomaly_alerts` |
| `agentComms.ts` | `external_agents`, `agent_execution_queue` | `agent_execution_queue` |
| `agentLoop.ts` | `external_agents`, `credentials`, `agent_execution_queue`, `wallets` | `agent_execution_queue` |
| `agentTools.ts` | `wallets`, `agents` | — |
| `sessionKey.ts` | `agent_sessions`, `session_usage` | `agent_sessions`, `session_usage` |
| `provisioning.ts` | `wallets`, `agents` | `wallets` |
| `actionAuth.ts` | `action_authorizations`, `organizations` | `action_authorizations` |
| `proofQueue.ts` | `proof_cache` | `proof_cache` |
| `taskQueue.ts` | `agent_execution_queue` | `agent_execution_queue` |
| `capabilityPolicy.ts` | `agent_capability_policies`, `capability_policy_revisions`, `credentials` | `agent_capability_policies`, `capability_policy_revisions` |

### Backend → External Services
| Service | External Dependency | Purpose |
|---------|-------------------|---------|
| `bundler.ts` | ERC-4337 Bundler | Submit UserOperations |
| `fastProver.ts` | rapidsnark (WSL) | ZK proof generation |
| `fastProver.ts` | snarkjs (JS) | ZK proof generation (fallback) |
| `covenant-client.ts` | Covenant contracts | Cross-protocol operations |
| `wallet-manager.ts` | Ethereum RPC | Fund agent wallets |
| `budget-tracker.ts` | Redis / PostgreSQL | Atomic budget deductions |
| `proofQueue.ts` | Redis (Bull) | Async proof generation queue |
| `index.ts` | WebSocket clients | Real-time agent communication |

### MCP Server → Contracts (Direct)
| MCP Tool | Contract Read | Purpose |
|----------|--------------|---------|
| `generate_proof` | — | Local proof generation |
| `verify_proof` | — | Local proof verification (snarkjs) |
| `get_chain_contracts` | — | Returns configured addresses |
| `get_chains` | RPC | Chain health check |

### SDK → Backend (via HTTP)
| SDK Method | Backend Endpoint |
|-----------|-----------------|
| `registerAgent()` | `POST /v1/agents/provision` |
| `createWallet()` | `POST /wallets` |
| `createSession()` | `POST /sessions` |
| `generateProofRemote()` | `POST /external/:id/proof` |
| `verifyAtEndpoint()` | `POST /verify` |
| `getAgentState()` | `GET /v1/agents/:id/state` |
| `getEvents()` | `GET /events` |
| `fetchWellKnown()` | `GET /.well-known/agentix` |
| `queryAuditLogs()` | `GET /audit` |

### CLI → SDK
| CLI Command | SDK Method |
|------------|-----------|
| `atx provision` | `client.registerAgent()` |
| `atx state` | `client.getAgentState()` |
| `atx revoke` | `client.revokeAgent()` |
| `atx session` | `client.createSession()` / `client.createSessionRemote()` |
| `atx proof` | `client.generateProofRemote()` / `client.verifyProof()` |
| `atx wallet` | `client.createWallet()` |
| `atx auth` | `AuthFlowClient.authenticate()` |
| `atx serve` | `RelyingPartyClient.middleware()` |

### Runtime-Local Server → Backend + Contracts
| Operation | Backend Call | Contract Call |
|-----------|-------------|---------------|
| `send_transaction` | `GET /external/:id`, `GET /wallets` | `AgentWallet.execute()` |
| `batch_transactions` | Same | `AgentWallet.executeBatch()` |
| `deposit_gas` | Same | `AgentWallet.addDeposit()` |
| `withdraw_gas` | Same | `AgentWallet.withdrawDepositTo()` |
| `add_to_whitelist` | Same | `AgentWallet.setWhiteListedParty()` |
| `get_wallet_balance` | Same | `AgentWallet.checkBalance()` |

## Database Schema (35+ tables)

```
organizations ──┐
                ├── agents ──── external_agents
                │        │           │
                │        │     agent_vault_credentials
                │        │     agent_funding_accounts
                │        │     agent_whitelisted_contracts
                │        │     agent_execution_logs
                │        │     agent_api_keys
                │        │     agent_policies
                │        │
                │        ├── credentials
                │        ├── sessions
                │        ├── wallets
                │        │     └── wallet_whitelist
                │        ├── used_nullifiers
                │        ├── action_authorizations
                │        ├── audit_log
                │        ├── covenant_spending_log
                │        └── whitelisted_parties
                │
                ├── organization_contracts
                ├── shared_contracts
                ├── users ── auth_sessions
                │
                ├── merkle_tree
                ├── merkle_tree_state
                ├── revoked_secrets
                ├── revoked_merkle_tree
                │
                ├── agent_capabilities
                ├── capability_grants
                ├── capability_policy_revisions
                ├── agent_capability_policies
                │
                ├── agent_delegations
                │
                ├── contract_events
                ├── event_cursors
                ├── proof_cache
                ├── proof_jobs
                ├── session_budgets
                │
                ├── ai_agents ── ai_agent_runs
                ├── agent_execution_queue
                └── anomaly_alerts
```
