# AGENTIX Scalability Assessment
**Date:** 2026-05-10  
**Version:** 1.0

---

## Executive Summary

| Scale Target | Status | Bottlenecks | Timeline |
|--------------|--------|-------------|----------|
| **1,000 Agents** | ✅ Ready | None | Immediate |
| **10,000 Agents** | ✅ Ready | Rate limiting needs tuning | 1 month |
| **100,000 Agents** | ⚠️ Needs work | Proof generation, DB reads | 3-6 months |
| **1,000,000+ Agents** | ❌ Not ready | All systems require scaling | 6-12 months |

**Current Production Capacity: ~5,000 agents**
**Achievable with incremental improvements: 50,000 agents**

---

## 1. Current System Baseline

### Resource Specifications

| Component | Current | Per-Request |
|-----------|---------|-------------|
| Backend | 1 vCPU, 0.5 GB | 5-20ms API response |
| PostgreSQL | 10 connections | 5-50ms queries |
| Redis | Single instance | 1-5ms operations |
| Proof Generation | Synchronous | 2-5 seconds |
| Contract Calls | Sequential | 10-30 seconds |

### Performance Metrics

| Operation | Latency | Throughput |
|-----------|---------|------------|
| Login / Auth | 50ms | 50 req/s |
| Create Agent | 100ms | 20 req/s |
| Issue Credential | 200ms | 10 req/s |
| Generate Proof | 3s | 0.3 req/s |
| Create Session | 5s (incl blockchain) | 0.2 req/s |
| Execute Session | 1s | 1 req/s |

---

## 2. Scalability by Component

### 2.1 Database (PostgreSQL)

#### Current State
```
Connection Pool: 10 max
Query Performance: Good
Write Volume: Low (100s/day)
Read Volume: Medium (1000s/day)
```

#### Scaling Analysis

| Scale | Connections Needed | Storage Growth | Action Required |
|-------|-------------------|----------------|-----------------|
| 1K agents | 10 | 186 MB/month | None ✅ |
| 10K agents | 20 | 1.9 GB/month | Increase pool ⚠️ |
| 100K agents | 50 | 19 GB/month | Read replica ⚠️ |
| 1M agents | 200 | 190 GB/month | Sharding ❌ |

#### Bottlenecks Identified

1. **Single Connection Pool**
   - **Issue:** All requests share 10 connections
   - **Impact:** High concurrency causes queuing
   - **Fix:** Increase to 20, add queuing

2. **Sequential Writes to merkle_tree table**
   - **Issue:** Credential issuance requires O(log n) writes
   - **Impact:** 20 writes per credential at depth 20
   - **Fix:** Batch tree updates (currently done one-by-one)

3. **No Read Replica**
   - **Issue:** Proof generation reads directly from primary
   - **Impact:** Competes with writes
   - **Fix:** Add read replica for proof queries

#### Scaling Path (Database)

```
Phase 1: Current (< 5K agents)
┌────────────────────────────────┐
│ PostgreSQL Primary             │
│ - 10 connection pool          │
│ - Single AZ                   │
└────────────────────────────────┘

Phase 2: Connection Pool (< 20K agents)
┌────────────────────────────────┐
│ PostgreSQL Primary             │
│ - 50 connection pool            │
│ - Connection pooling (pg-pool)  │
│ - Query optimization            │
└────────────────────────────────┘

Phase 3: Read Replica (< 100K agents)
┌──────────────────┐  ┌──────────────────┐
│     Primary      │─▶│  Read Replica    │
│  - Writes        │  │  - Proof queries │
│  - Auth          │  │  - Analytics     │
└──────────────────┘  └──────────────────┘

Phase 4: Sharding (> 100K agents)
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Shard 1 │ │ Shard 2 │ │ Shard 3 │
│(1-100K) │ │(100K+)│ │ (etc)   │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     └───────────┼───────────┘
                 │
        ┌────────┴────────┐
        │  Proxy Router   │
        │ (Sharding Logic)│
        └─────────────────┘
```

### 2.2 ZK Proof Generation

#### Current State
```
Mode: Synchronous, Single-threaded
Time per proof: 2-5 seconds
Throughput: 0.3 proofs/second
Resource: CPU bound (not parallelized)
```

#### Proof Generation Bottleneck (Critical)

**At current rate:**
- 10 agents creating sessions = 30 seconds of proof generation
- 100 agents = 5 minutes (queue builds up)
- 1,000 agents = **50 minutes** (system collapses)

#### Scaling Analysis

| Scale | Proofs/Day | CPU Cores | Time/Agent | Action Required |
|-------|------------|-----------|------------|-----------------|
| 1K | 1,000 | 2 | 5s | Tolerable ✅ |
| 10K | 10,000 | 8 | 10s | Queue needed ⚠️ |
| 100K | 100,000 | 40 | 20s | GPU workers ⚠️ |
| 1M | 1,000,000 | 400+ | - | GPU farm ❌ |

