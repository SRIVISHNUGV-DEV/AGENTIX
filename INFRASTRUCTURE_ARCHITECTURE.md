# AGENTIX Infrastructure Architecture
**Version:** 1.0  
**Date:** 2026-05-10  
**Status:** Production Design

---

## System Overview

AGENTIX is a decentralized credential platform with ZK-proof privacy built on the following architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Web App      │  │ Mobile       │  │ SDK Clients  │  │ CLI Tools    │    │
│  │ (Next.js)    │  │ (Future)     │  │              │  │              │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │              │
└─────────┼─────────────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │                 │
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CDN / EDGE LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CloudFlare / AWS CloudFront / Vercel Edge                         │   │
│  │  - SSL Termination     - DDoS Protection    - Static Assets      │   │
│  │  - Geo Distribution    - Edge Caching       - WAF Rules            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                              │                                   
          │                              │                                   
          ▼                              ▼                                   
┌─────────────────────────────┐  ┌─────────────────────────────┐           
│      FRONTEND SERVICE       │  │       API SERVICE          │           
│        (Next.js)            │  │      (Express)             │           
│  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │           
│  │  SSR / SSG Pages    │   │  │  │  REST API Routes    │   │           
│  │  - Dashboard        │   │  │  │  - Auth             │   │           
│  │  - Agent Manager    │   │  │  │  - Credentials      │   │           
│  │  - Wallet Connect   │   │  │  │  - Sessions         │   │           
│  │  - Proofs           │   │  │  │  - Proofs           │   │           
│  └─────────────────────┘   │  │  └─────────────────────┘   │           
│  Port: 3000 (container)   │  │  Port: 3000 (container)   │           
└──────────────┬──────────────┘  └──────────────┬──────────────┘           
               │                                  │                          
               │                                  │                          
               │    ┌─────────────────────────┐   │                          
               │    │      LOAD BALANCER      │   │                          
               │    │     (nginx / ALB)       │   │                          
               │    │  - SSL                  │   │                          
               │    │  - Rate Limiting         │   │                          
               │    │  - Path Routing           │   │                          
               │    └────────┬──────┬──────────┘   │                          
               │             │      │              │                          
               └─────────────┘      └──────────────┘                          
                                      │                                      
                                      ▼                                      
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SERVICES LAYER                                  │
│                                                                             │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────┐   │
│  │   PostgreSQL     │   │     Redis       │   │   ZK Proof Workers      │   │
│  │   Primary DB     │   │    Cache        │   │   (snarkjs/groth16)     │   │
│  │  ┌───────────┐   │   │  ┌───────────┐   │   │  ┌──────────────────┐  │   │
│  │  │ Credentials│   │   │  │ Sessions   │   │   │  │ BullMQ Queue    │  │   │
│  │  │ Orgs       │   │   │  │ Rate Limit │   │   │  │ Worker Pool     │  │   │
│  │  │ Agents     │   │   │  │ Pub/Sub    │   │   │  │ GPU Accelerated │  │   │
│  │  └───────────┘   │   │  └───────────┘   │   │  └──────────────────┘  │   │
│  └────────┬─────────┘   └────────┬────────┘   └─────────────────────────┘   │
│           │                      │                                          │
│           │                      │                                          │
└───────────┼──────────────────────┼──────────────────────────────────────────────┘
            │                      │                                          
            │                      │                                          
            │    ┌──────────────────────────────────────────┐                
            │    │        BLOCKCHAIN LAYER                  │                
            │    │  ┌──────────────┐  ┌───────────────────┐   │                
            │    │  │  RPC Nodes   │  │  Bundler Service  │   │                
            │    │  │  - Alchemy   │  │  (ERC-4337)       │   │                
            │    │  │  - Infura    │  │                   │   │                
            │    │  │  - QuickNode │  │  ┌───────────────┐  │   │                
            │    │  └──────────────┘  │  │ EntryPoint    │  │   │                
            │    │        ▲           │  │ Paymaster     │  │   │                
            │    │        │           │  │ Factory       │  │   │                
            │    │        │           │  └───────────────┘  │   │                
            │    │        │           └─────────────────────┘   │                
            │    │        │                                     │                
            │    │        │         ┌───────────────────────────┘                
            │    │        │         │                                              
            │    │        ▼         ▼                                              
            │    │  ┌──────────────┬─────────────────┐                             
            │    │  │   SEPOLIA TESTNET             │                             
            │    │  │  ┌───────────┬───────────────┐│                             
            │    │  │  │ SessionMgr│ Registry      ││                             
            │    │  │  │ AgentWallet │ Factory       ││                             
            │    │  │  │ Verifier  │               ││                             
            │    │  │  └───────────┴───────────────┘│                             
            │    │  └───────────────────────────────┘                             
            │    │                                                  
            │    │  ┌─────────────────────────────────────────────┐                
            │    │  │   MAINNET/ Production Chains                 │                
            │    │  │  (Base, Arbitrum, Optimism - Future)        │                
            │    │  └─────────────────────────────────────────────┘                
            │    │                                                              
            │    └──────────────────────────────────────────────────────          
            │                                                                     
            │    ┌─────────────────────────────────────────────┐                  
            │    │         MONITORING LAYER                    │                  
            │    │  ┌────────────┐  ┌────────────┐  ┌────────┐ │                  
            │    │  │ CloudWatch │  │ Sentry     │  │Grafana │ │                  
            │    │  │ Logs       │  │ Errors     │  │Metrics │ │                  
            │    │  └────────────┘  └────────────┘  └────────┘ │                  
            │    └─────────────────────────────────────────────┘                  
            │                                                                     
            └────────────────────────────────────────────────────────             
