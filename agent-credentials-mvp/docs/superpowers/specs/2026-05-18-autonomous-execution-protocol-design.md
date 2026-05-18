# Autonomous Agent Execution Protocol Design

**Date:** 2026-05-18
**Author:** Design session with user
**Status:** Pending implementation

---

## Overview

Design a protocol where AI agents can execute blockchain transactions autonomously within bounded rules (whitelists, session limits, organization policies). The protocol should work seamlessly with enterprise agents and any autonomous agents.

## Problem Statement

### Current Issues

1. **Popup Dialog Breaking Flow**: Quick action buttons (Send Transaction, Batch Transactions, Deposit Gas) open popup dialogs instead of executing through natural chat interaction
2. **EntryPoint Error**: "Invalid user operation for entry point: 0x4337084d9e255ff0702461cf8895ce9e3b5ff108" when submitting transactions
3. **No True Autonomy**: Agents cannot act autonomously - every action requires manual form submission
4. **Missing Session Limits**: No daily spend/transaction limits for agent guardrails

### Goals

- Enable agents to execute transactions autonomously within protocol bounds
- Remove popup dialogs in favor of natural chat-based interaction
- Fix EntryPoint integration for proper ERC-4337 UserOperation submission
- Implement session-based authorization with daily limits
- Never expose user's private key - use derived session keys

---

## Architecture

### Core Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER WALLET                               │
│  (Signs once during session creation - never exposed again)     │
└────────────────────────┬────────────────────────────────────────┘
                         │ Signs session creation
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SESSION MANAGER (Contract)                     │
│  - Validates session key                                        │
│  - Enforces daily limits                                        │
│  - Tracks spend per session                                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ Session key signs UserOps
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT WALLET                                 │
│  - Holds whitelisted addresses                                   │
│  - Receives transactions from EntryPoint or session key         │
│  - Deposits gas via EntryPoint                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND SERVICE                                │
│  - Stores encrypted session keys per agent                       │
│  - Signs UserOperations with session key                         │
│  - Enforces whitelist + limits before signing                    │
│  - Submits to EntryPoint                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principle:** The user's wallet signs ONCE to create a session. After that, the derived session key (stored encrypted in the backend) signs all operations autonomously within the session's limits.

---

## Components

### 1. Session Key Lifecycle

#### Creation Flow (on agent connection)

1. Frontend generates random session key locally (`ethers.Wallet.createRandom()`)
2. User signs message: "Authorize session for agent {id}"
3. Derive user encryption key: `HKDF(signature, "session-encryption-v1")`
4. Encrypt session private key with user key → `userEncrypted`
5. Send to backend with session public key and limits
6. Backend re-encrypts with master key → `finalEncrypted`
7. Backend stores encrypted key and session token
8. Session registered in SessionManager contract with limits
9. Agent can now execute autonomously within bounds

#### Session Data Structure

```typescript
interface AgentSession {
  sessionId: string           // bytes32 unique identifier
  agentId: number            // Linked external agent
  walletAddress: string      // Agent wallet address
  sessionPublicKey: string   // Stored in contract
  encryptedPrivateKey: string // Double-encrypted (user + backend)
  sessionToken: string       // Encrypted user key for backend decryption
  dailySpendLimit: string    // Wei
  dailyTxLimit: number
  currentDailySpend: string  // Resets daily
  currentDailyTx: number
  lastResetDay: number       // Unix day for reset tracking
  totalSpend: string         // Lifetime spend
  expiresAt: number          // Unix timestamp
  createdAt: number
  revokedAt?: number
}
```

#### Dual-Encryption Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
│  1. Generate random session key (ethers.Wallet.createRandom)    │
│  2. Get user signature: "Create session for agent {id}"         │
│  3. Derive user key: HKDF(signature, "session-encryption-v1")  │
│  4. Encrypt session private key with user key → userEncrypted   │
│  5. Send to backend: { sessionPublicKey, userEncrypted, ... }   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                   │
│  1. Receive userEncrypted blob                                  │
│  2. Re-encrypt with backend master key → finalEncrypted        │
│  3. Store in DB: { ...sessionData, encryptedPrivateKey }        │
│                                                                 │
│  At execution time (autonomous):                                │
│  1. Fetch encryptedPrivateKey                                   │
│  2. Decrypt with backend key → userEncrypted                   │
│  3. Decrypt sessionToken → user key                            │
│  4. Decrypt userEncrypted → raw session key                    │
│  5. Sign UserOperation, clear from memory                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Smart Contract Changes

