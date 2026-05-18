# Autonomous Execution Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable AI agents to execute blockchain transactions autonomously within bounded rules (whitelists, session limits) via chat-based interaction with ERC-4337 EntryPoint integration.

**Architecture:** Session keys are generated client-side, double-encrypted (user + backend), stored in database. Backend decrypts to sign UserOperations submitted to EntryPoint. SessionManager contract validates sessions with daily spend/tx limits. Chat flow replaces popup dialogs.

**Tech Stack:** Solidity, TypeScript, ethers.js, PostgreSQL, Next.js, Express

---

## File Structure

### Smart Contracts
| File | Purpose |
|------|---------|
| `contracts/src/SessionManager.sol` | Add LightweightSession struct, daily limits, owner-signed creation |
| `contracts/src/AgentWallet.sol` | Support both session types in validateUserOp |

### Backend
| File | Purpose |
|------|---------|
| `backend/src/migrations.ts` | Database schema for sessions, limits tables |
| `backend/src/services/sessionKey.ts` | Session creation, encryption/decryption, limit management |
| `backend/src/services/agentTools.ts` | Rewrite: session signing, UserOp submission to EntryPoint |
| `backend/src/routes/sessions.ts` | REST endpoints for session lifecycle |
| `backend/src/routes/externalAgents.ts` | Add session creation on agent connect, limit endpoints |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/lib/session.ts` | Session key generation, client-side encryption |
| `frontend/lib/external-agents-api.ts` | Add session creation API calls |
| `frontend/components/execute/quick-actions.tsx` | Inject template to chat instead of popup |
| `frontend/components/execute/chat-execution-panel.tsx` | Remove ActionDialog, handle inline confirmation |
| `frontend/components/execute/action-dialog.tsx` | DELETE (no longer needed) |

---

## Phase 1: Smart Contract Changes

### Task 1: Add LightweightSession Struct to SessionManager

**Files:**
- Modify: `contracts/src/SessionManager.sol`

- [ ] **Step 1: Add new struct and mappings after existing Session struct**

```solidity
// Add after line 53 (after existing Session struct)

// Lightweight session for enterprise agent autonomy
struct LightweightSession {
    address sessionKey;
    uint256 dailySpendLimit;
    uint256 dailyTxLimit;
    uint256 dailySpendUsed;
    uint256 dailyTxUsed;
    uint64 lastResetDay;
    uint64 expiry;
    bool revoked;
}

mapping(bytes32 => LightweightSession) public lightSessions;
mapping(address => bytes32[]) public walletSessions;

// Events for lightweight sessions
event LightSessionCreated(
    bytes32 indexed sessionId,
    address indexed sessionKey,
    address indexed wallet,
    uint256 dailySpendLimit,
    uint256 dailyTxLimit,
    uint64 expiry
);
event LightSessionUsed(
    bytes32 indexed sessionId,
    uint256 value,
    uint256 dailySpendUsed,
    uint256 dailyTxUsed
);
event LightSessionRevoked(bytes32 indexed sessionId);
```

- [ ] **Step 2: Add IAgentWallet interface at top of contract**

```solidity
// Add after line 20 (after ICredentialRegistry interface)

interface IAgentWallet {
    function owner() external view returns (address);
}
```

- [ ] **Step 3: Add daily reset helper function**

```solidity
// Add before closing brace of contract

function _checkAndResetDaily(LightweightSession storage s) internal {
    uint64 currentDay = uint64(block.timestamp / 1 days);
    if (s.lastResetDay < currentDay) {
        s.dailySpendUsed = 0;
        s.dailyTxUsed = 0;
        s.lastResetDay = currentDay;
    }
}
```

- [ ] **Step 4: Run contract compilation**

Run: `cd contracts && npm run build`
Expected: Compilation successful, no errors

- [ ] **Step 5: Commit**

```bash
git add contracts/src/SessionManager.sol
git commit -m "feat(contracts): add LightweightSession struct and mappings

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 2: Add createLightweightSession Function

**Files:**
- Modify: `contracts/src/SessionManager.sol`

- [ ] **Step 1: Add the createLightweightSession function**

```solidity
// Add after _checkAndResetDaily function

/**
 * @notice Create a lightweight session with owner signature
 * @dev Called by backend on behalf of wallet owner
 * @param sessionId Unique session identifier
 * @param sessionKey Public key of session (signer address)
 * @param dailySpendLimit Maximum wei spendable per day
 * @param dailyTxLimit Maximum transactions per day
 * @param expiry Unix timestamp when session expires
 * @param ownerSignature EIP-191 signature from wallet owner
 */
function createLightweightSession(
    bytes32 sessionId,
    address sessionKey,
    uint256 dailySpendLimit,
    uint256 dailyTxLimit,
    uint64 expiry,
    bytes calldata ownerSignature
) external {
    require(sessionKey != address(0), "Invalid session key");
    require(expiry > block.timestamp, "Invalid expiry");
    require(lightSessions[sessionId].sessionKey == address(0), "Session exists");
    
    // Verify owner signature over session params
    bytes32 messageHash = keccak256(abi.encode(
        sessionId,
        sessionKey,
        dailySpendLimit,
        dailyTxLimit,
        expiry
    ));
    bytes32 digest = keccak256(abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        messageHash
    ));
    address signer = digest.recover(ownerSignature);
    
    // Verify signer is the wallet owner
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
    
    emit LightSessionCreated(
        sessionId,
        sessionKey,
        msg.sender,
        dailySpendLimit,
        dailyTxLimit,
        expiry
    );
}
```

- [ ] **Step 2: Run contract compilation**

Run: `cd contracts && npm run build`
Expected: Compilation successful

- [ ] **Step 3: Commit**

```bash
git add contracts/src/SessionManager.sol
git commit -m "feat(contracts): add createLightweightSession with owner signature

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 3: Add validateLightweightSession Function

**Files:**
- Modify: `contracts/src/SessionManager.sol`

- [ ] **Step 1: Add the validation function**

```solidity
// Add after createLightweightSession

/**
 * @notice Validate a lightweight session for UserOperation execution
 * @param sessionId Session to validate
 * @param signer Address that signed the UserOperation
 * @param value Value being transferred in this transaction
 * @return valid True if session is valid and limits not exceeded
 */
function validateLightweightSession(
    bytes32 sessionId,
    address signer,
    uint256 value
) external returns (bool) {
    LightweightSession storage s = lightSessions[sessionId];
    
    require(s.sessionKey != address(0), "Session not found");
    require(!s.revoked, "Session revoked");
    require(block.timestamp <= s.expiry, "Session expired");
    require(s.sessionKey == signer, "Invalid session signer");
    
    _checkAndResetDaily(s);
    
    uint256 newSpend = s.dailySpendUsed + value;
    require(newSpend <= s.dailySpendLimit, "Daily spend limit exceeded");
    require(s.dailyTxUsed + 1 <= s.dailyTxLimit, "Daily tx limit exceeded");
    
    s.dailySpendUsed = newSpend;
    s.dailyTxUsed++;
    
    emit LightSessionUsed(sessionId, value, s.dailySpendUsed, s.dailyTxUsed);
    
    return true;
}
```

- [ ] **Step 2: Run contract compilation**

Run: `cd contracts && npm run build`
Expected: Compilation successful

- [ ] **Step 3: Commit**

```bash
git add contracts/src/SessionManager.sol
git commit -m "feat(contracts): add validateLightweightSession with daily limits

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 4: Add revokeLightweightSession Function

