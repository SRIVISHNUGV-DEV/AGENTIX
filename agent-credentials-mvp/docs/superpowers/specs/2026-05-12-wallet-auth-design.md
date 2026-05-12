# Wallet Authentication for Critical Actions

**Date:** 2026-05-12
**Status:** Approved

## Summary

Add wallet connect to the frontend and use EIP-191 signature-based authentication for all critical platform actions: creating organizations, creating agents, issuing credentials, and revoking credentials.

## Architecture

### Components

1. **`useWalletAction()` hook** — Wraps API calls with automatic signature generation
2. **`requireSignedAction()` middleware** — Validates signatures on backend (already exists)
3. **Prominent wallet connect UI** — Displayed in header/nav across all pages
4. **Auto-link on org creation** — Connected wallet becomes `owner_wallet_address`

### Signature Flow

```
User clicks action
       ↓
useWalletAction() validates wallet connected + on Sepolia
       ↓
signPlatformAction() generates EIP-191 signature
       ↓
Signature injected into API request body
       ↓
Backend requireSignedAction() validates:
  - Signature is valid
  - Signer matches org.owner_wallet_address
  - Nonce is unique
  - Timestamp is recent (< 5 min)
       ↓
Action executes
```

### Actions Requiring Signatures

| Action | Endpoint | Target Format |
|--------|----------|---------------|
| Create Organization | `POST /orgs` | `org:new` |
| Create Agent | `POST /agents` | `agent:new` |
| Issue Credential | `POST /agents/:id/credentials/issue` | `agent:{id}` |
| Revoke Credential | `POST /agents/:id/revoke` | `agent:{id}` |
| Deploy Contracts | `POST /orgs/:id/deploy` | `org:{id}` |
| Fund Organization | `POST /orgs/:id/fund` | `org:{id}` |
| Delete Organization | `DELETE /orgs/:id` | `org:{id}` |

## Implementation Plan

### Phase 1: Shared Wallet Action Hook
- Create `useWalletAction()` hook in `frontend/lib/wallet-action.ts`
- Hook handles: connect check, Sepolia check, signature generation, error handling
- Returns `executeAction()` function that wraps any API call

### Phase 2: Prominent Wallet Connect UI
- Add `ConnectWalletButton` to main dashboard header
- Add to agents page header
- Add to agent detail page header
- Show connection status and network indicator

### Phase 3: Organization Creation with Auto-Link
- Create `POST /api/platform/orgs` route that requires wallet signature
- Backend creates org with `owner_wallet_address` from signature
- Frontend org creation flow uses `useWalletAction()`

### Phase 4: Agent Creation with Signature
- Update `POST /api/platform/agents` route to require signature
- Frontend agent creation uses `useWalletAction()`
- Signature validates signer owns the org

### Phase 5: Credential Operations with Signature
- Update credential issue route to use `useWalletAction()`
- Update credential revoke route to use `useWalletAction()`
- Already partially implemented in backend

## Database Changes

No schema changes required. The `organizations.owner_wallet_address` column already exists.

## Security Considerations

- Signatures expire after 5 minutes
- Nonces are single-use (tracked in `used_nonces` table - need to add)
- Signature includes chain ID (Sepolia: 11155111) to prevent replay attacks
- Signer must match `owner_wallet_address` of the organization