#### SessionManager.sol Additions

Add to existing SessionManager contract (backward compatible):

```solidity
// New struct for lightweight session with daily limits
struct LightweightSession {
    address sessionKey;
    uint256 dailySpendLimit;      // Reset daily
    uint256 dailyTxLimit;         // Transaction count limit
    uint256 dailySpendUsed;
    uint256 dailyTxUsed;
    uint64 lastResetDay;          // Track day for reset
    uint64 expiry;
    bool revoked;
}

mapping(bytes32 => LightweightSession) public lightSessions;
mapping(address => bytes32[]) public walletSessions;

// Daily reset check (internal)
function _checkAndResetDaily(LightweightSession storage s) internal {
    uint64 currentDay = uint64(block.timestamp / 1 days);
    if (s.lastResetDay < currentDay) {
        s.dailySpendUsed = 0;
        s.dailyTxUsed = 0;
        s.lastResetDay = currentDay;
    }
}

// New: Owner-signed session creation (no ZK proof required)
// Called by backend on behalf of wallet owner
function createLightweightSession(
    bytes32 sessionId,
    address sessionKey,
    uint256 dailySpendLimit,
    uint256 dailyTxLimit,
    uint64 expiry,
    bytes calldata ownerSignature  // EIP-191 from wallet owner
) external {
    require(sessionKey != address(0), "Invalid key");
    require(expiry > block.timestamp, "Invalid expiry");
    require(lightSessions[sessionId].sessionKey == address(0), "Session exists");
    
    // Verify owner signature over session params
    bytes32 digest = keccak256(abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        keccak256(abi.encode(sessionId, sessionKey, dailySpendLimit, dailyTxLimit, expiry))
    ));
    address signer = digest.recover(ownerSignature);
    
    // Verify signer owns the calling wallet (via AgentWallet.owner())
    // This is called through the wallet, so msg.sender is the wallet
    require(IAgentWallet(msg.sender).owner() == signer, "Not wallet owner");
    
    lightSessions[sessionId] = LightweightSession({
        sessionKey: sessionKey,
        dailySpendLimit: dailySpendLimit,
        dailyTxLimit: dailyTxLimit,
        dailySpendUsed: 0,
        dailyTxUsed: 0,
        lastResetDay: uint64(block.timestamp / 1 days),
        expiry: expiry,
        revoked: false
    });
    
    walletSessions[msg.sender].push(sessionId);
    emit SessionCreated(sessionId, sessionKey, expiry, uint128(dailySpendLimit));
}

// Validate lightweight session for UserOperation
function validateLightweightSession(
    bytes32 sessionId,
    address signer,
    uint256 value
) external returns (bool) {
    LightweightSession storage s = lightSessions[sessionId];
    
    require(!s.revoked, "Revoked");
    require(block.timestamp <= s.expiry, "Session Expired");
    require(s.sessionKey == signer, "Invalid signer");
    
    _checkAndResetDaily(s);
    
    uint256 newSpend = s.dailySpendUsed + value;
    require(newSpend <= s.dailySpendLimit, "Daily spend limit exceeded");
    require(s.dailyTxUsed + 1 <= s.dailyTxLimit, "Daily tx limit exceeded");
    
    s.dailySpendUsed = newSpend;
    s.dailyTxUsed++;
    
    emit SessionUsed(sessionId, value, newSpend);
    return true;
}

// Revoke session
function revokeLightweightSession(bytes32 sessionId) external {
    LightweightSession storage s = lightSessions[sessionId];
    require(s.sessionKey != address(0), "Unknown session");
    require(!s.revoked, "Already revoked");
    
    // Only wallet owner or session key can revoke
    address walletOwner = IAgentWallet(msg.sender).owner();
    require(
        msg.sender == walletOwner || 
        IAgentWallet(msg.sender).owner() == msg.sender,
        "Not authorized"
    );
    
    s.revoked = true;
    emit SessionRevoked(sessionId);
}
```

#### AgentWallet.sol Changes

Modify `_validateUserOperation()` to support both session types:

```solidity
function _validateUserOperation(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash
) internal returns (uint256 spendValue, bytes32 sessionId, address signer) {
    spendValue = _extractSpendValue(userOp.callData);
    
    bytes32 digest = ECDSA.toEthSignedMessageHash(userOpHash);
    
    if (userOp.signature.length == 65) {
        // Direct owner signature
        signer = digest.recover(userOp.signature);
        require(signer == owner, "Invalid owner signature");
        return (spendValue, bytes32(0), signer);
    }
    
    // Session key signature: abi.encode(sessionId, signature)
    bytes memory sessionSignature;
    (sessionId, sessionSignature) = abi.decode(userOp.signature, (bytes32, bytes));
    signer = digest.recover(sessionSignature);
    
    // Try lightweight session first (lower gas)
    try ISessionManager(sessionManager).validateLightweightSession(
        sessionId, signer, spendValue
    ) returns (bool valid) {
        require(valid, "Invalid lightweight session");
    } catch {
        // Fallback to ZK-proof session
        bool valid = ISessionManager(sessionManager).validateSession(
            sessionId, signer, spendValue
        );
        require(valid, "Invalid session");
    }
}
```

### 3. Chat-Based Execution Flow

#### Popup Removal

**Before:**
```
QuickAction click → ActionDialog popup → User fills form → Direct API call
```

**After:**
```
QuickAction click → Inject template into chat input
User completes message → Send to runtime
Runtime calls backend tool → Backend signs with session key
Backend submits to EntryPoint → Transaction executed
Agent responds in chat with result
```

#### Example Interactions

**Send Transaction (whitelisted):**
```
User: [clicked "Send Transaction"]
User: Send 0.1 ETH to 0x1234...

Agent: I'll send 0.1 ETH to 0x1234...
       ✓ Address is whitelisted
       💰 Session has 0.5 ETH daily limit remaining
       
       Proceed? [Yes] [No]

User: [clicked Yes]

Agent: ✅ Transaction submitted!
       Hash: 0xabc123...
       Gas used: 0.002 ETH
       Remaining daily limit: 0.4 ETH
```

**Send Transaction (not whitelisted):**
```
User: Send 0.1 ETH to 0xabcd...

Agent: ⚠️ Cannot send to 0xabcd...
       This address is not in your whitelist.
       
       Would you like to add it? [Add to Whitelist] [Cancel]
```

**Batch Transactions:**
```
User: [clicked "Batch Transactions"]
User: Send 0.05 ETH each to: 0x1111..., 0x2222..., 0x3333...

Agent: I'll send 0.05 ETH to each of 3 addresses:
       • 0x1111... ✓ whitelisted
       • 0x2222... ✓ whitelisted
       • 0x3333... ✓ whitelisted
       
       Total: 0.15 ETH
       Session limit remaining: 0.35 ETH
       
       Proceed? [Yes] [No]
```

**Deposit Gas:**
```
User: [clicked "Deposit Gas"]
User: Deposit 0.1 ETH to the EntryPoint for gas

Agent: I'll deposit 0.1 ETH to the EntryPoint for gas sponsorship.
       
       Proceed? [Yes] [No]

User: [clicked Yes]

Agent: ✅ Gas deposited!
       New EntryPoint balance: 0.15 ETH
       TxHash: 0xdef456...
```

### 4. EntryPoint Integration

#### UserOperation Signing

```typescript
// In AgentToolsService.sendTransaction()
async sendTransaction(params): Promise<AgentActionResult> {
  // 1. Validate whitelist
  const isWhitelisted = await blockchainService.isWhitelisted(
    walletAddress, 
    params.target
  );
  if (!isWhitelisted) {
    return {
      success: false,
      error: "Target not whitelisted",
      needsWhitelist: true,
      target: params.target
    };
  }
  
  // 2. Check session limits
  const session = await this.getSessionForAgent(walletAddress, agentId);
  if (session.currentDailySpend + params.valueWei > session.dailySpendLimit) {
    return {
      success: false,
      error: "Daily spend limit exceeded",
      limitRemaining: session.dailySpendLimit - session.currentDailySpend
    };
  }
  
  // 3. Prepare callData for AgentWallet.execute()
  const walletInterface = new ethers.Interface(AGENT_WALLET_ABI);
  const callData = walletInterface.encodeFunctionData("execute", [
    params.target,
    BigInt(params.valueWei),
    params.data || "0x"
  ]);
  
  // 4. Build UserOperation
  const nonce = await bundler.getNonce(walletAddress);
  const userOp = {
    sender: walletAddress,
    nonce: ethers.toBeHex(nonce),
    initCode: "0x",
    callData,
    accountGasLimits: bundler.buildPackedGasLimits(500000n, 500000n),
    preVerificationGas: ethers.toBeHex(100000n),
    gasFees: bundler.buildPackedGasFees(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: "0x",
    signature: "0x"  // Placeholder
  };
  
  // 5. Get UserOp hash
  const userOpHash = await bundler.getUserOpHash(userOp, entryPointAddress);
  
  // 6. Decrypt session key and sign
  const sessionWallet = await this.decryptSessionKey(session);
  const sessionSignature = await sessionWallet.signMessage(
    ethers.getBytes(userOpHash)
  );
  
  // 7. Encode signature: sessionId + signature
  const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes'],
    [session.sessionId, sessionSignature]
  );
  userOp.signature = encodedSignature;
  
  // 8. Submit to EntryPoint
  const userOpHashResult = await bundler.sendUserOperation(userOp, entryPointAddress);
  
  // 9. Update session spend
  await this.updateSessionSpend(session.sessionId, params.valueWei);
  
  return {
    success: true,
    userOpHash: userOpHashResult,
    value: params.valueWei,
    target: params.target
  };
}
```