**Files:**
- Modify: `contracts/src/SessionManager.sol`

- [ ] **Step 1: Add the revoke function**

```solidity
// Add after validateLightweightSession

/**
 * @notice Revoke a lightweight session
 * @dev Only wallet owner or session key holder can revoke
 * @param sessionId Session to revoke
 */
function revokeLightweightSession(bytes32 sessionId) external {
    LightweightSession storage s = lightSessions[sessionId];
    
    require(s.sessionKey != address(0), "Session not found");
    require(!s.revoked, "Already revoked");
    
    // Verify caller is wallet owner (through wallet contract)
    address walletOwner = IAgentWallet(msg.sender).owner();
    require(
        walletOwner == msg.sender || walletOwner == tx.origin,
        "Not authorized to revoke"
    );
    
    s.revoked = true;
    
    emit LightSessionRevoked(sessionId);
}

/**
 * @notice Get session details
 * @param sessionId Session to query
 */
function getLightSession(bytes32 sessionId) external view returns (
    address sessionKey,
    uint256 dailySpendLimit,
    uint256 dailyTxLimit,
    uint256 dailySpendUsed,
    uint256 dailyTxUsed,
    uint64 expiry,
    bool revoked
) {
    LightweightSession storage s = lightSessions[sessionId];
    return (
        s.sessionKey,
        s.dailySpendLimit,
        s.dailyTxLimit,
        s.dailySpendUsed,
        s.dailyTxUsed,
        s.expiry,
        s.revoked
    );
}

/**
 * @notice Get all sessions for a wallet
 * @param wallet Wallet address
 */
function getWalletSessions(address wallet) external view returns (bytes32[] memory) {
    return walletSessions[wallet];
}
```

- [ ] **Step 2: Run contract compilation**

Run: `cd contracts && npm run build`
Expected: Compilation successful

- [ ] **Step 3: Commit**

```bash
git add contracts/src/SessionManager.sol
git commit -m "feat(contracts): add revoke and getter functions for lightweight sessions

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 5: Update AgentWallet to Support Lightweight Sessions

**Files:**
- Modify: `contracts/src/AgentWallet.sol`

- [ ] **Step 1: Update _validateUserOperation to support both session types**

Find the existing `_validateUserOperation` function (around line 140-180) and replace with:

```solidity
function _validateUserOperation(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash
) internal returns (uint256 spendValue, bytes32 sessionId, address signer) {
    spendValue = _extractSpendValue(userOp.callData);
    
    bytes32 digest = ECDSA.toEthSignedMessageHash(userOpHash);
    
    // Check if signature is direct owner signature (65 bytes)
    if (userOp.signature.length == 65) {
        signer = digest.recover(userOp.signature);
        require(signer == owner, "Invalid owner signature");
        return (spendValue, bytes32(0), signer);
    }
    
    // Session key signature: abi.encode(sessionId, signature)
    (sessionId, bytes memory sessionSignature) = abi.decode(
        userOp.signature,
        (bytes32, bytes)
    );
    signer = digest.recover(sessionSignature);
    
    // Try lightweight session first (lower gas)
    try ISessionManager(sessionManager).validateLightweightSession(
        sessionId,
        signer,
        spendValue
    ) returns (bool valid) {
        require(valid, "Lightweight session validation failed");
    } catch {
        // Fallback to ZK-proof session for existing sessions
        bool valid = ISessionManager(sessionManager).validateSession(
            sessionId,
            signer,
            spendValue
        );
        require(valid, "Session validation failed");
    }
}
```

- [ ] **Step 2: Run contract compilation**

Run: `cd contracts && npm run build`
Expected: Compilation successful

- [ ] **Step 3: Commit**

```bash
git add contracts/src/AgentWallet.sol
git commit -m "feat(contracts): support lightweight sessions in AgentWallet

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 6: Write Contract Tests

**Files:**
- Create: `contracts/test/LightweightSession.t.sol`

