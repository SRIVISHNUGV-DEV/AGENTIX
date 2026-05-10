
# AI Context Memory

> This file stores persistent context across sessions.
> Read this at the start of every session before doing anything else.
> Append to `## Session Log` at the end of each session.

---

## Project Overview

**Name:** Agentix (agent-credentials-mvp)
**Repo:** `D:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp`
**Stack:** Next.js (frontend) + Express/PostgreSQL (backend) + Solidity (contracts) + Circom (ZK circuits)
**Purpose:** Platform for issuing private agent credentials, verifying authorization with ZK proofs, and creating on-chain sessions/wallets.

### Workspaces (npm workspaces)
| Package | Path | Purpose | Depends On |
|---------|------|---------|------------|
| frontend | `frontend/` | Next.js operator UI | SDK, Backend API |
| backend | `backend/` | Express API, SQLite, proof orchestration | Circuits, Contracts |
| contracts | `contracts/` | Solidity protocol + deployment | - |
| circuits | `circuits/` | Circom ZK circuits | - |
| sdk | `sdk/` | Self-hosted integration SDK | Backend API |

### Key Commands
- `npm run dev` — Start full dev environment
- `npm run dev:backend` — Backend only
- `npm run dev:frontend` — Frontend only
- `npm run build` — Build all workspaces
- `npm run test:contracts` — Test contracts

---

## Architecture Flows

### Data Flow: Frontend → SDK → Backend → Database
1. **Frontend** uses **SDK** for API calls
2. **SDK** communicates with **Backend** Express API
3. **Backend** stores data in **SQLite Database**
4. **Backend** orchestrates **ZK Proof Orchestration** using **Circuits**

### ZK Proof Flow: Circuits → Backend → Contracts
1. **Circuits** (Circom) generate ZK proofs
2. **Backend** handles **ZK Proof Orchestration**
3. Proofs are verified on-chain via **Contracts** (Solidity)

### Agent Identity Flow: Contracts ↔ Backend
1. **Contracts** store agent registry with `linked_agent_id`
2. **Backend** syncs contract events (rate-limited for Alchemy free tier)
3. **SQLite Database** caches on-chain state

---

## Session Log

### Session 1 — 2026-05-07
- Created this `AGENTS.md` context-memory file
- Initial project structure: Agentix MVP with 5 npm workspaces (frontend, backend, contracts, circuits, sdk)
- Stack: Next.js / Express+SQLite / Solidity / Circom
- **Establishes:** npm Workspaces Architecture

### Session 3 — 2026-05-10 (Part 1 - Database & Security)
- Migrated database from SQLite to PostgreSQL
  - **Rationale:** Production database needs proper connection pooling, SSL support, and cloud provider compatibility
  - Updated `backend/src/db.ts` to PostgreSQL-only (removed SQLite code)
  - Removed SQLite dependencies from `backend/package.json` (`sqlite`, `sqlite3`)
  - Updated `.env.example` with comprehensive DATABASE_URL configuration
  - Updated `.env` to use PostgreSQL placeholders
  - Created `POSTGRESQL_MIGRATION.md` with setup instructions
  - Added `DB_POOL_SIZE` and `DB_SSL_MODE` configuration options
  - **Cross-ref:** See PostgreSQL configuration in `.env.example`
- Launched background vulnerability monitoring agent
  - **Rationale:** Continuous security scanning for dependencies and code patterns
  - Agent ID: a635be5c5ede24c96 (running in background)
  - **Cross-ref:** Check output file for vulnerability findings

### Session 2 — 2026-05-08
- Rewrote the public `README.md` into a protocol-style Agentix overview and pushed it
  - **Rationale:** README now follows Protocol-Style README Architecture
- Unified the provider/external-agent flow with the core protocol agent model
  - **Cross-ref:** See Provider Fleet Onboarding UI changes
- Added `linked_agent_id` to external agents so connected runtimes map to real protocol identities
  - **Cross-ref:** Contracts workspace, Backend workspace for event sync
- Replaced the broken AI-agents UI with a provider-first fleet onboarding screen backed by `/external`
  - **Cross-ref:** UI Providers implementation
- Redirected the legacy `/external-agents` route to `/ai-agents`
  - **Cross-ref:** Route redirect for migration path
- Removed frontend self-loop config by pointing `frontend/.env.local` back to backend `http://127.0.0.1:3000`
  - **Cross-ref:** Environment Configuration Fixes affect Frontend workspace
- Corrected backend port drift in `backend/.env` from `3001` to `3000`
  - **Cross-ref:** Environment Configuration Fixes affect Backend workspace
- Reduced event sync block range to 10 blocks to stay within Alchemy free-tier `eth_getLogs` limits
  - **Rationale:** Alchemy Free Tier Rate Limits
- Verified locally that backend `/orgs`, frontend `/dashboard`, and frontend `/ai-agents` return HTTP 200
  - **Cross-ref:** Health Check Verification for Backend and Frontend workspaces