```

---

## Component Details

### 1. Client Layer

**Web Application (Next.js 16)**
- **Role:** User interface for credential management
- **Features:** Dashboard, agent management, wallet connection, proof generation
- **Build Output:** Static + SSR pages
- **Deployment:** Vercel Edge Network

**SDK**
- **Role:** Integration library for external applications
- **Features:** API wrapper, type definitions
- **Distribution:** npm package

---

### 2. CDN / Edge Layer

**CloudFlare / AWS CloudFront**
- SSL/TLS termination
- DDoS protection (CloudFlare) or AWS Shield
- Global edge caching for static assets
- Web Application Firewall (WAF)
- Bot management

---

### 3. Frontend Service

**Next.js Application**
```yaml
Runtime: Node.js 22 Alpine
Port: 3000
Features:
  - SSR for SEO-critical pages
  - SSG for static content
  - React Server Components
  - API routes for server-side logic
  - Image optimization
```

**Key Next.js Configurations:**
- Turbopack enabled for fast builds
- Strict TypeScript mode
- Output file tracing for minimal Docker images

---

### 4. API Service

**Express.js Application**
```yaml
Runtime: Node.js 22 Alpine
Port: 3000
Features:
  - RESTful API endpoints
  - JSON-RPC style endpoints
  - Authentication middleware
  - Rate limiting
  - Security headers (Helmet)
  - Request logging
  - Error handling
```

**API Endpoints:**
```
/auth        - Authentication (login, register, logout)
/orgs        - Organization management
/agents      - Agent CRUD operations
/credentials - Credential issuance/revocation
/sessions    - Session management
/proofs      - ZK proof generation/verification
/blockchain  - Contract interactions
```

---

### 5. Load Balancer (nginx)

**Configuration:**
```
upstream backend { server backend:3000; keepalive 32; }
upstream frontend { server frontend:3000; keepalive 32; }

# API Routes: /api/* → backend
# WebSocket: /socket.io/* → backend
# Static: /* → frontend