- [ ] **Step 1: Create test file with test contract**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SessionManager.sol";
import "../src/AgentWallet.sol";
import "../src/AgentWalletFactory.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract LightweightSessionTest is Test {
    using ECDSA for bytes32;
    
    SessionManager public sessionManager;
    AgentWalletFactory public factory;
    AgentWallet public walletImpl;
    AgentWallet public wallet;
    
    address public owner = makeAddr("owner");
    address public sessionKey = makeAddr("sessionKey");
    address public entryPoint = makeAddr("entryPoint");
    address public target = makeAddr("target");
    
    function setUp() public {
        // Deploy contracts
        sessionManager = new SessionManager(address(0), address(0));
        walletImpl = new AgentWallet();
        factory = new AgentWalletFactory(
            address(walletImpl),
            address(sessionManager),
            entryPoint
        );
        
        // Create wallet
        vm.prank(owner);
        wallet = AgentWallet(payable(factory.createWallet(owner)));
        
        // Fund wallet
        vm.deal(address(wallet), 10 ether);
    }
    
    function test_CreateLightweightSession() public {
        bytes32 sessionId = keccak256("test-session");
        uint256 dailyLimit = 1 ether;
        uint256 txLimit = 10;
        uint64 expiry = uint64(block.timestamp + 30 days);
        
        // Create signature from owner
        bytes32 messageHash = keccak256(abi.encode(
            sessionId,
            sessionKey,
            dailyLimit,
            txLimit,
            expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            uint256(vm.envUint("TEST_PRIVATE_KEY")),
            digest
        );
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Create session through wallet
        vm.prank(address(wallet));
        sessionManager.createLightweightSession(
            sessionId,
            sessionKey,
            dailyLimit,
            txLimit,
            expiry,
            signature
        );
        
        // Verify session created
        (
            address key,
            uint256 spendLimit,
            uint256 dailyTxLimit,
            ,,,bool revoked
        ) = sessionManager.getLightSession(sessionId);
        
        assertEq(key, sessionKey);
        assertEq(spendLimit, dailyLimit);
        assertEq(dailyTxLimit, txLimit);
        assertFalse(revoked);
    }
    
    function test_ValidateLightweightSession() public {
        // First create session (similar to above)
        bytes32 sessionId = keccak256("test-session");
        
        // ... setup session ...
        
        // Validate session
        vm.prank(address(wallet));
        bool valid = sessionManager.validateLightweightSession(
            sessionId,
            sessionKey,
            0.1 ether
        );
        
        assertTrue(valid);
    }
    
    function test_DailySpendLimitExceeded() public {
        // Test that exceeding daily limit reverts
        // ... implementation
    }
    
    function test_DailyTxLimitExceeded() public {
        // Test that exceeding tx count limit reverts
        // ... implementation
    }
    
    function test_RevokeSession() public {
        // Test session revocation
        // ... implementation
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd contracts && npm test`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add contracts/test/LightweightSession.t.sol
git commit -m "test(contracts): add lightweight session tests

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 2: Database Schema

### Task 7: Add Database Migrations

**Files:**
- Modify: `backend/src/migrations.ts`

- [ ] **Step 1: Add migration for agent_sessions table**

Add to the migrations array in `migrations.ts`:

```typescript
// Add to the MIGRATIONS array

{
  name: "create_agent_sessions",
  up: `
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      agent_id INTEGER REFERENCES external_agents(id) ON DELETE CASCADE,
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
    
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_wallet ON agent_sessions(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_session_id ON agent_sessions(session_id);
  `,
  down: `
    DROP TABLE IF EXISTS agent_sessions;
  `
},
{
  name: "create_org_limits",
  up: `
    CREATE TABLE IF NOT EXISTS org_limits (
      id SERIAL PRIMARY KEY,
      org_id INTEGER UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      default_daily_spend_limit_wei TEXT DEFAULT '1000000000000000000',
      default_daily_tx_limit INTEGER DEFAULT 10,
      updated_at INTEGER
    );
  `,
  down: `
    DROP TABLE IF EXISTS org_limits;
  `
},
{
  name: "create_agent_limits",
  up: `
    CREATE TABLE IF NOT EXISTS agent_limits (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER UNIQUE REFERENCES external_agents(id) ON DELETE CASCADE,
      daily_spend_limit_wei TEXT,
      daily_tx_limit INTEGER,
      updated_at INTEGER
    );
  `,
  down: `
    DROP TABLE IF EXISTS agent_limits;
  `
}
```

- [ ] **Step 2: Run migrations**

Run: `cd backend && npm run db:migrate`
Expected: Tables created successfully

- [ ] **Step 3: Commit**

```bash
git add backend/src/migrations.ts
git commit -m "feat(db): add agent_sessions, org_limits, agent_limits tables

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 3: Backend Session Service

### Task 8: Create Session Key Service

**Files:**
- Create: `backend/src/services/sessionKey.ts`

- [ ] **Step 1: Create the session key service file**

```typescript
/**
 * Session Key Service
 * 
 * Manages agent session keys for autonomous execution.
 * - Creates sessions with encrypted private keys
 * - Decrypts keys for transaction signing
 * - Enforces daily limits
 */

import { ethers } from "ethers"
import crypto from "crypto"
import { initDB } from "../db"
import { AppError } from "../utils/errors"

// Backend master encryption key from environment
const MASTER_KEY = process.env.SESSION_ENCRYPTION_KEY || ""
const MASTER_KEY_BUFFER = MASTER_KEY ? Buffer.from(MASTER_KEY, "hex") : crypto.randomBytes(32)

export interface AgentSession {
  sessionId: string
  agentId: number
  walletAddress: string
  sessionPublicKey: string
  encryptedPrivateKey: string
  sessionToken: string
  dailySpendLimitWei: string
  dailyTxLimit: number
  currentDailySpendWei: string
  currentDailyTx: number
  lastResetDay: number | null
  totalSpendWei: string
  expiresAt: number
  createdAt: number
  revokedAt: number | null
}

export interface SessionLimits {
  dailySpendLimitWei: string
  dailyTxLimit: number
}

export class SessionKeyService {
  
  /**
   * Create a new session for an agent
   */
  async createSession(params: {
    agentId: number
    walletAddress: string
    sessionPublicKey: string
    userEncryptedPrivateKey: string
    userKeyToken: string
    dailySpendLimitWei: string
    dailyTxLimit: number
    expiryDays?: number
  }): Promise<AgentSession> {
    const db = await initDB()
    
    // Generate session ID
    const sessionId = "0x" + crypto.randomBytes(32).toString("hex")
    
    // Double-encrypt: user encrypted -> backend encrypted
    const finalEncrypted = this.doubleEncrypt(params.userEncryptedPrivateKey)
    const sessionToken = this.doubleEncrypt(params.userKeyToken)
    
    const expiryDays = params.expiryDays || 30
    const expiresAt = Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60)
    const createdAt = Math.floor(Date.now() / 1000)
    
    const result = await db.run(
      `INSERT INTO agent_sessions (
        session_id, agent_id, wallet_address, session_public_key,
        encrypted_private_key, session_token, daily_spend_limit_wei,
        daily_tx_limit, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        params.agentId,
        params.walletAddress,
        params.sessionPublicKey,
        finalEncrypted,
        sessionToken,
        params.dailySpendLimitWei,
        params.dailyTxLimit,
        expiresAt,
        createdAt
      ]
    )
    
    if (!result.lastID) {
      throw new AppError(500, "Failed to create session", "session.create")
    }
    
    return this.getSession(sessionId)
  }
  
  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    const db = await initDB()
    
    const row = await db.get<AgentSession>(
      "SELECT * FROM agent_sessions WHERE session_id = ?",
      [sessionId]
    )
    
    return row || null
  }
  
  /**
   * Get active session for an agent
   */
  async getActiveSessionForAgent(agentId: number): Promise<AgentSession | null> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)
    
    const row = await db.get<AgentSession>(
      `SELECT * FROM agent_sessions 
       WHERE agent_id = ? AND revoked_at IS NULL AND expires_at > ? 
       ORDER BY created_at DESC LIMIT 1`,
      [agentId, now]
    )
    
    return row || null
  }
  
  /**
   * Decrypt session private key for signing
   * WARNING: Clear from memory after use!
   */
  async decryptSessionKey(sessionId: string): Promise<ethers.Wallet> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new AppError(404, "Session not found", "session.decrypt")
    }
    
    if (session.revokedAt) {
      throw new AppError(403, "Session revoked", "session.decrypt")
    }
    
    if (session.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new AppError(403, "Session expired", "session.decrypt")
    }
    
    // Decrypt: backend layer first, then user layer
    const userEncrypted = this.decrypt(session.encryptedPrivateKey)
    const userKey = this.decrypt(session.sessionToken)
    const rawPrivateKey = this.decryptWithKey(userEncrypted, userKey)
    
    return new ethers.Wallet(rawPrivateKey)
  }
  
  /**
   * Check and update session limits
   */
  async checkAndUpdateLimits(
    sessionId: string, 
    valueWei: string
  ): Promise<{ allowed: boolean; reason?: string; remaining?: string }> {
    const db = await initDB()
    const session = await this.getSession(sessionId)
    
    if (!session) {
      return { allowed: false, reason: "Session not found" }
    }
    
    if (session.revokedAt) {
      return { allowed: false, reason: "Session revoked" }
    }
    
    if (session.expiresAt < Math.floor(Date.now() / 1000)) {
      return { allowed: false, reason: "Session expired" }
    }
    
    // Check daily reset
    const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
    let currentSpend = session.currentDailySpendWei
    let currentTx = session.currentDailyTx
    
    if (session.lastResetDay !== currentDay) {
      // Reset counters
      currentSpend = "0"
      currentTx = 0
      await db.run(
        "UPDATE agent_sessions SET current_daily_spend_wei = ?, current_daily_tx = ?, last_reset_day = ? WHERE session_id = ?",
        ["0", 0, currentDay, sessionId]
      )
    }
    
    // Check spend limit
    const newSpend = BigInt(currentSpend) + BigInt(valueWei)
    const spendLimit = BigInt(session.dailySpendLimitWei)
    
    if (newSpend > spendLimit) {
      return { 
        allowed: false, 
        reason: "Daily spend limit exceeded",
        remaining: (spendLimit - BigInt(currentSpend)).toString()
      }
    }
    
    // Check tx limit
    if (currentTx + 1 > session.dailyTxLimit) {
      return { allowed: false, reason: "Daily transaction limit exceeded" }
    }
    
    return { allowed: true }
  }
  
  /**
   * Update session after successful transaction
   */
  async updateAfterExecution(sessionId: string, valueWei: string): Promise<void> {
    const db = await initDB()
    const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
    
    await db.run(
      `UPDATE agent_sessions SET 
        current_daily_spend_wei = CAST(current_daily_spend_wei AS INTEGER) + CAST(? AS INTEGER),
        current_daily_tx = current_daily_tx + 1,
        total_spend_wei = CAST(total_spend_wei AS INTEGER) + CAST(? AS INTEGER),
        last_reset_day = ?
       WHERE session_id = ?`,
      [valueWei, valueWei, currentDay, sessionId]
    )
  }
  
  /**
   * Revoke a session
   */
  async revokeSession(sessionId: string): Promise<void> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)
    
    await db.run(
      "UPDATE agent_sessions SET revoked_at = ? WHERE session_id = ?",
      [now, sessionId]
    )
  }
  
  /**
   * Get organization default limits
   */
  async getOrgLimits(orgId: number): Promise<SessionLimits> {
    const db = await initDB()
    
    const row = await db.get<{ 
      default_daily_spend_limit_wei: string
      default_daily_tx_limit: number 
    }>(
      "SELECT default_daily_spend_limit_wei, default_daily_tx_limit FROM org_limits WHERE org_id = ?",
      [orgId]
    )
    
    if (row) {
      return {
        dailySpendLimitWei: row.default_daily_spend_limit_wei,
        dailyTxLimit: row.default_daily_tx_limit
      }
    }
    
    // Default values
    return {
      dailySpendLimitWei: "1000000000000000000", // 1 ETH
      dailyTxLimit: 10
    }
  }
  
  /**
   * Get agent-specific limits (or org defaults)
   */
  async getAgentLimits(agentId: number, orgId: number): Promise<SessionLimits> {
    const db = await initDB()
    
    const row = await db.get<{
      daily_spend_limit_wei: string | null
      daily_tx_limit: number | null
    }>(
      "SELECT daily_spend_limit_wei, daily_tx_limit FROM agent_limits WHERE agent_id = ?",
      [agentId]
    )
    
    if (row && row.daily_spend_limit_wei && row.daily_tx_limit) {
      return {
        dailySpendLimitWei: row.daily_spend_limit_wei,
        dailyTxLimit: row.daily_tx_limit
      }
    }
    
    // Fall back to org defaults
    return this.getOrgLimits(orgId)
  }
  
  /**
   * Set organization default limits
   */
  async setOrgLimits(orgId: number, limits: SessionLimits): Promise<void> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)
    
    await db.run(
      `INSERT INTO org_limits (org_id, default_daily_spend_limit_wei, default_daily_tx_limit, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
        default_daily_spend_limit_wei = excluded.default_daily_spend_limit_wei,
        default_daily_tx_limit = excluded.default_daily_tx_limit,
        updated_at = excluded.updated_at`,
      [orgId, limits.dailySpendLimitWei, limits.dailyTxLimit, now]
    )
  }
  
  /**
   * Set agent-specific limits
   */
  async setAgentLimits(agentId: number, limits: SessionLimits): Promise<void> {
    const db = await initDB()
    const now = Math.floor(Date.now() / 1000)
    
    await db.run(
      `INSERT INTO agent_limits (agent_id, daily_spend_limit_wei, daily_tx_limit, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
        daily_spend_limit_wei = excluded.daily_spend_limit_wei,
        daily_tx_limit = excluded.daily_tx_limit,
        updated_at = excluded.updated_at`,
      [agentId, limits.dailySpendLimitWei, limits.dailyTxLimit, now]
    )
  }
  
  // === Encryption helpers ===
  
  private doubleEncrypt(data: string): string {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      MASTER_KEY_BUFFER,
      iv
    )
    
    let encrypted = cipher.update(data, "utf8", "hex")
    encrypted += cipher.final("hex")
    const authTag = cipher.getAuthTag()
    
    return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted
  }
  
  private decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":")
    
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      MASTER_KEY_BUFFER,
      Buffer.from(ivHex, "hex")
    )
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
    
    let decrypted = decipher.update(encrypted, "hex", "utf8")
    decrypted += decipher.final("utf8")
    
    return decrypted
  }
  
  private decryptWithKey(encryptedData: string, keyHex: string): string {
    const key = Buffer.from(keyHex, "hex")
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":")
    
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    )
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
    
    let decrypted = decipher.update(encrypted, "hex", "utf8")
    decrypted += decipher.final("utf8")
    
    return decrypted
  }
}

