# AgentIX Flow Verification

**Purpose:** Record and verify every flow from Dashboard through to completion.

**Date:** 2026-07-16

---

## Flow: Create Wallet

```
Dashboard (Wallets Page)
  ↓ Click "Create Wallet"
  ↓ getAccount() → MetaMask
  ↓ sendAndWaitForWalletCreation(ownerAddress)
  ↓
POST /api/wallets { ownerAddress }
  ↓
Compiler Gateway
  ↓ executeIntent('wallet_create', { ownerAddress })
  ↓ Policy check (owner policy)
  ↓ Risk assessment (MEDIUM risk)
  ↓ Auto-approve (within policy)
  ↓
Tool: src/tools/wallet.ts createWallet()
  ↓ ProxyGuard.validate(owner)
  ↓ Factory.createWallet(owner, salt)
  ↓ tx.wait()
  ↓ Parse WalletCreated event
  ↓
Database: INSERT INTO wallets
  ↓
EventBus: emit WalletCreated
  ↓
Response: { success, walletAddress, txHash }
  ↓
Dashboard: Refresh wallet list
```

**Status:** ✅ Verified

---

## Flow: Create Session (Lightweight)

```
Dashboard (Sessions Page)
  ↓ Click "Create Session"
  ↓ Select wallet, set limits
  ↓ getAccount() → MetaMask
  ↓ sendCreateLightweightSession()
  ↓
POST /api/sessions/prepare-lightweight { walletAddress, dailySpendLimitEth, dailyTxLimit, expiryDays }
  ↓
Server: Compute messageHash
  ↓
Response: { sessionId, expiry, messageHash, sessionManagerAddress }
  ↓
MetaMask: Sign messageHash
  ↓
POST /api/sessions/create-lightweight-tx { walletAddress, sessionKey, sessionId, expiry, dailySpendLimitEth, dailyTxLimit, ownerSignature }
  ↓
Tool: encodeLightweightSession()
  ↓ Encode createLightweightSession() calldata
  ↓ Encode wallet.execute() calldata
  ↓
Response: { to, data, value, sessionId, expiry }
  ↓
MetaMask: Submit transaction
  ↓
Contract: SessionManager.createLightweightSession()
  ↓
Database: INSERT INTO sessions
  ↓
EventBus: emit SessionCreated
  ↓
Dashboard: Refresh session list
```

**Status:** ✅ Verified

---

## Flow: Issue Credential

```
Dashboard (Credentials Page)
  ↓ Select organization
  ↓ Set budget, expiry
  ↓ Click "Issue Credential"
  ↓
Flow Step 1: Create Wallet
  ↓ sendAndWaitForWalletCreation()
  ↓
Flow Step 2: Issue Credential
  ↓ POST /api/credentials { orgId, budgetLimit, expiryDuration, expiryUnit, walletAddress, ownerAddress }
  ↓
Tool: src/tools/credential.ts issueCredential()
  ↓ Validate org exists
  ↓ Generate secret (randomBytes)
  ↓ Compute Poseidon7 commitment
  ↓ INSERT INTO credentials (13 columns)
  ↓ Merkle tree: addLeaf(commitment)
  ↓ Persist root to credential_roots
  ↓ EventBus: emit CredentialIssued
  ↓
Response: { success, credentialId, commitment, secret, activeRoot }
  ↓
Flow Step 3: Update Root (on-chain)
  ↓ sendUpdateRoot(activeRoot)
  ↓ MetaMask: Sign transaction
  ↓ Contract: CredentialRegistry.updateActiveRoot()
  ↓
Flow Step 4: Create Session
  ↓ sendCreateLightweightSession()
  ↓
Flow Step 5: Fund Wallet
  ↓ sendEntryPointDeposit()
  ↓
Dashboard: Show completion
```

**Status:** ✅ Verified

---

## Flow: Create Organization

```
Dashboard (Organizations Page)
  ↓ Click "Submit Request"
  ↓ Set name, owner address
  ↓
POST /api/organizations/requests { name, ownerAddress, eip712Signature }
  ↓
Service: AuthorityService.submitRequest()
  ↓ Rate limit check
  ↓ INSERT INTO organization_requests
  ↓ EventBus: emit OrganizationRequested
  ↓
Response: { success, requestId }
  ↓
Admin: Review request
  ↓
POST /api/organizations/requests/:id { action: "approve" }
  ↓
Service: AuthorityService.approveRequest()
  ↓ INSERT INTO organizations
  ↓ DELETE FROM organization_requests
  ↓ EventBus: emit OrganizationRegistered
  ↓
Response: { success, organizationId }
  ↓
Dashboard: Refresh organization list
```

**Status:** ✅ Verified

---

## Flow: Create Delegation

```
Dashboard (Delegations Page)
  ↓ Click "Create Delegation"
  ↓ Set delegator, delegatee, scope, expiry
  ↓
POST /api/delegations { organizationId, delegator, delegatee, scope, maxValue, expiry }
  ↓
Database: INSERT INTO delegations
  ↓
EventBus: emit DelegationCreated
  ↓
Response: { success, delegationId }
  ↓
Dashboard: Refresh delegation list
```

**Status:** ✅ Verified

---

## Flow: Create Capability

```
Dashboard (Capabilities Page)
  ↓ Click "Create Capability"
  ↓ Set name, description
  ↓
POST /api/capabilities { organizationId, name, description }
  ↓
Database: INSERT INTO capabilities
  ↓
EventBus: emit CapabilityRegistered
  ↓
Response: { success, capabilityId }
  ↓
Dashboard: Refresh capability list
```

**Status:** ✅ Verified

---

## Flow: Generate ZK Proof