Features:
- Rate limiting per IP
- SSL termination
- Request buffering
- Connection pooling
- Health checks
```

---

### 6. PostgreSQL Database

**Configuration:**
```yaml
Version: PostgreSQL 15
Instance: db.t3.micro (upgradable)
Storage: GP2 SSD (Auto-scaling)
Features:
  - Connection pooling (pg-pool)
  - SSL/TLS encryption
  - Automated backups (7-day retention)
  - Point-in-time recovery
  - Multi-AZ for production

Key Tables:
  - organizations
  - agents
  - credentials
  - sessions
  - merkle_tree
  - proofs
```

**Connection Pool:**
- Default size: 10 connections
- Production: 20 connections with pg-pool

---

### 7. Redis Cache

**Configuration:**
```yaml
Instance: cache.t3.micro
Engine: Redis 7.x
Features:
  - Session storage
  - Rate limit counters
  - Proof generation queue
  - Pub/Sub for events
  - Distributed locking

Persistence:
  - RDB snapshots every hour
  - AOF disabled (acceptable for cache)
```

---

### 8. ZK Proof Workers

**Architecture:**
```
┌─────────────────────────────────────┐
│  BullMQ Queue (Redis-backed)        │
│  - proof:generate                   │
│  - credential:issue                 │
│  - session:validate                 │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┬─────────────┐
        ▼             ▼             ▼
   ┌─────────┐ ┌──────────┐ ┌───────────┐
   │ Worker  │ │ Worker   │ │ Worker    │
   │ Pool    │ │ (CPU)    │ │ (GPU)*    │
   └────┬────┘ └────┬─────┘ └─────┬─────┘
        │           │             │
        └───────────┼─────────────┘
                    │
                    ▼
           ┌─────────────┐
           │ snarkjs     │
           │ groth16     │
           │ .wasm, .zkey│
           └─────────────┘

*GPU workers for production scale
```

**Scaling Path:**
1. **Phase 1:** Single threaded (current)
2. **Phase 2:** Worker pool (4-8 workers)
3. **Phase 3:** Dedicated worker containers
4. **Phase 4:** GPU acceleration for high throughput

---

### 9. Blockchain Layer

#### Smart Contracts (Sepolia Testnet)

**SessionManager.sol**
```solidity
- Manages session lifecycle
- Validates ZK proofs
- Tracks nullifiers (replay protection)
- Emits: SessionCreated, SessionExecuted, SessionRevoked
```

**CredentialRegistry.sol**
```solidity
- Stores Merkle root commitments
- Handles credential issuance/revocation
- Integrates with Groth16Verifier
- Emits: CredentialIssued, CredentialRevoked, RootUpdated
```

**AgentWallet.sol (ERC-4337)**
```solidity
- Smart contract wallet
- Session-based execution
- ERC-4337 compliant
- Supports UserOperations via EntryPoint
```

**Groth16Verifier.sol**
```solidity
- Auto-generated by snarkjs
- Verifies ZK proofs on-chain
- Pairing-friendly elliptic curve operations
- Gas-efficient verification (~300k gas)
```

#### ERC-4337 Infrastructure

```
┌─────────────────────────────────────────┐
│              EntryPoint                 │
│  - Standard singleton (0x5FF1...)       │
│  - Coordinates execution                │
└─────────────────┬───────────────────────┘
                  │
           ┌──────┴──────┐
           ▼             ▼
    ┌────────────┐  ┌────────────┐
    │  Bundler   │  │  Paymaster │
    │  (Pimlico/│  │  (Optional)│
    │  Stackup)  │  │            │
    └────────────┘  └────────────┘
```

**Bundler Service:**
- Handles UserOperation bundling
- Pays gas on behalf of wallet
- Validates operations before on-chain submission

---

### 10. Monitoring Layer

**CloudWatch (AWS)**
- Application logs
- Infrastructure metrics
- Database metrics
- Custom business metrics

**Sentry**
- Error tracking
- Performance monitoring
- Session replay (optional)

**Grafana + Prometheus**
- Custom dashboards
- API metrics
- Blockchain metrics
- Alert configuration

---

## Data Flow

### Credential Issuance Flow

```
1. Operator creates agent via Frontend
   └── POST /agents (authenticated)

