# AgentIX Runtime Integrity Report

## Data Flow Map

```
                    ┌─────────────────────────────────────────────┐
                    │              Frontend (Next.js)              │
                    │  session.ts, auth.ts, credential-client.ts  │
                    └──────────────┬──────────────────────────────┘
                                   │ HTTPS + JWT/Session Cookie
                    ┌──────────────▼──────────────────────────────┐
                    │              Backend (Express)               │
                    │  sessionKey.ts    — Session lifecycle        │
                    │  provisioning.ts  — Agent onboarding         │
                    │  externalAgent.ts — External agent mgmt      │
                    │  delegation.ts    — Permission delegation     │
                    │  fastProver.ts    — ZK proof generation       │
                    │  eventSync.ts     — Blockchain event polling  │
                    │  jwt.ts           — Token management          │
                    │  merkle.ts        — Poseidon Merkle trees     │
                    └──┬─────────┬──────────┬──────────┬──────────┘
                       │         │          │          │
              ┌────────▼──┐ ┌───▼────┐ ┌───▼────┐ ┌──▼──────────┐
              │ PostgreSQL │ │ Redis  │ │  RPC   │ │ On-Chain    │
              │ (primary)  │ │ (Bull) │ │(Alchemy)│ │ Contracts   │
              └────────────┘ └────────┘ └────────┘ └─────────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │  Base Sepolia   │
                                               │  (Ethereum L2)  │
                                               └─────────────────┘
```

## Who Writes Data

| Component | Writes To | Auth Method |
|-----------|-----------|-------------|
| Backend API | PostgreSQL | DB connection string |
| Backend API | On-chain contracts | PRIVATE_KEY (operator wallet) |
| Event Sync | PostgreSQL | DB connection |
| Event Sync | Reads from RPC | Alchemy API key |
| Frontend | Reads via API | JWT / Session cookie |
| SDK | Reads via API | API key / Wallet signature |
| MCP Server | Reads via API | MCP_API_KEY |

## Who Validates Data

| Data | Validated By | Method |
|------|-------------|--------|
| Session creation | SessionManager.sol | Groth16 ZK proof or ECDSA signature |
| Session execution | SessionManager.sol | Session validation (expiry, balance, signer) |
| Credential issuance | CredentialRegistry.sol | Issuer role check |
| Delegation proofs | DelegationManager.sol | Merkle proof verification |
| Capability grants | CapabilityRegistry.sol | Merkle proof verification |
| API requests | Backend middleware | JWT RS256 / API key / Wallet signature |
| Request bodies | Zod schemas | Input validation |

## Who Consumes Events

| Event | Consumer | Action |
|-------|----------|--------|
| SessionCreated | Event Sync → PostgreSQL | Store session record |
| SessionUsed | Event Sync → PostgreSQL | Update usage stats |
| SessionRevoked | Event Sync → PostgreSQL | Mark session revoked |
| WalletCreated | Event Sync → PostgreSQL | Create wallet record |
| DelegationRootUpdated | Off-chain services | Rebuild delegation index |
| CapabilityRegistered | Off-chain services | Update capability cache |

## Who Updates State

| State | Updated By | Frequency |
|-------|-----------|-----------|
| Merkle tree roots | Issuers via CredentialRegistry | On credential change |
| Session spend/used | SessionManager.sol | On each execution |
| Daily limits | SessionManager.sol | On each execution (with daily reset) |
| Delegation roots | Delegators via DelegationManager | On delegation change |
| Capability grants | Grantors via CapabilityRegistry | On grant change |
| Proof cache | fastProver.ts | On proof generation (24h TTL) |
| JWT keys | jwt.ts | Every 24h (rotation) |

## Who Caches State

| Cache | Location | TTL | Eviction |
|-------|----------|-----|----------|
| Merkle tree state | Memory (Map) | 60s | Time-based |
| Proof cache | PostgreSQL | 24h | Time-based |
| JWT key pair | Memory | 24h | Rotation |
| Wallet balances | Memory (LRU) | Variable | LRU (max 100) |
| Prover backend | Memory | Session | Manual reset |

## Stale Data Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Merkle tree cache stale across instances | Medium | 60s TTL acceptable at V1 scale |
| JWT key rotation causes invalid tokens | Low | Clients re-fetch JWKS |
| Event sync lag | Low | Cursor-based, catches up on restart |
| Proof cache serves stale proofs | Low | 24h TTL, input-hash based |
| Session daily limits race condition | Medium | TOCTOU at V1 scale acceptable |

## State Divergence Risk

| Scenario | Risk | V1 Impact |
|----------|------|-----------|
| Backend DB vs on-chain session state | Low | Event sync reconciles |
| Multiple backend replicas | Medium | Stateless API, shared DB |
| Chain reorganization | Low | Event sync replays from cursor |
| Redis failure (proof queue) | Low | Queue disabled gracefully |

## Duplicate Action Risk

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Duplicate session creation | Low | Session ID is unique hash |
| Duplicate proof generation | Medium | Proof cache deduplicates |
| Duplicate event processing | Low | ON CONFLICT DO NOTHING |
| Duplicate wallet creation | Low | CREATE2 deterministic |

## Critical Integrity Checks

1. **Nullifier consumption**: One-time use enforced on-chain (CredentialRegistry.markNullifierUsed)
2. **Session expiry**: Checked on every validation (block.timestamp > expiry)
3. **Session revocation**: Checked on every validation (s.revoked == true)
4. **Budget limits**: Checked atomically on-chain (valueUsed + value > maxValue)
5. **Whitelist enforcement**: Only whitelisted targets can receive calls
6. **Reentrancy guard**: NonReentrant on all state-changing wallet functions
7. **Owner verification**: ECDSA signature recovery for lightweight sessions
8. **ZK proof verification**: Groth16 proof verified against verification key

## Recommendations for V1

1. **Accept current state** — All critical integrity checks are in place
2. **Monitor event sync lag** — Add alerting if cursor falls behind > 100 blocks
3. **Add structured logging** — Correlate API requests with on-chain transactions
4. **Document known TOCTOU** — Accept at V1 scale, fix in V2 with atomic SQL