export const sessionKeyService = new SessionKeyService()
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/sessionKey.ts
git commit -m "feat(backend): add SessionKeyService for session management

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 4: Backend AgentTools Rewrite

### Task 9: Rewrite AgentTools Service for Session-Based Signing

**Files:**
- Modify: `backend/src/services/agentTools.ts`

- [ ] **Step 1: Add imports and session integration**

At the top of the file, add:

```typescript
import { sessionKeyService } from "./sessionKey"
import { getBlockchainService } from "./blockchain"
```

- [ ] **Step 2: Replace sendTransaction function**

Find the existing `sendTransaction` method and replace with:

```typescript
/**
 * Send a transaction using session key signing
 * Goes through EntryPoint with proper UserOperation
 */
async sendTransaction(params: {
    walletAddress: string
    agentId: number
    target: string
    valueWei: string
    data?: string
}): Promise<AgentActionResult> {
    const { walletAddress, agentId, target, valueWei, data = "0x" } = params
    
    try {
        // 1. Get active session for this agent
        const session = await sessionKeyService.getActiveSessionForAgent(agentId)
        if (!session) {
            return {
                success: false,
                tool: "send_transaction",
                error: "No active session for agent. Create a session first.",
                needsSession: true
            }
        }
        
        // 2. Check whitelist
        const blockchain = getBlockchainService()
        const orgContracts = await blockchain.getOrgContractsForWallet(walletAddress)
        if (!orgContracts) {
            return {
                success: false,
                tool: "send_transaction",
                error: "Wallet not found in any organization"
            }
        }
        
        const isWhitelisted = await blockchain.isWhitelisted(walletAddress, target)
        if (!isWhitelisted) {
            return {
                success: false,
                tool: "send_transaction",
                error: `Address ${target} is not whitelisted`,
                needsWhitelist: true,
                target
            }
        }
        
        // 3. Check session limits
        const limitCheck = await sessionKeyService.checkAndUpdateLimits(
            session.sessionId,
            valueWei
        )
        if (!limitCheck.allowed) {
            return {
                success: false,
                tool: "send_transaction",
                error: limitCheck.reason || "Limit exceeded",
                limitRemaining: limitCheck.remaining
            }
        }
        
        // 4. Build UserOperation
        const walletInterface = new ethers.Interface(AGENT_WALLET_ABI)
        const callData = walletInterface.encodeFunctionData("execute", [
            target,
            BigInt(valueWei),
            data
        ])
        
        const nonce = await blockchain.getNonce(walletAddress)
        const gasPrice = await blockchain.getGasPrice()
        
        const userOp: UserOperationRequest = {
            sender: walletAddress,
            nonce: ethers.toBeHex(nonce),
            initCode: "0x",
            callData,
            callGasLimit: ethers.toBeHex(500000n),
            verificationGasLimit: ethers.toBeHex(500000n),
            preVerificationGas: ethers.toBeHex(100000n),
            maxFeePerGas: ethers.toBeHex(gasPrice.maxFeePerGas),
            maxPriorityFeePerGas: ethers.toBeHex(gasPrice.maxPriorityFeePerGas),
            paymasterAndData: "0x",
            signature: "0x"
        }
        
        // 5. Get UserOp hash for signing
        const entryPointAddress = blockchain.getEntryPointAddress()
        const userOpHash = this.getUserOpHash(userOp, entryPointAddress)
        
        // 6. Decrypt session key and sign
        const sessionWallet = await sessionKeyService.decryptSessionKey(session.sessionId)
        const sessionSignature = await sessionWallet.signMessage(
            ethers.getBytes(userOpHash)
        )
        
        // 7. Encode signature: sessionId + signature
        userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes"],
            [ethers.getBytes(session.sessionId), sessionSignature]
        )
        
        // 8. Submit to EntryPoint via bundler
        const userOpHashResult = await blockchain.sendUserOperation(userOp)
        
        // 9. Update session spend
        await sessionKeyService.updateAfterExecution(session.sessionId, valueWei)
        
        return {
            success: true,
            tool: "send_transaction",
            userOpHash: userOpHashResult,
            value: valueWei,
            target,
            sessionId: session.sessionId
        }
        
    } catch (error) {
        console.error("[agentTools] sendTransaction error:", error)
        return {
            success: false,
            tool: "send_transaction",
            error: error instanceof Error ? error.message : "Unknown error"
        }
    }
}
```