#### Scaling Path (Proof Generation)

```
Phase 1: Synchronous (Current, < 1K agents)
┌─────────────────────────┐
│ Request → Generate Proof│
│         ↓               │
│      Response           │
│ (Blocks for 2-5s)       │
└─────────────────────────┘

Phase 2: Async Queue (< 10K agents)
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Submit  │──▶│  BullMQ  │──▶│  Worker   │
│  Job     │    │  Queue   │    │  Process │
└──────────┘    └──────────┘    └──────────┘
     │                                  │
     │  WebSocket                       │
     │  Notification                    │
     ▼                                  ▼
┌──────────┐                    ┌──────────┐
│  Result  │◀──────────────────│  Store   │
│  Ready   │                    │  Proof   │
└──────────┘                    └──────────┘

Phase 3: Worker Pool (< 100K agents)
┌─────────────────────────────────────────┐
│           Worker Pool (8-16 workers)    │
│  ┌───────┐ ┌───────┐ ┌───────┐         │
│  │   1   │ │   2   │ │   N   │ ...     │
│  └───────┘ └───────┘ └───────┘         │
│       Parallel proof generation          │
│       Throughput: 2-5 proofs/sec         │
└─────────────────────────────────────────┘

Phase 4: GPU Workers (< 1M agents)
┌─────────────────────────────────────────┐
│       GPU Worker Pool (g4dn.xlarge)     │
│  ┌─────────────────────────────────┐    │
│  │  NVIDIA T4 GPU                │    │
│  │  Throughput: 50+ proofs/sec   │    │
│  │  Cost: $0.50/hr (spot)        │    │
│  └─────────────────────────────────┘    │
│         Multiple GPU instances          │
└─────────────────────────────────────────┘

Phase 5: Proof Aggregation (1M+ agents)
┌─────────────────────────────────────────┐
│      Aggregate Multiple Proofs           │
│                                          │
│  Proof 1 + Proof 2 + ... + Proof N      │
│              ↓                          │
│       Single aggregated proof           │
│       Verify N proofs in O(1)           │
└─────────────────────────────────────────┘
```

### 2.3 Blockchain Interaction

#### Current State
```
Provider: Single RPC (Alchemy)
Call Pattern: Sequential
Confirmation: Wait for 1 block
Timeout: 60 seconds
```

#### Scaling Analysis

| Scale | Daily Transactions | RPC Requests | Issues |
|-------|-------------------|--------------|--------|
| 1K | 1,000 | 10,000 | None ✅ |
| 10K | 10,000 | 100,000 | Rate limit ⚠️ |
| 100K | 100,000 | 1M | Need fallback ❌ |
| 1M | 1M | 10M | Enterprise plan ❌ |

#### RPC Provider Limits

| Provider | Free Tier | Paid Tier | Recommendation |
|----------|-----------|-----------|----------------|
| Alchemy | 300M CUs/mo | Unlimited | Primary |
| Infura | 100K req/day | Custom | Fallback |
| QuickNode | Limited | Unlimited | Backup |
| Cloudflare | 100K req/day | Free | 3rd choice |

#### Scaling Path (Blockchain)

```
Phase 1: Single Provider (< 5K agents)
┌──────────────────┐
│ Alchemy Primary  │
└──────────────────┘

Phase 2: Fallback Provider (< 50K agents)
┌──────────────────┐    ┌──────────────────┐
│ Alchemy Primary  │──▶│ Infura Fallback  │
│                  │    │ On failure      │
└──────────────────┘    └──────────────────┘

Phase 3: Multi-RPC (< 500K agents)
┌─────────────────────────────────────────┐
│         FallbackProvider                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Alchemy │ │ Infura  │ │QuickNode│   │
│  │ 50%    │ │ 30%    │ │ 20%    │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘

Phase 4: Enterprise (< 5M agents)
┌─────────────────────────────────────────┐
│     Custom RPC Infrastructure             │
│  - Dedicated nodes                    │
│  - Private mempool                    │
│  - Priority gas pricing               │
└─────────────────────────────────────────┘
```

### 2.4 API/Backend

#### Current State
```
Framework: Express.js
Mode: Single instance
Rate Limit: 100 req/15min (memory)
Success Rate: ~99.9%
```

#### Scaling Analysis

| Scale | Concurrent Users | Requests/Min | Action Required |
|-------|-----------------|--------------|-----------------|
| 1K | 10 | 100 | Current ✅ |
| 10K | 100 | 1,000 | Multi-instance ⚠️ |
| 100K | 1,000 | 10,000 | Load balancer ⚠️ |
| 1M | 10,000 | 100,000 | Auto-scaling ❌ |

#### Scaling Path (Backend)