2. Backend stores agent in PostgreSQL
   └── Record created with agent_id

3. Operator issues credential via Frontend
   └── POST /credentials (authenticated)

4. Backend validates request
   └── Zod validation
   └── Organization check
   └── Duplicate check

5. Backend generates ZK commitment
   └── Poseidon hash of secret + agent_id
   └── Merkle tree update

6. Backend submits to blockchain
   └── CredentialRegistry.issueCredential()
   └── Transaction recorded

7. Backend stores credential proof
   └── merkle_tree table updated
   └── Event emitted

8. User receives credential
   └── Commitment + secret
   └── Can generate nullifier
```

### Session Creation Flow

```
1. Agent requests session via SDK
   └── POST /sessions (with ZK proof)

2. Backend validates ZK proof
   └── Verifies Merkle proof
   └── Checks revocation status

3. Backend validates credential
   └── Proof of credential ownership
   └── Expiry check

4. Backend submits to SessionManager
   └── createSession() transaction

5. Ethereum confirms transaction
   └── Session ID assigned
   └── Nullifier marked used

6. Backend stores session
   └── PostgreSQL session record
   └── Return session details

7. Agent can now execute transactions
   └── Up to maxValue limit
   └── Until expiry
```

### ZK Proof Generation Flow

```
1. Prove credential ownership
   Input: { secret, agentId, pathElements, pathIndices }
   Circuit: credential.circom
   Output: proof, publicSignals (nullifier, commitment, root)

2. Backend generates proof (if caching miss)
   └── snarkjs.groth16.fullProve()
   └── ~2-5 seconds generation time
   └── Cache result in proof_cache

3. Submit proof on-chain
   └── SessionManager.validateSession()
   └── Verifier.verifyProof()
```

---

## Security Architecture

### Authentication Flow

```
┌─────────┐                ┌─────────┐                ┌─────────┐
│ Client  │                │ Backend │                │   DB    │
└────┬────┘                └────┬────┘                └────┬────┘
     │                          │                          │
     │ POST /auth/login         │                          │
     │ {email, password}        │                          │
     │ ────────────────────────>│                          │
     │                          │                          │
     │                          │ bcrypt.compare()         │
     │                          │─────────────────────────>│
     │                          │                          │
     │                          │ generate JWT token         │
     │                          │ {orgId, role, exp}       │
     │                          │                          │
     │ <────────────────────────│ JWT token                │
     │                          │                          │
     │ Subsequent requests      │                          │
     │ Authorization: Bearer    │                          │
     │ ────────────────────────>│                          │
     │                          │ verify JWT               │
     │                          │                          │
     │                          │ Lookup org/agent         │
     │                          │─────────────────────────>│
     │                          │                          │
```

### Rate Limiting Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   nginx     │────▶│   Backend   │────▶│    Redis    │
│ (zone: 10r/s)     │ (memory)    │     │ (distributed)│
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │                   │
   Per-IP limit      Per-user limit
   100 req/15min     100 req/15min
```

### API Security Layers

```
┌─────────────────────────────────────────┐
│ Layer 1: Network (CloudFlare/WAF)        │
│ - DDoS protection                       │
│ - IP reputation                          │
│ - Geographic filtering                   │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Layer 2: SSL/TLS (nginx)                │
│ - Certificate validation               │
│ - Protocol enforcement (TLS 1.2+)      │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Layer 3: Application (Backend)          │
│ - CORS validation                      │
│ - Rate limiting                        │
│ - Input validation                     │
│ - Authentication                       │
│ - Authorization                        │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ Layer 4: Database (PostgreSQL)          │
│ - Parameterized queries               │
│ - Row-level security                   │
│ - Connection limits                    │
└─────────────────────────────────────────┘
```

---

## Scalability Architecture

### Horizontal Scaling