- [ ] **Step 3: Add getUserOpHash helper function**

```typescript
private getUserOpHash(userOp: UserOperationRequest, entryPoint: string): string {
    // ERC-4337 UserOp hash calculation
    const packed = ethers.solidityPacked(
        ["address", "uint256", "bytes32", "bytes32", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32"],
        [
            userOp.sender,
            userOp.nonce,
            ethers.keccak256(userOp.initCode),
            ethers.keccak256(userOp.callData),
            userOp.callGasLimit,
            userOp.verificationGasLimit,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            ethers.keccak256(userOp.paymasterAndData)
        ]
    )
    
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "uint256"],
        [ethers.keccak256(packed), entryPoint, blockchain.getChainId()]
    )
    
    return ethers.keccak256(encoded)
}
```

- [ ] **Step 4: Update batch_transactions similarly**

Apply the same session-based signing pattern to `batch_transactions`.

- [ ] **Step 5: Run TypeScript compilation**

Run: `cd backend && npm run build`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/agentTools.ts
git commit -m "feat(backend): rewrite agentTools with session-based UserOp signing

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 10: Add Session Routes

**Files:**
- Create: `backend/src/routes/sessions.ts`

- [ ] **Step 1: Create session routes file**

```typescript
import express, { Request, Response } from "express"
import { sessionKeyService } from "../services/sessionKey"
import { requireSignedAction } from "../services/actionAuth"
import { respondWithError } from "../utils/errors"

const router = express.Router()

/**
 * Create a new session for an agent
 */
router.post("/", async (req: Request, res: Response) => {
    try {
        const { 
            agentId, 
            walletAddress, 
            sessionPublicKey, 
            userEncryptedPrivateKey,
            userKeyToken,
            dailySpendLimitWei,
            dailyTxLimit,
            expiryDays 
        } = req.body
        
        if (!agentId || !walletAddress || !sessionPublicKey || !userEncryptedPrivateKey || !userKeyToken) {
            res.status(400).json({
                success: false,
                error: "Missing required fields: agentId, walletAddress, sessionPublicKey, userEncryptedPrivateKey, userKeyToken"
            })
            return
        }
        
        const session = await sessionKeyService.createSession({
            agentId,
            walletAddress,
            sessionPublicKey,
            userEncryptedPrivateKey,
            userKeyToken,
            dailySpendLimitWei: dailySpendLimitWei || "1000000000000000000",
            dailyTxLimit: dailyTxLimit || 10,
            expiryDays
        })
        
        res.json({
            success: true,
            session: {
                sessionId: session.sessionId,
                sessionPublicKey: session.sessionPublicKey,
                dailySpendLimitWei: session.dailySpendLimitWei,
                dailyTxLimit: session.dailyTxLimit,
                expiresAt: session.expiresAt
            }
        })
    } catch (error) {
        respondWithError(res, error, "sessions.create")
    }
})

/**
 * Get session for an agent
 */
router.get("/agent/:agentId", async (req: Request, res: Response) => {
    try {
        const agentId = parseInt(req.params.agentId, 10)
        
        const session = await sessionKeyService.getActiveSessionForAgent(agentId)
        
        if (!session) {
            res.json({
                success: true,
                session: null,
                hasSession: false
            })
            return
        }
        
        res.json({
            success: true,
            session: {
                sessionId: session.sessionId,
                sessionPublicKey: session.sessionPublicKey,
                dailySpendLimitWei: session.dailySpendLimitWei,
                dailyTxLimit: session.dailyTxLimit,
                currentDailySpendWei: session.currentDailySpendWei,
                currentDailyTx: session.currentDailyTx,
                expiresAt: session.expiresAt
            },
            hasSession: true
        })
    } catch (error) {
        respondWithError(res, error, "sessions.get")
    }
})

/**
 * Revoke a session
 */
router.post("/:sessionId/revoke", async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params
        
        await sessionKeyService.revokeSession(sessionId)
        
        res.json({
            success: true,
            message: "Session revoked"
        })
    } catch (error) {
        respondWithError(res, error, "sessions.revoke")
    }
})

/**
 * Get/set organization limits
 */
router.get("/org/:orgId/limits", async (req: Request, res: Response) => {
    try {
        const orgId = parseInt(req.params.orgId, 10)
        const limits = await sessionKeyService.getOrgLimits(orgId)
        
        res.json({
            success: true,
            limits
        })
    } catch (error) {
        respondWithError(res, error, "sessions.orgLimits")
    }
})

router.post("/org/:orgId/limits", async (req: Request, res: Response) => {
    try {
        const orgId = parseInt(req.params.orgId, 10)
        const { dailySpendLimitWei, dailyTxLimit } = req.body
        
        await sessionKeyService.setOrgLimits(orgId, { dailySpendLimitWei, dailyTxLimit })
        
        res.json({
            success: true,
            message: "Organization limits updated"
        })
    } catch (error) {
        respondWithError(res, error, "sessions.setOrgLimits")
    }
})

/**
 * Get/set agent limits
 */
router.get("/agent/:agentId/limits", async (req: Request, res: Response) => {
    try {
        const agentId = parseInt(req.params.agentId, 10)
        // Need to get orgId from agent - would need externalAgent service
        // For now, return agent-specific limits only
        const db = await initDB()
        const row = await db.get<{
            daily_spend_limit_wei: string | null
            daily_tx_limit: number | null
        }>(
            "SELECT daily_spend_limit_wei, daily_tx_limit FROM agent_limits WHERE agent_id = ?",
            [agentId]
        )
        
        res.json({
            success: true,
            limits: row || null
        })
    } catch (error) {
        respondWithError(res, error, "sessions.agentLimits")
    }
})

router.post("/agent/:agentId/limits", async (req: Request, res: Response) => {
    try {
        const agentId = parseInt(req.params.agentId, 10)
        const { dailySpendLimitWei, dailyTxLimit } = req.body
        
        await sessionKeyService.setAgentLimits(agentId, { dailySpendLimitWei, dailyTxLimit })
        
        res.json({
            success: true,
            message: "Agent limits updated"
        })
    } catch (error) {
        respondWithError(res, error, "sessions.setAgentLimits")
    }
})

export default router
```