```
Phase 1: Single Instance (< 5K agents)
┌──────────────────┐
│ Express Server   │
│ t3.micro         │
│ Single process   │
└──────────────────┘

Phase 2: Process Cluster (< 20K agents)
┌──────────────────────────────┐
│  PM2 Cluster Mode            │
│  4 worker processes          │
│  Shared port 3000            │
└──────────────────────────────┘

Phase 3: Multi-Instance (< 100K agents)
         ┌───────────┐
         │   LB      │
         └───┬───┬───┘
             │   │
      ┌──────┘   └──────┐
      ▼                 ▼
┌──────────┐      ┌──────────┐
│ Backend  │      │ Backend  │
│   #1     │      │   #2     │
└──────────┘      └──────────┘

Phase 4: Auto-scaling (< 1M agents)
┌─────────────────────────────────────────┐
│         ECS/Kubernetes                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│  │ Pod │ │ Pod │ │ Pod │ │ Pod │ ... │
│  └─────┘ └─────┘ └─────┘ └─────┘     │
│  Auto-scale: CPU > 70%              │
│  Min: 2, Max: 20                      │
└─────────────────────────────────────────┘
```

### 2.5 Merkle Tree Operations

#### Current State
```
Structure: Incremental Merkle Tree
Depth: 20 (1M leaves capacity)
Update: Synchronous, per-credential
Storage: PostgreSQL merkle_tree table
```

#### Scaling Analysis

| Scale | Tree Size | Update Time | Memory |
|-------|-----------|-------------|--------|
| 1K | 1,024 nodes | ~5ms | ~128 KB |
| 10K | 10,240 nodes | ~10ms | ~1.2 MB |
| 100K | 100,000 nodes | ~50ms | ~12 MB |
| 1M | 1,000,000 nodes | ~200ms | ~128 MB |

#### Bottlenecks

1. **Sequential Tree Updates**
   - Each credential requires O(log n) = 20 DB writes
   - At 1,000 credentials/day = 20,000 writes
   - Can become bottleneck

2. **Tree Rebuilding**
   - `rebuildFromCredentials()` loads entire tree
   - O(n log n) operation
   - Blocks during rebuild

#### Optimization Strategies

```typescript
// Strategy 1: Batch Tree Updates
async function batchUpdateTree(updates: CredentialUpdate[]) {
  const batch = await db.beginTransaction();
  try {
    for (const update of updates) {
      await tree.insertAt(batch, update.index, update.commitment);
    }
    await batch.commit();
  } catch (e) {
    await batch.rollback();
    throw e;
  }
}

// Strategy 2: Lazy Tree Rebuild
class IncrementalMerkleTree {
  private dirtyNodes: Set<string> = new Set();
  
  markDirty(level: number, index: number) {
    this.dirtyNodes.add(`${level}:${index}`);
  }
  
  async rebuildDirtyOnly(db: any) {
    // Only rebuild changed nodes
    for (const key of this.dirtyNodes) {
      const [level, index] = key.split(':');
      await this.rebuildNode(db, parseInt(level), parseInt(index));
    }
    this.dirtyNodes.clear();
  }
}

// Strategy 3: Tree Sharding
class ShardedMerkleTree {
  private trees: Map<number, IncrementalMerkleTree> = new Map();
  
  getTree(orgId: number) {
    if (!this.trees.has(orgId)) {
      this.trees.set(orgId, new IncrementalMerkleTree(20, { orgId }));
    }
    return this.trees.get(orgId)!;
  }
}
```

### 2.6 Event Synchronization

#### Current State
```
Source: Alchemy eth_getLogs
Block Range: 10 blocks (rate limit compliance)
Frequency: Every 5 seconds
Storage: PostgreSQL
```

#### Scaling Analysis

| Scale | Events/Day | Processing Time | RPC Cost |
|-------|-----------|-----------------|----------|
| 1K | 100 | ~1s | Free ✅ |
| 10K | 1,000 | ~10s | Free ✅ |
| 100K | 10,000 | ~2min | ~$50/mo ⚠️ |
| 1M | 100,000 | ~20min | ~$500/mo ❌ |

#### Optimization Strategies

```typescript
// Strategy 1: Batch Event Processing
async function syncEventsBatched(fromBlock: number, toBlock: number) {
  const batchSize = 100; // Process 100 blocks at a time
  
  for (let start = fromBlock; start < toBlock; start += batchSize) {
    const end = Math.min(start + batchSize, toBlock);
    const events = await fetchLogs(start, end);
    await processEvents(events);
  }
}

// Strategy 2: Event Stream (Alchemy WebSocket)
const ws = new WebSocket('wss://eth-sepolia.ws.alchemy.com/v2/key');
ws.on('message', (data) => {
  // Real-time event handling
  processEventRealTime(JSON.parse(data));
});

// Strategy 3: Skip Blocks Without Events
async function syncWithExclusion(fromBlock: number, toBlock: number) {
  const blocksWithEvents = await getActiveBlocks(fromBlock, toBlock);
  // Only query blocks that have events
  for (const block of blocksWithEvents) {
    const events = await fetchLogs(block, block);
    await processEvents(events);
  }
}
```

