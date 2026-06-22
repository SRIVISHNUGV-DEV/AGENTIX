# AgentIX V1 Test Plan

## Test Strategy

AgentIX uses a multi-layer testing approach:
1. **Unit Tests** — Individual function validation
2. **Integration Tests** — Service interaction verification
3. **Contract Tests** — On-chain logic validation
4. **E2E Tests** — Full flow verification
5. **Stress Tests** — Performance and concurrency

## Existing Test Coverage

### Contract Tests ✅

| Test File | Coverage | Status |
|-----------|----------|--------|
| `SessionManager.test.ts` | Standard session lifecycle | ✅ Passing |
| `LightweightSession.test.ts` | Lightweight session lifecycle | ✅ Passing |
| `AgentWallet.test.ts` | Wallet operations | ✅ Passing |

### Backend Tests ✅

| Test File | Coverage | Status |
|-----------|----------|--------|
| `externalAgent.test.ts` | Agent CRUD, proofs | ✅ Passing |
| `delegation.test.ts` | Delegation lifecycle | ✅ Passing |
| `capabilityRegistry.test.ts` | Capability verification | ✅ Passing |
| `fastProver.test.ts` | ZK proof generation | ✅ Passing |
| `actionAuth.test.ts` | Action authentication | ✅ Passing |
| `merkleTree.test.ts` | Merkle tree operations | ✅ Passing |

### MCP Tests ✅

| Test File | Coverage | Status |
|-----------|----------|--------|
| `store.test.ts` | MCP store operations | ✅ Passing |

## New Tests Required

### P0 — Before Deployment

#### SQL Injection Regression Tests
```
Test: merkle.ts parameterized queries
  - Verify orgId is passed as parameter, not interpolated
  - Verify nodesTable is validated as safe identifier
  - Attempt SQL injection via orgId (should fail)

Test: revocationTree.ts PostgreSQL syntax
  - Verify $1 placeholder is used, not ?
  - Verify query executes against PostgreSQL
```

#### Floating-Point Wei Conversion Tests
```
Test: ethToWei precision
  - ethToWei("0.1") == "100000000000000000"
  - ethToWei("1.0") == "1000000000000000000"
  - ethToWei("0.000000000000000001") == "1"
  - ethToWei("115792089237316195423570985008687907853269984665640564039457584007913129639935") (max uint256)
  - ethToWei("0.123456789012345678") (18 decimals)
  - ethToWei("invalid") throws
  - ethToWei("") throws
```

#### Proof Cache Security Tests
```
Test: fastProver.ts cache key
  - Verify cache key is SHA-256 hash, not raw JSON
  - Verify secret is not stored in proof_cache table
  - Verify same input produces same cache key
  - Verify different inputs produce different cache keys
```

### P1 — Before Production

#### Session System Tests
```
Test: Concurrent session spending
  - Create session with limit 100
  - Send 10 concurrent requests of 10
  - Verify total spend <= 100
  - Verify correct error on limit exceeded

Test: Expired session execution
  - Create session with 1s expiry
  - Wait 2s
  - Attempt execution
  - Verify revert with SessionExpired

Test: Revoked session execution
  - Create session
  - Revoke session
  - Attempt execution
  - Verify revert with SessionIsRevoked
```

#### Capability System Tests
```
Test: Revoked capability execution
  - Register capability
  - Grant to agent
  - Revoke capability
  - Attempt verification
  - Verify returns false

Test: Expired capability execution
  - Register capability with 1s expiry
  - Grant to agent
  - Wait 2s
  - Attempt verification
  - Verify returns false
```

#### Wallet System Tests
```
Test: Multiple sessions overspending
  - Create wallet with 1 ETH
  - Create 2 sessions with 0.6 ETH limit each
  - Execute 0.6 ETH on session 1
  - Attempt 0.6 ETH on session 2
  - Verify second fails (insufficient balance)

Test: Whitelist enforcement
  - Create wallet
  - Attempt call to non-whitelisted target
  - Verify revert with NotWhiteListedError
```

#### Authentication Tests
```
Test: JWT validation
  - Generate valid JWT
  - Send request with expired JWT
  - Verify 401 response
  - Send request with invalid JWT
  - Verify 401 response

Test: API key validation
  - Generate API key
  - Hash and store
  - Send request with correct key
  - Verify success
  - Send request with wrong key
  - Verify 401 response

Test: MCP SSE authentication
  - Send MCP request without MCP_API_KEY
  - Verify 401 response
  - Send MCP request with correct key
  - Verify success
```

### P2 — Post-Deployment

#### Stress Tests
```
Test: 100 concurrent session creations
  - Create 100 sessions simultaneously
  - Verify all succeed
  - Verify no duplicate session IDs

Test: 100 concurrent session validations
  - Create session with high limit
  - Send 100 concurrent validations
  - Verify total spend is correct

Test: Event sync under load
  - Process 1000 events rapidly
  - Verify cursor advances correctly
  - Verify no events lost
```

#### Failure Simulation Tests
```
Test: RPC failure
  - Mock RPC to return errors
  - Verify backend continues serving cached data
  - Verify event sync pauses gracefully

Test: Database failure
  - Mock DB connection failure
  - Verify API returns 503
  - Verify event sync pauses
  - Verify recovery on reconnection

Test: Redis failure
  - Stop Redis
  - Verify proof queue disables gracefully
  - Verify rate limiting falls back to in-memory

Test: Chain reorganization
  - Simulate reorg of 3 blocks
  - Verify event sync replays affected blocks
  - Verify no duplicate event processing
```

## Test Execution Commands

```bash
# Run all contract tests
cd contracts && npx hardhat test

# Run all backend tests
cd backend && bun test --serial

# Run specific test file
cd backend && bun test backend/tests/externalAgent.test.ts

# Run MCP tests
cd mcp-test && bun test --serial

# Run with coverage
cd contracts && npx hardhat coverage
```

## Test Environment Requirements

| Requirement | Value |
|-------------|-------|
| Node.js | 20.x |
| PostgreSQL | 15+ |
| Redis | 7+ |
| Hardhat | Latest |
| Base Sepolia ETH | 0.1 ETH per test account |
| Circuit files | credential.wasm + .zkey |

## Test Reporting

After each test run, generate:
1. Pass/fail count
2. Coverage percentage
3. Duration
4. Failed test details with stack traces
5. Any flaky tests identified

## Success Criteria

| Metric | Target |
|--------|--------|
| Contract test pass rate | 100% |
| Backend test pass rate | 100% |
| Code coverage (contracts) | > 80% |
| Code coverage (backend) | > 70% |
| Stress test pass rate | 100% |
| No SQL injection vulnerabilities | Verified |
| No floating-point precision issues | Verified |