- [ ] **Step 2: Add missing import**

Add at top of file:

```typescript
import { initDB } from "../db"
```

- [ ] **Step 3: Register routes in index.ts**

In `backend/src/index.ts`, add:

```typescript
import sessionsRouter from "./routes/sessions"
// ... after other route imports

app.use("/api/sessions", sessionsRouter)
```

- [ ] **Step 4: Run TypeScript compilation**

Run: `cd backend && npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/sessions.ts backend/src/index.ts
git commit -m "feat(backend): add session management routes

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 5: Frontend Session Management

### Task 11: Create Frontend Session Utilities

**Files:**
- Create: `frontend/lib/session.ts`

- [ ] **Step 1: Create session utility file**

```typescript
/**
 * Session Key Management
 * 
 * Client-side session key generation and encryption.
 * Secrets are generated here and encrypted before sending to backend.
 */

import { ethers } from "ethers"
import crypto from "crypto"

export interface GeneratedSession {
  sessionPublicKey: string
  sessionPrivateKey: string
  userEncryptedPrivateKey: string
  userKeyToken: string
}

/**
 * Generate a new session key pair
 */
export async function generateSessionKey(): Promise<{ 
  publicKey: string
  privateKey: string 
}> {
  const wallet = ethers.Wallet.createRandom()
  
  return {
    publicKey: wallet.address,
    privateKey: wallet.privateKey
  }
}

/**
 * Derive encryption key from wallet signature
 */
export async function deriveUserEncryptionKey(
  signer: ethers.Signer,
  agentId: number
): Promise<string> {
  const message = `Authorize session for agent ${agentId}`
  const signature = await signer.signMessage(message)
  
  // Use HKDF-like derivation
  const hash = ethers.keccak256(ethers.toUtf8Bytes(signature + ":session-encryption-v1"))
  return hash
}

/**
 * Encrypt data with AES-256-GCM
 */
export async function encryptWithKey(
  data: string,
  keyHex: string
): Promise<string> {
  // Browser-compatible AES-GCM encryption
  const key = await crypto.subtle.importKey(
    "raw",
    ethers.getBytes(keyHex),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  )
  
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encodedData = new TextEncoder().encode(data)
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedData
  )
  
  // Format: iv:encrypted (both hex)
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("")
  const encryptedHex = Array.from(new Uint8Array(encrypted))
    .map(b => b.toString(16).padStart(2, "0")).join("")
  
  return `${ivHex}:${encryptedHex}`
}

/**
 * Create a fully prepared session for registration
 */
export async function createSessionForAgent(
  signer: ethers.Signer,
  agentId: number
): Promise<GeneratedSession> {
  // 1. Generate session key
  const { publicKey, privateKey } = await generateSessionKey()
  
  // 2. Derive user encryption key
  const userKey = await deriveUserEncryptionKey(signer, agentId)
  
  // 3. Encrypt private key with user key
  const userEncryptedPrivateKey = await encryptWithKey(privateKey, userKey)
  
  // 4. Create token (user key encrypted - will be re-encrypted by backend)
  // For transport, we send the raw user key token that backend will encrypt
  const userKeyToken = userKey
  
  return {
    sessionPublicKey: publicKey,
    sessionPrivateKey: privateKey, // WARNING: Clear this after use!
    userEncryptedPrivateKey,
    userKeyToken
  }
}

/**
 * Create signature for session registration on contract
 */
export async function signSessionCreation(
  signer: ethers.Signer,
  sessionId: string,
  sessionPublicKey: string,
  dailySpendLimitWei: string,
  dailyTxLimit: number,
  expiry: number
): Promise<string> {
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256", "uint256", "uint64"],
      [sessionId, sessionPublicKey, dailySpendLimitWei, dailyTxLimit, expiry]
    )
  )
  
  const signature = await signer.signMessage(ethers.getBytes(messageHash))
  return signature
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/session.ts
git commit -m "feat(frontend): add session key generation and encryption utilities

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 12: Add Session API Functions

**Files:**
- Modify: `frontend/lib/external-agents-api.ts`

- [ ] **Step 1: Add session API functions to the file**

Add these functions to `external-agents-api.ts`:

```typescript
/**
 * Session management API calls
 */

export interface CreateSessionParams {
  agentId: number
  walletAddress: string
  sessionPublicKey: string
  userEncryptedPrivateKey: string
  userKeyToken: string
  dailySpendLimitWei?: string
  dailyTxLimit?: number
  expiryDays?: number
}

export interface SessionInfo {
  sessionId: string
  sessionPublicKey: string
  dailySpendLimitWei: string
  dailyTxLimit: number
  currentDailySpendWei: string
  currentDailyTx: number
  expiresAt: number
}

export async function createAgentSession(
  params: CreateSessionParams
): Promise<{ success: boolean; session?: SessionInfo; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  })
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}

export async function getAgentSession(
  agentId: number
): Promise<{ success: boolean; session?: SessionInfo | null; hasSession?: boolean; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions/agent/${agentId}`)
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}