---

## 3. Scalability Bottlenecks Summary

| Component | Current Limit | Breaking Point | Mitigation |
|-----------|---------------|------------------|------------|
| Proof Generation | 0.3 req/s | 1,000 agents/day | Async queue + GPU |
| Database Writes | 50 TPS | 10K credentials/day | Batch + sharding |
| API Requests | ~100 req/s | 10K users | Horizontal scaling |
| RPC Calls | 300M CUs/mo | 50K agents/mo | Fallback providers |
| Merkle Updates | 200 writes/s | 10K credentials/day | Batch updates |
| Event Sync | 10K events/day | 100K agents | Stream processing |

---

## 4. Load Testing Recommendations

### Test Scenarios

```yaml
Load Test 1: Concurrent Users
- Target: 100 simultaneous users
- Duration: 10 minutes
- Endpoints: /agents, /credentials, /sessions
- Expected: 95% < 500ms response time

Load Test 2: Proof Generation
- Target: 10 concurrent proof requests
- Duration: 30 minutes
- Expected: All complete within 60 seconds

Load Test 3: Database Stress
- Target: 1000 concurrent reads/writes
- Duration: 10 minutes
- Expected: No connection pool exhaustion

Load Test 4: WebSocket Connections
- Target: 100 concurrent WebSocket
- Duration: 30 minutes
- Expected: Stable connections
```

### Tools

- **k6**: Open-source load testing
- **Artillery**: Node.js load testing
- **Locust**: Python-based, programmable
- **JMeter**: Java-based, comprehensive

---

## 5. Monitoring for Scale

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Response Time | < 200ms | > 500ms |
| Database Query Time | < 50ms | > 200ms |
| Proof Queue Depth | < 10 | > 50 |
| RPC Error Rate | < 1% | > 5% |
| Memory Usage | < 70% | > 85% |
| CPU Usage | < 70% | > 85% |

### Dashboard Queries

```sql
-- Proof generation rate
SELECT DATE_TRUNC('hour', created_at) as hour,
       COUNT(*) as proofs_generated
FROM proofs
GROUP BY hour
ORDER BY hour DESC;

-- Database connection usage
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';

-- Queue depth (if using BullMQ)
-- (Via Redis: LLEN bull:proof:queue)
```

---

## 6. Scaling Decision Tree

```
Agent Count < 1,000?
├─ YES → Current setup is fine ✅
└─ NO → Continue

Agent Count < 10,000?
├─ YES → Implement:
│        ├─ Async proof queue
│        ├─ Rate limiting (Redis)
│        └─ DB connection pool increase
└─ NO → Continue

Agent Count < 100,000?
├─ YES → Implement:
│        ├─ Load balancer (nginx)
│        ├─ DB read replica
│        ├─ Worker pool (4-8 workers)
│        └─ Multi-RPC fallback
└─ NO → Continue

Agent Count > 100,000?
└─ YES → Implement:
         ├─ Database sharding
         ├─ GPU proof workers
         ├─ Kubernetes auto-scaling
         ├─ Proof aggregation
         └─ Enterprise RPC
```

---

## 7. Scalability Roadmap

### Immediate (Week 1-2)
- [ ] Add async proof queue (BullMQ)
- [ ] Increase DB pool size to 20
- [ ] Add Redis for distributed rate limiting

### Short-term (Month 1-2)
- [ ] Implement proof worker pool (4 workers)
- [ ] Add database read replica
- [ ] Configure fallback RPC providers
- [ ] Add batch tree updates

### Medium-term (Month 3-6)
- [ ] GPU worker implementation
- [ ] Horizontal scaling (multi-instance)
- [ ] Kubernetes deployment
- [ ] Event stream processing

### Long-term (Month 6-12)
- [ ] Database sharding by org_id
- [ ] Proof aggregation protocol
- [ ] Multi-region deployment
- [ ] Edge proof generation

---

## 8. Conclusion

**Current scalable to: ~5,000 agents**
**With Phase 1 improvements: ~50,000 agents**
**Full Phase 4 implementation: 1M+ agents**

**Priority order:**
1. **Critical:** Async proof generation (blocks all scale)
2. **High:** Database read replica
3. **Medium:** Worker pool + fallback RPC
4. **Low:** Advanced optimizations

**Recommended immediate action:**
- Implement async proof queue (BullMQ)
- Increase DB pool size
- Add basic monitoring

This will give you runway to 10,000+ agents without architectural changes.
