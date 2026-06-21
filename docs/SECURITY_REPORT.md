# Security Report

## Threat Model

### Assets Protected
1. **Agent credentials** — ZK commitments on-chain, never expose private keys
2. **Session tokens** — Temporary, revocable, budget-limited
3. **Economic actions** — Escrow, settlement, disputes on Base Sepolia
4. **Audit trail** — Immutable record of all actions

### Attack Vectors & Mitigations

| Vector | Mitigation | Implementation |
|--------|-----------|----------------|
| **Session replay** | Nullifier-based revocation | `used_nullifiers` table + Sparse Merkle tree on-chain |
| **Session hijacking** | Session key binding | Session tied to specific wallet address |
| **Organization bypass** | Org ID bound to session | `session_validator.ts:28` — `WHERE a.org_id = ?` |
| **Permission escalation** | Bitmask enforcement | `session_validator.ts:139` — `(permissions & actionConfig.permissionBit) === 0` |
| **Revoked sessions** | Nullifier check | `session_validator.ts:66-83` — checks `used_nullifiers` table |
| **Expired sessions** | Timestamp check | `session_validator.ts:49` — `session.expires_at < now` |
| **Budget overspending** | Atomic deduction | `budget-tracker.ts:134` — `WHERE (total_budget - spent) >= ?` |
| **Double settlement** | Task status check | CovenantEscrow contract enforces state machine |
| **Unauthorized actions** | Permission bits + session validation | Both must pass before action proceeds |
| **Missing audit records** | Middleware logging | `auditCovenantAction()` called on every Covenant route |
| **Race conditions** | Atomic DB/Redis operations | Budget deduction uses conditional UPDATE or Lua script |

## Mandatory Security Tests

### TEST 1: Budget Overage
```
Budget = 100
Task = 500
Expected: FAIL
Implementation: budget-tracker.ts tryDeduct() checks remaining >= amount
```

### TEST 2: Expired Session
```
Session expires
Attempt task
Expected: FAIL
Implementation: session-validator.ts checks expires_at < now
```

### TEST 3: Revoked Session
```
Session revoked
Attempt task
Expected: FAIL instantly
Implementation: session-validator.ts checks used_nullifiers table
```

### TEST 4: Wrong Organization
```
Wrong organization ID
Attempt task
Expected: FAIL
Implementation: session-validator.ts WHERE a.org_id = ? (bound to session)
```

### TEST 5: Wrong Permission
```
Wrong permission bit for action
Attempt task
Expected: FAIL
Implementation: session-validator.ts checks (permissions & actionConfig.permissionBit) === 0
```

### TEST 6: Concurrent Budget Race
```
Budget = 100
Request A = 80
Request B = 80
Expected: Second request fails
Implementation: Atomic deduction via conditional UPDATE or Redis Lua script
```

### TEST 7: Audit Verification
```
Every action must contain:
- User (userId)
- Organization (orgId)
- Agent (agentId)
- Session (sessionId)
- Credential (via agent lookup)
- Permission (via credential lookup)
- Task (taskId in details)
- Settlement (txHash in details)
- Transaction hash (txHash in details)
- Timestamp (created_at)
Implementation: auditCovenantAction() + logAuditEvent()
```

## Cryptographic Security

- **Groth16 ZK proofs**: 128-bit security level. Verified on-chain via Groth16Verifier contract.
- **Poseidon hash**: Used for Merkle tree commitments. Hardware-friendly, constant-time.
- **Sparse Merkle tree**: For revocation. O(log n) proof generation and verification.
- **Session keys**: Random 256-bit keys. Never stored in plaintext.
- **Encryption**: AES-256-GCM for data at rest. Separate keys for session data.

## Contract Security

- **ReentrancyGuard**: All external calls that transfer value.
- **UUPS proxy**: Instant pause + upgrade capability.
- **Custom errors**: Gas-optimized, no string leaks.
- **Access control**: `onlyOwner` on sensitive functions.
- **Overflow protection**: Solidity 0.8.x built-in checks.

## Recommendations

1. **Key rotation**: Rotate `ENCRYPTION_KEY` and `SESSION_ENCRYPTION_KEY` periodically.
2. **Audit logging**: Export audit logs to external SIEM for compliance.
3. **Rate limiting**: Monitor for abuse patterns. Adjust limits based on usage.
4. **Monitoring**: Set up alerts for failed authorization attempts.
5. **Penetration testing**: Engage external security firm before mainnet deployment.