### 5. Database Schema

#### New Tables

```sql
-- Agent sessions with encrypted keys
CREATE TABLE agent_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  agent_id INTEGER REFERENCES external_agents(id),
  wallet_address TEXT NOT NULL,
  session_public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  session_token TEXT NOT NULL,
  daily_spend_limit_wei TEXT NOT NULL,
  daily_tx_limit INTEGER NOT NULL,
  current_daily_spend_wei TEXT DEFAULT '0',
  current_daily_tx INTEGER DEFAULT 0,
  last_reset_day INTEGER,
  total_spend_wei TEXT DEFAULT '0',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_id);
CREATE INDEX idx_agent_sessions_wallet ON agent_sessions(wallet_address);

-- Organization-level default limits
CREATE TABLE org_limits (
  id SERIAL PRIMARY KEY,
  org_id INTEGER UNIQUE REFERENCES organizations(id),
  default_daily_spend_limit_wei TEXT DEFAULT '1000000000000000000',
  default_daily_tx_limit INTEGER DEFAULT 10,
  updated_at INTEGER
);

-- Per-agent limit overrides
CREATE TABLE agent_limits (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER UNIQUE REFERENCES external_agents(id),
  daily_spend_limit_wei TEXT,
  daily_tx_limit INTEGER,
  updated_at INTEGER
);
```

---

## Files to Modify

| File | Changes |
|------|----------|
| `contracts/src/SessionManager.sol` | Add LightweightSession, daily limits, owner-signed creation |
| `contracts/src/AgentWallet.sol` | Support both session types in validateUserOp |
| `frontend/components/execute/chat-execution-panel.tsx` | Remove ActionDialog, add template injection |
| `frontend/components/execute/action-dialog.tsx` | Delete or repurpose for inline confirmation |
| `frontend/components/execute/quick-actions.tsx` | Inject template into chat instead of opening popup |
| `frontend/lib/session.ts` | New - session key generation, encryption |
| `frontend/lib/external-agents-api.ts` | Add session creation endpoints |
| `backend/src/services/sessionKey.ts` | New - session management, decryption |
| `backend/src/services/agentTools.ts` | Rewrite - session signing, UserOp submission |
| `backend/src/routes/sessions.ts` | New - session creation/revoke endpoints |
| `backend/src/migrations.ts` | Add new tables |

---

## Execution Order

1. Smart contract changes (SessionManager.sol, AgentWallet.sol)
2. Database migrations (new tables)
3. Backend session service (creation, storage, decryption)
4. Backend AgentTools rewrite (UserOp signing with session keys)
5. Frontend session creation flow (wallet interaction)
6. Frontend chat execution (remove popup, add template injection)
7. Integration testing

---

## Key Decisions Made

1. **Chat-based flow** - Quick actions inject templates into chat, user completes in natural conversation
2. **Soft confirmation + session limits** - Agent shows preview and asks confirmation; daily limits prevent runaway spending
3. **Org defaults + agent overrides** - Flexible limit configuration
4. **Fix ERC-4337 flow** - Full account abstraction benefits
5. **Session key derivation** - User's private key never exposed after initial session creation
6. **Auto-create on agent connection** - Maximum autonomy with bounded rules
7. **Client-side key generation** - Secrets generated in frontend, double-encrypted before storage
8. **Extend existing contracts** - Backward compatible, preserve ZK proof for org membership verification
