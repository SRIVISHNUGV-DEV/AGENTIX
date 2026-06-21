# Technical Debt Backlog

## High Priority

1. **ZK proof generation requires local circuit files**
   - Location: `sdk/src/SessionManager.ts:9-25`
   - Issue: SDK fails if `circuits/build/` doesn't have `.wasm` and `.zkey` files
   - Fix: Bundle circuit files or add clear error message
   - Effort: 1 day

2. **Audit trail query performance**
   - Location: `backend/src/routes/covenant.ts:230-245`
   - Issue: No pagination on audit log, slow for large orgs
   - Fix: Add cursor-based pagination
   - Effort: 0.5 day

3. **Budget tracker Redis connection handling**
   - Location: `backend/src/integrations/covenant/budget-tracker.ts:3-27`
   - Issue: Redis client singleton never reconnects after failure
   - Fix: Add reconnection logic
   - Effort: 0.5 day

## Medium Priority

4. **Session creation requires ZK proof in production**
   - Location: `backend/src/routes/sessions.ts:23`
   - Issue: Sessions require ZK proofs which need circuit files
   - Fix: Add lightweight session mode without ZK
   - Effort: 2 days

5. **Wallet manager cache invalidation**
   - Location: `backend/src/integrations/covenant/wallet-manager.ts:47`
   - Issue: Decrypted wallets cached forever in memory
   - Fix: Add TTL or LRU cache
   - Effort: 0.5 day

6. **Covenant client hardcoded addresses**
   - Location: `backend/src/integrations/covenant/covenant-client.ts:10-17`
   - Issue: Contract addresses hardcoded, not configurable per env
   - Fix: Read from env vars or deployed-addresses.json
   - Effort: 0.5 day

7. **No per-session rate limiting**
   - Location: `backend/src/middleware/security.ts`
   - Issue: Global rate limiter only, no per-session caps
   - Fix: Add session-based rate limiting
   - Effort: 1 day

## Low Priority

8. **Inconsistent error messages**
   - Location: Various routes
   - Issue: Some errors return `error`, some return `details`
   - Fix: Standardize error response format
   - Effort: 0.5 day

9. **Missing OpenAPI spec**
   - Location: None
   - Issue: No API documentation
   - Fix: Add OpenAPI/Swagger spec
   - Effort: 1 day

10. **No integration tests**
    - Location: `backend/tests/`
    - Issue: Only unit tests, no end-to-end integration tests
    - Fix: Add integration test suite
    - Effort: 2 days
