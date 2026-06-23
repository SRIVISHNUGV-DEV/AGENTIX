# AgentIX Frontend Documentation

## Overview

The AgentIX frontend is a Next.js application providing a dashboard for managing agents, sessions, credentials, and external AI integrations.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AGENT_CREDENTIALS_API_URL` | Backend API URL (server-side) | Yes |
| `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL` | Backend API URL (client-side) | Yes |
| `NEXT_PUBLIC_CHAIN_ID` | Blockchain chain ID | Yes |

## Architecture

```
frontend/
├── lib/
│   ├── api-base.ts          # API configuration and auth helpers
│   ├── auth.ts              # Authentication cookie constants
│   ├── auth-server.ts       # Server-side auth utilities
│   ├── session.ts           # Session API client
│   ├── credential-client.ts # Client-side credential generation
│   ├── external-agents-api.ts # External agent management API
│   ├── dashboard-api.ts     # Dashboard data API
│   ├── backend-proxy.ts     # Backend proxy utilities
│   ├── ai-api.ts            # AI API proxy
│   ├── wallet-action.ts     # Wallet transaction helpers
│   ├── signed-actions.ts    # Signed action helpers
│   ├── explorer.ts          # Block explorer utilities
│   ├── org-session.ts       # Organization session management
│   ├── mock-api.ts          # Mock API for development
│   ├── mock-data.ts         # Mock data for development
│   ├── chat-storage.ts      # Chat message storage
│   ├── types.ts             # TypeScript type definitions
│   └── utils.ts             # Utility functions
├── components/              # React components
├── hooks/                   # React hooks
└── types/                   # Additional type definitions
```

## API Modules

### api-base.ts

Core API configuration and authentication helpers.

```typescript
import { BACKEND_API_BASE, API_BASE_URL, getAuthHeaders } from './api-base';

// Backend URL (throws in production if not set)
const apiUrl = BACKEND_API_BASE;

// Auth headers for wallet-signed requests
const headers = getAuthHeaders({
  walletAddress: "0x...",
  signature: "0x...",
  nonce: "...",
  requestedAt: Date.now(),
});
```

### session.ts

Session management API client.

```typescript
import { createSession, getSession, unlockSession, revokeSession } from './lib/session';

// Create a lightweight session
const result = await createSession(agentId, {
  sessionKeyPublic: "0x...",
  dailySpendLimitWei: "1000000000000000000", // 1 ETH
  dailyTxLimit: 10,
  expiresAtSeconds: 86400,
}, auth);

// Get session details
const session = await getSession(agentId, sessionId, auth);

// Unlock session (reveal private key)
const { sessionKeyPrivate } = await unlockSession(agentId, sessionId, auth);

// Revoke session
await revokeSession(agentId, sessionId, auth);
```

### credential-client.ts

Client-side credential generation with encrypted storage.

```typescript
import { generateCredentialSecret, storeCredentialLocally, retrieveStoredCredential } from './lib/credential-client';

// Generate credential (secret never leaves client)
const bundle = await generateCredentialSecret({
  agentId: 1,
  orgId: 1,
  permissions: 255,
  expiry: Math.floor(Date.now() / 1000) + 86400,
});

// Store encrypted in localStorage
await storeCredentialLocally(1, 1, bundle.secret);

// Retrieve stored credential
const stored = await retrieveStoredCredential(1, 1);
```

### external-agents-api.ts

External AI agent management (OpenClaude, LangChain, CrewAI, etc.).

```typescript
import {
  createExternalAgent,
  listExternalAgents,
  provisionAgent,
  executeChatMessage,
} from './lib/external-agents-api';

// Create external agent
const agent = await createExternalAgent({
  orgId: 1,
  agentType: "langchain",
  name: "My Agent",
  endpoint: "https://agent.example.com",
});

// List agents
const agents = await listExternalAgents(1);

// Provision agent (wallet + session)
const result = await provisionAgent(agentId, 1, ownerAddress, {
  dailySpendLimitWei: "1000000000000000000",
  dailyTxLimit: 10,
});

// Execute chat message
const response = await executeChatMessage(agentId, "Hello", 1, signature);
```

### dashboard-api.ts

Dashboard data API with JWT authentication.

```typescript
import { getDashboardStats, getDashboardActions, getDashboardAgents } from './lib/dashboard-api';

// Get dashboard stats
const stats = await getDashboardStats();

// Get recent actions
const actions = await getDashboardActions(50, 0, agentId);

// Get agents
const agents = await getDashboardAgents();
```

## Authentication

### Cookie-Based Auth

The frontend uses JWT tokens stored in cookies:

```typescript
import { AUTH_COOKIE_NAME } from './lib/auth';

// Cookie name: 'ac_session'
// Set by backend on login/register
// Automatically included in requests via dashboardFetch
```

### Wallet-Signed Auth

External agent operations use wallet signatures:

```typescript
import { getAuthHeaders } from './api-base';

const headers = getAuthHeaders({
  walletAddress: wallet.address,
  signature: await wallet.signMessage(nonce),
  nonce: nonce,
  requestedAt: Date.now(),
});
```

## Security Features

### F-009: Encrypted Credentials

Credentials are encrypted with Web Crypto API before localStorage storage:

```typescript
// Encryption key derived per session (non-persistent)
// AES-256-GCM with random IVs
// Key resets on tab close
```

### F-010: Secure Cookies

All auth cookies include:
- `Secure: true` (HTTPS only)
- `SameSite: Strict` (CSRF protection)
- `HttpOnly: true` (no JavaScript access)

### F-016: Precision-Safe Wei Conversion

```typescript
import { ethToWei, weiToEth } from './lib/session';

// String-based conversion (no floating-point precision loss)
const wei = ethToWei("0.1"); // "100000000000000000"
const eth = weiToEth("100000000000000000"); // "0.1"
```

## Development

### Mock API

For development without a backend:

```typescript
import { mockApi } from './lib/mock-api';
```

### Mock Data

Pre-defined test data:

```typescript
import { mockAgents, mockSessions } from './lib/mock-data';
```

### Type Definitions

All types are in `lib/types.ts`:

```typescript
import type { Agent, Session, Credential } from './lib/types';
```

## Production Deployment

### Vercel

1. Push to GitHub
2. Import in Vercel
3. Set environment variables:
   - `AGENT_CREDENTIALS_API_URL`
   - `NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL`
   - `NEXT_PUBLIC_CHAIN_ID`

### Docker

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d frontend
```

## Troubleshooting

### "AGENT_CREDENTIALS_API_URL required in production"

Set the environment variable in your deployment platform.

### "unauthenticated" error

Ensure the user is logged in and the auth cookie is present.

### "Invalid ETH value"

Use string-based wei conversion:
```typescript
// Wrong (precision loss)
BigInt(Math.floor(0.1 * 10 ** 18))

// Correct
ethToWei("0.1")
```

### Session creation fails

Check that:
1. Backend is running
2. User is authenticated
3. Wallet signature is valid
4. Agent exists and is provisioned