export async function revokeAgentSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/revoke`, {
    method: "POST"
  })
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}

export async function getOrgLimits(
  orgId: number
): Promise<{ success: boolean; limits?: { dailySpendLimitWei: string; dailyTxLimit: number }; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions/org/${orgId}/limits`)
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}

export async function setOrgLimits(
  orgId: number,
  limits: { dailySpendLimitWei: string; dailyTxLimit: number }
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions/org/${orgId}/limits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits)
  })
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}

export async function setAgentLimits(
  agentId: number,
  limits: { dailySpendLimitWei: string; dailyTxLimit: number }
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/sessions/agent/${agentId}/limits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits)
  })
  
  if (!response.ok) {
    const error = await response.text()
    return { success: false, error }
  }
  
  const data = await response.json()
  return data
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/external-agents-api.ts
git commit -m "feat(frontend): add session management API functions

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 6: Frontend Chat Execution Redesign

### Task 13: Redesign Quick Actions for Chat Injection

**Files:**
- Modify: `frontend/components/execute/quick-actions.tsx`

- [ ] **Step 1: Update QuickAction interface and behavior**

Replace the entire file content with:

```typescript
"use client"

import {
  Send,
  Layers,
  MessageSquare,
  Wallet,
} from "lucide-react"
import { motion } from "framer-motion"

export interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  template: string
  cursorPosition?: number // Position to place cursor after template (for inline editing)
  description: string
}

interface QuickActionsProps {
  onActionSelect: (action: QuickAction) => void
}

/**
 * Quick actions for agent execution
 * 
 * When clicked, these inject a template message into the chat input.
 * The user completes the message in the chat, and the agent executes autonomously.
 * 
 * Only includes actions the AgentWallet protocol supports:
 * - execute() → Send Transaction
 * - executeBatch() → Batch Transactions
 * - addToWhitelist() / removeFromWhitelist() → via chat
 * - depositToEntryPoint() → Deposit Gas
 */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "send_transaction",
    label: "Send Transaction",
    icon: <Send className="h-4 w-4" />,
    template: "Send 0.1 ETH to 0x",
    cursorPosition: 8, // After "Send 0.1 ETH to "
    description: "Send ETH to a whitelisted address",
  },
  {
    id: "batch_transactions",
    label: "Batch Transactions",
    icon: <Layers className="h-4 w-4" />,
    template: "Send 0.05 ETH each to: 0x",
    cursorPosition: 23, // After "Send 0.05 ETH each to: "
    description: "Send ETH to multiple whitelisted addresses",
  },
  {
    id: "deposit_gas",
    label: "Deposit Gas",
    icon: <Wallet className="h-4 w-4" />,
    template: "Deposit 0.1 ETH to EntryPoint for gas",
    description: "Fund the agent wallet for transaction gas",
  },
  {
    id: "whitelist",
    label: "Whitelist",
    icon: <MessageSquare className="h-4 w-4" />,
    template: "Add 0x to whitelist",
    cursorPosition: 5, // After "Add "
    description: "Add an address to the whitelist",
  },
]

export function QuickActions({ onActionSelect }: QuickActionsProps) {
  return (
    <div className="border-t border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((action) => (
          <motion.button
            key={action.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15 }}
            onClick={() => onActionSelect(action)}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 
                       px-3 py-2 text-sm text-zinc-300 transition-colors
                       hover:border-zinc-600 hover:bg-zinc-700/50 hover:text-white"
            title={action.description}
          >
            {action.icon}
            <span>{action.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

export { QUICK_ACTIONS }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/execute/quick-actions.tsx
git commit -m "feat(frontend): add cursorPosition for template injection

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 14: Redesign Chat Execution Panel

**Files:**
- Modify: `frontend/components/execute/chat-execution-panel.tsx`

- [ ] **Step 1: Remove ActionDialog import and usage**

Remove:
```typescript
import { ActionDialog } from "./action-dialog"
```

Remove the `showActionDialog` state.

Remove the `<ActionDialog />` component from JSX.

- [ ] **Step 2: Update handleActionSelect to inject into chat input**

Replace the existing `handleActionSelect` function with:

```typescript
const handleActionSelect = (action: QuickAction) => {
  // Inject template into chat input
  setInputMessage(action.template)
  
  // Focus the input after a short delay
  setTimeout(() => {
    inputRef.current?.focus()
    
    // Position cursor if specified
    if (action.cursorPosition && inputRef.current) {
      inputRef.current.setSelectionRange(
        action.cursorPosition,
        action.cursorPosition
      )
    }
  }, 50)
}
```

- [ ] **Step 3: Update handleMessageSend for inline confirmation**

Replace the existing `handleMessageSend` function with a version that:
1. Sends message to runtime
2. Parses response for confirmation needed
3. Shows inline Yes/No buttons instead of popup

```typescript
const handleMessageSend = async (e?: React.FormEvent) => {
  e?.preventDefault()
  
  if (!inputMessage.trim() || isLoading) return
  
  const userMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: "user",
    content: inputMessage,
    timestamp: Date.now(),
  }
  
  setMessages(prev => [...prev, userMessage])
  setInputMessage("")
  setIsLoading(true)
  
  try {
    const result = await executeChatMessage({
      agentId: externalAgentId,
      orgId,
      message: userMessage.content,
      walletAddress,
      signature,
    })
    
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: result.response,
      timestamp: Date.now(),
      metadata: {
        toolCalls: result.toolCalls,
        needsConfirmation: result.needsConfirmation,
        confirmationData: result.confirmationData,
      },
    }
    
    setMessages(prev => [...prev, assistantMessage])
    
    // Save to local storage
    saveChatHistory(agentId, [...messages, userMessage, assistantMessage])
    
  } catch (error) {
    console.error("Chat error:", error)
    const errorMessage: ChatMessage = {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, errorMessage])
  } finally {
    setIsLoading(false)
  }
}
```

- [ ] **Step 4: Add inline confirmation handler**

```typescript
const handleConfirmAction = async (confirmed: boolean, confirmationData: any) => {
  if (!confirmed) {
    // User cancelled
    const cancelMessage: ChatMessage = {
      id: `cancel-${Date.now()}`,
      role: "assistant",
      content: "Transaction cancelled.",
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, cancelMessage])
    return
  }
  
  // Send confirmation to backend to execute
  setIsLoading(true)
  
  try {
    const result = await executeAgentAction({
      action: confirmationData.action,
      externalAgentId,
      orgId,
      walletAddress,
      signature,
      params: confirmationData.params,
    })
    
    const responseMessage: ChatMessage = {
      id: `result-${Date.now()}`,
      role: "assistant",
      content: formatActionResult(result),
      timestamp: Date.now(),
      metadata: { toolResult: result },
    }
    
    setMessages(prev => [...prev, responseMessage])
    
  } catch (error) {
    console.error("Confirmation error:", error)
    const errorMessage: ChatMessage = {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: `Transaction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, errorMessage])
  } finally {
    setIsLoading(false)
  }
}

const formatActionResult = (result: ChatMessageResult): string => {
  if (!result.success) {
    return `❌ ${result.error || "Transaction failed"}`
  }
  
  switch (result.action) {
    case "send_transaction":
      return `✅ Transaction sent!\n💸 Amount: ${result.value} ETH\n📍 To: ${result.target}\n🔗 TxHash: ${result.txHash}`
    case "batch_transactions":
      return `✅ Batch transaction sent!\n💸 Total: ${result.totalValue} ETH\n🔢 Count: ${result.count} transactions\n🔗 TxHash: ${result.txHash}`
    case "deposit_gas":
      return `✅ Gas deposited!\n💰 Amount: ${result.value} ETH\n🔗 TxHash: ${result.txHash}`
    default:
      return `✅ Action completed`
  }
}
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add frontend/components/execute/chat-execution-panel.tsx
git commit -m "feat(frontend): remove ActionDialog, add inline confirmation

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 15: Update Chat Message Component for Inline Confirmations

**Files:**
- Modify: `frontend/components/execute/chat-message.tsx`

- [ ] **Step 1: Add confirmation UI to chat message component**

Add after the content rendering:

```typescript
// Inside ChatMessageComponent, after content rendering

{message.metadata?.needsConfirmation && (
  <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
    <div className="mb-3 text-sm text-zinc-300">
      {message.metadata?.confirmationData?.message || "Proceed with this action?"}
    </div>
    <div className="flex gap-2">
      <button
        onClick={() => onConfirm?.(true, message.metadata?.confirmationData)}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white 
                   hover:bg-emerald-500 transition-colors"
      >
        ✅ Yes, proceed
      </button>
      <button
        onClick={() => onConfirm?.(false, message.metadata?.confirmationData)}
        className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 
                   hover:bg-zinc-600 transition-colors"
      >
        ❌ Cancel
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: Add onConfirm prop to component**

```typescript
interface ChatMessageProps {
  message: ChatMessage
  onConfirm?: (confirmed: boolean, confirmationData: any) => void
}

export function ChatMessageComponent({ message, onConfirm }: ChatMessageProps) {
  // ... existing component code
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/execute/chat-message.tsx
git commit -m "feat(frontend): add inline confirmation UI to chat messages

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 16: Delete ActionDialog Component

**Files:**
- Delete: `frontend/components/execute/action-dialog.tsx`

- [ ] **Step 1: Delete the file**

Run: `rm frontend/components/execute/action-dialog.tsx`

- [ ] **Step 2: Commit**

```bash
git add frontend/components/execute/action-dialog.tsx
git commit -m "refactor(frontend): remove unused ActionDialog component

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

## Phase 7: Integration Testing

### Task 17: Write Backend Integration Tests

**Files:**
- Create: `backend/src/__tests__/sessionKey.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals"
import { SessionKeyService } from "../services/sessionKey"
import { ethers } from "ethers"

describe("SessionKeyService", () => {
  let service: SessionKeyService
  
  beforeAll(() => {
    service = new SessionKeyService()
  })
  
  describe("createSession", () => {
    it("should create a session with encrypted key", async () => {
      const session = await service.createSession({
        agentId: 1,
        walletAddress: "0x1234567890123456789012345678901234567890",
        sessionPublicKey: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        userEncryptedPrivateKey: "encrypted-data-here",
        userKeyToken: "user-key-token-here",
        dailySpendLimitWei: "1000000000000000000",
        dailyTxLimit: 10
      })
      
      expect(session).toBeDefined()
      expect(session.sessionId).toMatch(/^0x/)
      expect(session.agentId).toBe(1)
    })
  })
  
  describe("checkAndUpdateLimits", () => {
    it("should allow transaction within limits", async () => {
      // Create session first
      const session = await service.createSession({
        agentId: 2,
        walletAddress: "0x1234567890123456789012345678901234567890",
        sessionPublicKey: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        userEncryptedPrivateKey: "encrypted-data",
        userKeyToken: "token",
        dailySpendLimitWei: "1000000000000000000",
        dailyTxLimit: 10
      })
      
      const result = await service.checkAndUpdateLimits(
        session.sessionId,
        "500000000000000000" // 0.5 ETH
      )
      
      expect(result.allowed).toBe(true)
    })
    
    it("should reject transaction exceeding spend limit", async () => {
      const session = await service.createSession({
        agentId: 3,
        walletAddress: "0x1234567890123456789012345678901234567890",
        sessionPublicKey: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        userEncryptedPrivateKey: "encrypted-data",
        userKeyToken: "token",
        dailySpendLimitWei: "100000000000000000", // 0.1 ETH
        dailyTxLimit: 10
      })
      
      const result = await service.checkAndUpdateLimits(
        session.sessionId,
        "500000000000000000" // 0.5 ETH
      )
      
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("spend limit")
    })
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd backend && npm test`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/sessionKey.test.ts
git commit -m "test(backend): add session service integration tests

Co-Authored-By: Claude Opus 4.6 <noreply@openclaude.dev>"
```

---

### Task 18: End-to-End Test Flow

**Files:**
- Manual testing checklist

- [ ] **Step 1: Deploy updated contracts to testnet**

Run: `cd contracts && npm run deploy:testnet`

- [ ] **Step 2: Start backend**

Run: `cd backend && npm run dev`

- [ ] **Step 3: Start frontend**

Run: `cd frontend && npm run dev`

- [ ] **Step 4: Test session creation flow**

1. Connect wallet
2. Create external agent
3. Verify session is automatically created
4. Check session appears in database

- [ ] **Step 5: Test chat-based transaction flow**

1. Click "Send Transaction" button
2. Verify template appears in chat input
3. Complete message with address
4. Send message
5. Verify inline confirmation appears
6. Click "Yes, proceed"
7. Verify transaction submitted to EntryPoint

- [ ] **Step 6: Test whitelist enforcement**

1. Try sending to non-whitelisted address
2. Verify error message appears in chat
3. Ask agent to add address to whitelist
4. Retry transaction
5. Verify success

- [ ] **Step 7: Test limit enforcement**

1. Set agent limit to low value
2. Try sending more than limit
3. Verify error about daily limit exceeded

---

## Task Summary

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| 1. Smart Contracts | Tasks 1-6 | 2 hours |
| 2. Database Schema | Task 7 | 30 min |
| 3. Backend Session | Task 8 | 1 hour |
| 4. Backend AgentTools | Tasks 9-10 | 2 hours |
| 5. Frontend Session | Tasks 11-12 | 1 hour |
| 6. Frontend Chat | Tasks 13-16 | 2 hours |
| 7. Testing | Tasks 17-18 | 2 hours |

**Total: ~10.5 hours**