```
                   ┌─────────────┐
                   │  Load       │
                   │  Balancer   │
                   └──────┬──────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │  Backend    │ │  Backend    │ │  Backend    │
   │  Instance 1 │ │  Instance 2 │ │  Instance N │
   │  ┌───────┐  │ │  ┌───────┐  │ │  ┌───────┐  │
   │  │Worker │  │ │  │Worker │  │ │  │Worker │  │
   │  │Thread1│  │ │  │Thread2│  │ │  │ThreadN│  │
   │  └───────┘  │ │  └───────┘  │ │  └───────┘  │
   └──────┬──────┘ └──────┬──────┘ └─────────────┘
          │               │
          └───────────────┘
                          │
                   ┌──────┴──────┐
                   │             │
                   ▼             ▼
           ┌──────────┐  ┌──────────┐
           │PostgreSQL│  │  Redis   │
           │ Primary  │  │ Cluster  │
           │ + Replica│  │          │
           └──────────┘  └──────────┘
```

### Database Scaling Path

```
Phase 1: Single Instance (< 10K agents)
┌─────────────┐
│ PostgreSQL  │
│ Single Node │
└─────────────┘

Phase 2: Read Replica (< 100K agents)
┌─────────────┐     ┌─────────────┐
│ PostgreSQL  │────▶│ PostgreSQL  │
│ Primary     │     │ Read Replica│
└─────────────┘     └─────────────┘

Phase 3: Sharding (> 100K agents)
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Shard 1   │ │ Shard 2   │ │ Shard 3   │
│ Orgs 1-1M │ │ Orgs 1M-2M│ │ Orgs 2M+  │
└───────────┘ └───────────┘ └───────────┘
      │             │             │
      └─────────────┼─────────────┘
                    │
            ┌───────┴───────┐
            │ Proxy Router  │
            └───────────────┘
```

---

## Disaster Recovery

### Backup Strategy

```
┌─────────────────────────────────────────────────┐
│              BACKUP LAYERS                      │
├─────────────────────────────────────────────────┤
│                                                 │
│ Layer 1: Application State                      │
│   - PostgreSQL automated backups (daily)        │
│   - Point-in-time recovery (PITR)              │
│   - 7-day retention                             │
│                                                 │
│ Layer 2: Cache State                            │
│   - Redis RDB snapshots (hourly)               │
│   - Session data (can be regenerated)            │
│                                                 │
│ Layer 3: Blockchain State                       │
│   - Immutable on-chain data                     │
│   - Event logs stored in PostgreSQL             │
│   - Contract addresses in environment           │
│                                                 │
│ Layer 4: Configuration                          │
│   - Git repository (infrastructure as code)     │
│   - Environment variables in secrets manager    │
│   - Docker images in registry                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Recovery Procedures

**Database Recovery:**
```bash
# Restore from backup (30 min RTO)
pg_restore -d agentix agentix-backup.sql

# Point-in-time recovery
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance agentix-prod \
  --target-db-instance agentix-recovery \
  --restore-time "2026-05-10T12:00:00Z"
```

**Contract Recovery:**
- Contract addresses stored in DB
- Immutable state on-chain
- Redeploy only if code compromised
- Re-sync events from blockchain

---

## Network Diagram

```
                                    Internet
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  CloudFlare     │
                              │  CDN / WAF      │
                              └────────┬────────┘
                                       │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
     ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
     │   corvenlabs.org │      │ api.corvenlabs   │      │ ws.corvenlabs    │
     │   (Frontend)     │      │ .org (API)       │      │ .org (WebSocket) │
     └────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘
              │                         │                         │
              │                  ┌────────┴────────┐                │
              │                  │                 │                │
              ▼                  ▼                 ▼                ▼
     ┌──────────────────┐┌──────────────────┐┌──────────────────┐
     │ Next.js          ││ Express          ││ Socket.io        │
     │                    ││                    ││                    │
     └────────┬─────────┘└────────┬─────────┘└────────┬─────────┘
              │                         │                         │
              └─────────────────────────┼─────────────────────────┘
                                       │
                           ┌───────────┴───────────┐
                           │                       │
                           ▼                       ▼
                  ┌──────────────────┐  ┌──────────────────┐
                  │   PostgreSQL     │  │     Redis        │
                  │                  │  │                  │
                  └────────┬─────────┘  └────────┬─────────┘
                           │                       │
                           └───────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  Blockchain      │
                              │  (Sepolia/Base) │
                              │                  │
                              └──────────────────┘