```
Dashboard or API
  ↓
POST /api/proofs/generate { organizationId, agentId, walletAddress, sessionExpiry, sessionNonce, maxValue }
  ↓
Tool: src/tools/proof.ts generateProof()
  ↓ Load credential from DB
  ↓ Compute commitment (Poseidon7)
  ↓ Get active tree Merkle proof
  ↓ Compute revocation key (Poseidon2)
  ↓ Get revoked SMT non-membership proof
  ↓ Build witness
  ↓ snarkjs.groth16.fullProve()
  ↓ Verify locally
  ↓ Format Solidity calldata
  ↓ Compute nullifier (Poseidon3)
  ↓ INSERT INTO proofs
  ↓
Response: { success, proofHash, nullifier, activeRoot, revokedRoot, calldata, proof }
```

**Status:** ✅ Verified

---

## Flow: Execute Transaction (via MCP)

```
AI Agent (MCP)
  ↓
agentix_wallet_execute { walletAddress, target, value, data, ownerPrivateKey }
  ↓
MCP Server
  ↓
Compiler Gateway
  ↓ executeIntent('wallet_execute', params)
  ↓ Policy check
  ↓ Risk assessment
  ↓ Compile (10-stage pipeline)
  ↓ Simulate
  ↓ Auto-approve (within policy)
  ↓
Tool: encodeAndValidate('wallet_execute', params)
  ↓ ProxyGuard.validate(target)
  ↓ Encode wallet.execute() calldata
  ↓ assertDeployed(target)
  ↓
Signer: sendTransaction()
  ↓
Contract: AgentWallet.execute()
  ↓
EventBus: emit WalletExecuted
  ↓
Database: INSERT INTO agent_actions
  ↓
Response: { success, txHash }
```

**Status:** ✅ Verified

---

## Flow: Backup & Restore

```
Dashboard (Backups Page)
  ↓ Click "Create Backup"
  ↓
POST /api/backups { description }
  ↓
BackupEngine.create()
  ↓ Export all tables
  ↓ Compute checksum
  ↓ Save to ~/.agentix/backups/
  ↓ INSERT INTO backups
  ↓
Response: { success, backupId, filename, size, checksum }
  ↓
Restore:
  ↓
POST /api/backups/restore { backupId }
  ↓
BackupEngine.restore()
  ↓ Read backup file
  ↓ Verify checksum
  ↓ Drop all tables
  ↓ Import all tables
  ↓
Response: { success }
```

**Status:** ✅ Verified

---

## Flow: Harness Detection

```
Dashboard (Agents Page)
  ↓ Load page
  ↓
GET /api/onboarding/harnesses
  ↓
HarnessManager.scanAll()
  ↓ Scan for Claude Code
  ↓ Scan for MimoCode
  ↓ Scan for OpenCode
  ↓ Scan for GitHub Copilot
  ↓ Scan for Hermes
  ↓
Database: INSERT OR REPLACE INTO harnesses
  ↓
Response: { harnesses, totalDetected, totalConnected }
  ↓
Dashboard: Display harness cards
```

**Status:** ✅ Verified

---

## Flow: Event Indexing

```
Runtime Start
  ↓
EventIndexer.start()
  ↓ Load checkpoint from indexer_checkpoints
  ↓ Query on-chain events from last block
  ↓ Parse events via KNOWN_EVENTS
  ↓ INSERT INTO indexed_events
  ↓ Update checkpoint
  ↓
Dashboard (Events Page)
  ↓
GET /api/events
  ↓
Merge: on-chain events + local events + bus events
  ↓ Deduplicate by _id
  ↓ Sort by timestamp
  ↓
Response: { events, total }
```

**Status:** ✅ Verified

---

## Flow: Policy Enforcement

```
Owner sets policy:
  ↓
POST /api/policy { walletAddress, dailyLimit, perTxLimit, allowedTargets, allowedActions, forbiddenActions, sessionExpiry }
  ↓
Database: INSERT INTO owner_policies
  ↓
Agent attempts action:
  ↓
Compiler Gateway
  ↓ checkPolicy(walletAddress, action, params)
  ↓ Check daily limit
  ↓ Check per-tx limit
  ↓ Check allowed targets
  ↓ Check allowed actions
  ↓ Check forbidden actions
  ↓
If blocked: Return { requiresApproval: true, explanation }
If allowed: Continue to execution
```

**Status:** ✅ Verified

---

## Flow: x402 Payment

```
Agent requests protected resource:
  ↓
POST /api/x402/buy { url, method, headers, walletAddress, autoPay }
  ↓
fetchWithPayment()
  ↓ Fetch resource
  ↓ Receive 402 response
  ↓ Parse payment requirements
  ↓ Check wallet balance
  ↓ Create payment transaction
  ↓ Submit via bundler
  ↓
Database: INSERT INTO x402_payments
  ↓
Retry request with payment proof
  ↓
Response: { success, status, payment, body }
```

**Status:** ✅ Verified

---

## Summary

| Flow | Status | Verified |
|------|--------|----------|
| Create Wallet | ✅ | Yes |
| Create Session | ✅ | Yes |
| Issue Credential | ✅ | Yes |
| Create Organization | ✅ | Yes |
| Create Delegation | ✅ | Yes |
| Create Capability | ✅ | Yes |
| Generate ZK Proof | ✅ | Yes |
| Execute Transaction (MCP) | ✅ | Yes |
| Backup & Restore | ✅ | Yes |
| Harness Detection | ✅ | Yes |
| Event Indexing | ✅ | Yes |
| Policy Enforcement | ✅ | Yes |
| x402 Payment | ✅ | Yes |

**All 13 flows verified end-to-end.**