```

---

## Cost Optimization Architecture

### Resource Right-Sizing

```
Current:         Optimized for Launch:
┌───────────┐     ┌───────────┐
│ t3.medium │     │ t3.micro  │
│ (2 vCPU)  │     │ (1 vCPU)  │
│ 4 GB RAM  │     │ 1 GB RAM  │
└───────────┘     └───────────┘
    $30/mo            $8/mo

PostgreSQL:      PostgreSQL (t3.micro):
┌───────────┐     ┌───────────┐
│ db.t3.medium│     │ db.t3.micro│
│ 20 GB      │     │ 20 GB      │
└───────────┘     └───────────┘
   $50/mo            $13/mo

Total: ~$80/mo      Total: ~$25/mo
```

### Reserved Capacity Savings

| Resource | On-Demand | Reserved (1yr) | Savings |
|----------|-----------|----------------|---------|
| EC2 t3.medium | $30/mo | $19/mo | 37% |
| RDS db.t3.medium | $50/mo | $32/mo | 36% |
| ElastiCache t3.micro | $13/mo | $8/mo | 38% |
| **Total** | **$93/mo** | **$59/mo** | **36%** |

### Spot Instances for Worker Pool

```
┌─────────────────────────────────────┐
│      Worker Pool Architecture       │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────┐ ┌──────────────────┐   │
│  │On-Demand │ │   Spot Instances │   │
│  │ 1 core   │ │   0-10 cores     │   │
│  │ $0.041/hr│ │   $0.014/hr      │   │
│  │ (Base)   │ │   (65% off)      │   │
│  └──────────┘ └──────────────────┘   │
│                                     │
│  Use spot for:                      │
│  - Proof generation workers         │
│  - Batch processing                 │
│  - Background jobs                  │
│                                     │
└─────────────────────────────────────┘
```

---

## Migration Strategy

### From SQLite to PostgreSQL (Completed)

```bash
# Migration was successful
# See POSTGRESQL_MIGRATION.md for details
```

### Testnet → Mainnet Migration

```
Phase 1: Deploy to Sepolia (Current)
  ✓ Contracts deployed
  ✓ Relayers configured
  ✓ SDK tested

Phase 2: Deploy to Base Mainnet
  → Update contract addresses
  → Configure mainnet RPC
  → Test with small amounts

Phase 3: Production Launch
  → Monitor closely
  → Gradual user migration
  → Full mainnet operation
```

---

## Appendix: Port Reference

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| Frontend | 3000 | HTTP | Next.js application |
| Backend | 3000 | HTTP | Express API |
| PostgreSQL | 5432 | TCP | Database |
| Redis | 6379 | TCP | Cache |
| nginx | 80 | HTTP | Load balancer |
| nginx | 443 | HTTPS | SSL termination |

## Appendix: File Locations

| Component | Path |
|-----------|------|
| Docker Compose | `docker-compose.yml` |
| Docker Compose Prod | `docker-compose.prod.yml` |
| Backend Dockerfile | `backend/Dockerfile` |
| Frontend Dockerfile | `frontend/Dockerfile` |
| Backend Source | `backend/src/` |
| Frontend Source | `frontend/app/` |
| Contracts | `contracts/src/` |
| Circuits | `circuits/` |
| Nginx Config | `infrastructure/nginx/` (to be created) |
| AWS Terraform | `infrastructure/aws/` (to be created) |
