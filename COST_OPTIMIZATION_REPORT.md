# AGENTIX Cost Optimization Report
**Date:** 2026-05-10  
**Version:** 1.0

---

## Executive Summary

| Metric | Current | Optimized | Savings |
|--------|---------|-----------|---------|
| Monthly Cost | ~$500/mo | ~$150/mo | 70% |
| Year 1 Cost | $6,000 | $1,800 | $4,200 |
| Proof Cost | ~$0.05/proof | ~$0.02/proof | 60% |
| **With Reserved Capacity** | $6,000 | **$1,150** | **$4,850** |

**Recommendation:** Start with optimized tier, migrate to reserved capacity after 3 months of stable usage.

---

## 1. Current Cost Structure

### Development/Testing Environment Estimate

| Service | Instance | Monthly Cost |
|---------|----------|------------|
| EC2 (Backend) | t3.medium | $30 |
| EC2 (Frontend) | t3.small | $15 |
| RDS PostgreSQL | db.t3.medium | $50 |
| ElastiCache Redis | cache.t3.micro | $13 |
| ALB Load Balancer | - | $16 |
| Data Transfer | ~100 GB | $9 |
| CloudWatch Logs | ~10 GB | $5 |
| **Total** | | **~$138/mo** |

### Production Environment Estimate

| Service | Instance | Monthly Cost |
|---------|----------|------------|
| EC2 (Backend x2) | t3.medium | $60 |
| ECS (Frontend) | Fargate | $25 |
| RDS PostgreSQL | db.t3.medium | $50 |
| RDS Multi-AZ | - | +$50 |
| ElastiCache Redis | cache.t3.small | $25 |
| ALB/NLB | - | $22 |
| S3 (builds/logs) | 50 GB | $1 |
| Data Transfer | 500 GB | $45 |
| CloudWatch | Detailed | $20 |
| Route 53 | DNS | $1 |
| **Total** | | **~$350/mo** |

---

## 2. Optimized Production Configuration

### Phase 1: Launch Optimized (0-1K users)

| Service | Instance | Monthly Cost | Notes |
|---------|----------|--------------|-------|
| Backend | t3.micro (1) | $8 | Single instance |
| RDS | db.t3.micro | $13 | Single-AZ |
| Redis | cache.t3.micro | $13 | Session cache |
| Load Balancer | nginx (EC2) | $0 | Included |
| Domain | Route 53 | $1 | DNS |
| SSL | Let's Encrypt | $0 | Free |
| **Total** | | **~$35/mo** | |

### Phase 2: Growth Optimized (1K-10K users)

| Service | Instance | Monthly Cost | Notes |
|---------|----------|--------------|-------|
| Backend | t3.small (2) | $30 | HA pair |
| RDS | db.t3.small | $25 | Single-AZ |
| Redis | cache.t3.micro | $13 | No change |
| ALB | Application LB | $16 | AWS load balancer |
| Data Transfer | 100 GB | $9 | |
| **Total** | | **~$93/mo** | |

### Phase 3: Scale Optimized (10K-100K users)

| Service | Instance | Monthly Cost | Notes |
|---------|----------|--------------|-------|
| Backend | t3.medium (2) | $60 | HA with auto-scaling |
| RDS | db.t3.medium + replica | $100 | Read replica |
| Redis | cache.t3.small (cluster) | $50 | Cluster mode |
| ALB | Application LB | $22 | |
| Data Transfer | 500 GB | $45 | |
| CloudWatch | Detailed | $20 | |
| **Total** | | **~$297/mo** | |

---

## 3. Reserved Capacity Savings

### 1-Year Reserved Instances (No Upfront)

| Instance Type | On-Demand | Reserved | Savings |
|---------------|-----------|----------|---------|
| t3.micro | $8/mo | $5/mo | 37% |
| t3.small | $15/mo | $9/mo | 40% |
| t3.medium | $30/mo | $19/mo | 37% |
| db.t3.micro | $13/mo | $8/mo | 38% |
| db.t3.small | $25/mo | $16/mo | 36% |
| db.t3.medium | $50/mo | $32/mo | 36% |
| cache.t3.micro | $13/mo | $8/mo | 38% |
| cache.t3.small | $25/mo | $16/mo | 36% |

**Example Reserved Capacity Package (Phase 2):**
```
Backend:      2 × t3.small reserved    = $18/mo (was $30)
RDS:          1 × db.t3.small reserved = $16/mo (was $25)
Redis:        1 × cache.t3.micro       = $8/mo (was $13)
ALB:          On-demand                = $16/mo
Data:         Estimated              = $9/mo
─────────────────────────────────────────────
Total:        $67/mo vs $93/mo
Savings:      28%
```

### 3-Year Reserved (Maximum Savings)

| Instance Type | On-Demand | 3-Year Reserved | Savings |
|---------------|-----------|-----------------|---------|
| t3.micro | $8/mo | $3/mo | 62% |
| db.t3.micro | $13/mo | $5/mo | 62% |
| db.t3.medium | $50/mo | $17/mo | 66% |

**Only commit to 3-year if:**
- Confirmed stable workload
- Application is proven
- No major architecture changes planned

---

## 4. Blockchain Cost Optimization

### RPC Provider Strategy

| Provider | Free Tier | Paid ($50-200/mo) | Recommendation |
|------------|-----------|-------------------|----------------|
| Alchemy | 300M CUs | Unlimited | Primary (paid) |
| Infura | 100,000 requests | Higher limits | Fallback (paid) |
| QuickNode | Limited | Unlimited | Backup |
| Cloudflare | 100,000 req/day | Free | Cost-effective |

**Optimized setup:**
- Primary: Alchemy (free tier initially)
- Fallback: Cloudflare (free)
- Rate limit: 100k requests/day = ~0.15 ETH/month saved

### Gas Optimization

| Operation | Current Gas | Optimized Gas | Savings |
|-----------|-------------|---------------|---------|
| Credential Issue | ~150k | ~120k | 20% |
| Session Create | ~200k | ~180k | 10% |
| Session Execute | ~80k | ~70k | 12% |
| Proof Verification | ~300k | ~300k | 0% (fixed) |

**Gas Optimization Strategies:**
```solidity
// 1. Pack structs
struct Session {
    uint64 expiry;      // 8 bytes
    uint128 maxValue;   // 16 bytes
    bool revoked;       // 1 byte (packed)
    address signer;     // 20 bytes
}

// 2. Use events over storage
emit SessionCreated(id, session); // cheaper than storing details

// 3. Batch operations
function batchCreateSessions(...) external {
    for (uint i = 0; i < sessions.length; i++) {
        _createSession(sessions[i]); // single SSTORE
    }
}

// 4. Pre-compute nullifier commitments
// Store hash on-chain, verify off-chain
```

### Sepolia vs Mainnet Cost

| Network | Gas Price | Credential Issue | Session Create | Monthly Ops |
|---------|-----------|------------------|----------------|-------------|
| Sepolia | ~10 gwei | ~$0.50 | ~$0.70 | ~$30 |
| Base Mainnet | ~0.1 gwei | ~$0.05 | ~$0.07 | ~$3 |
| Ethereum | ~15 gwei | ~$7.50 | ~$10 | ~$400 |

**Recommendation:** Launch on Base Mainnet for cost efficiency.

---

## 5. Proof Generation Cost

### Compute Requirements

| Proof Type | Time | CPU | Memory | Cost |
|------------|------|-----|--------|------|
| Credential Ownership | 2-3s | 100% | 200MB | ~$0.01 |
| Session Validation | 1-2s | 100% | 150MB | ~$0.005 |
| Merkle Update | 0.5s | 50% | 100MB | ~$0.002 |

### Proof Generation Scaling Cost

| Agents | Proofs/Day | Compute | Monthly |
|--------|------------|---------|---------|
| 100 | 100 | 1 vCPU | $10 |
| 1,000 | 1,000 | 2 vCPU | $20 |
| 10,000 | 10,000 | 8 vCPU | $80 |
| 100,000 | 100,000 | 40 vCPU + GPU | $400 |

### GPU Acceleration

| Worker Type | Proofs/Hour | Cost/Hour | Cost/Proof |
|-------------|-------------|-----------|------------|
| CPU (t3.medium) | 720 | $0.04 | $0.056 |
| GPU (g4dn.xlarge) | 7,200 | $0.50 | $0.007 |
| **Savings** | | | **87%** |

**Recommendation:** Implement GPU workers for > 10K agents.

---

## 6. Storage Cost Optimization

### Database Growth Projections

| Tables | 1K Agents | 10K Agents | 100K Agents |
|--------|-----------|------------|-------------|
| organizations | ~1 MB | ~2 MB | ~5 MB |
| agents | ~10 MB | ~100 MB | ~1 GB |
| credentials | ~50 MB | ~500 MB | ~5 GB |
| sessions | ~20 MB | ~200 MB | ~2 GB |
| merkle_tree | ~100 MB | ~1 GB | ~10 GB |
| proofs | ~5 MB | ~50 MB | ~500 MB |
| **Total** | **~186 MB** | **~1.9 GB** | **~19 GB** |

### Storage Optimization

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| Proof compression | 50% | Store minimally in DB |
| Event pruning | 30% | Archive old events |
| Merkle tree compression | 40% | Batch node storage |
| **Total** | **40%** | |

### S3 Storage for Backups

| Tier | Cost/GB | Usage | Monthly |
|------|---------|-------|---------|
| Standard | $0.023 | Active backups | $2 |
| Glacier | $0.004 | Archive (90+ days) | $0.50 |
| Deep Archive | $0.00099 | Archive (180+ days) | $0.12 |

---

## 7. Data Transfer Optimization

### Current vs Optimized

| Source | Current | Optimized | Monthly |
|--------|---------|-----------|---------|
| Browser → CDN | ~100 GB | ~50 GB (cache) | $4.50 → $2.25 |
| API → Client | ~50 GB | ~30 GB (gzip) | $4.50 → $2.70 |
| AWS internal | ~200 GB | ~100 GB (regional) | $0 → $0 |
| **Total** | ~350 GB | ~180 GB | **$9 → $5** |

### Data Transfer Strategies

1. **Enable Compression**
```nginx
gzip on;
gzip_types application/json text/css application/javascript;
gzip_min_length 1000;
```

2. **Use CloudFlare (Free)**
   - 200+ edge locations
   - Free SSL and DDoS
   - Caches static assets

3. **Regional Deployment**
   - US-East-1 (primary)
   - EU-West-1 (EU users)
   - No cross-region data transfer

---

## 8. Monitoring Cost Optimization

### CloudWatch Costs

| Metric | Standard | Detailed | Cost/Day |
|--------|----------|----------|----------|
| Basic | 5 min | - | $0 |
| Detailed | - | 1 min | ~$5 |
| Custom | - | - | ~$0.50/1000 metrics |

**Optimized Configuration:**
```
Basic metrics: FREE
Custom metrics: 100/month = $5
Log ingestion: 1 GB/day = $20
Dashboard: $3/custom dashboard
Alarms: $0.10/alarm/mo (10 alarms = $1)
─────────────────────────────────────
Total: ~$29/mo
```

### Sentry Cost

| Tier | Cost | Events |
|------|------|--------|
| Free | $0 | 5,000/mo |
| Team | $26/mo | 50k/mo |
| Business | $80/mo | 100k/mo |

**Recommendation:** Start with free tier, upgrade only if needed.

---

## 9. Room for Improvement

### High-Impact Optimizations

| Optimization | Effort | Savings | Priority |
|--------------|--------|---------|----------|
| Implement proof aggregation | High | 80% | P2 |
| GPU workers for proofs | Medium | 87% | P1 |
| Spot instances for workers | Low | 65% | P1 |
| Reserved capacity | Low | 35% | P1 |
| CloudFlare CDN | Low | 50% | P1 |
| Database archiving | Medium | 30% | P2 |
| Batch contract calls | Medium | 40% | P2 |

### Low-Impact Optimizations

| Optimization | Effort | Savings | Priority |
|--------------|--------|---------|----------|
| Image optimization | Low | 10% | P3 |
| Code splitting | Medium | 5% | P3 |
| Connection pooling | Low | 5% | P3 |

---

## 10. Cost by Scenario

### Scenario A: Small Launch (Testnet only)

| Service | Cost | Notes |
|---------|------|-------|
| Backend | $8 | t3.micro |
| RDS | $13 | db.t3.micro |
| Redis | $13 | cache.t3.micro |
| RPC | $0 | Alchemy free |
| Domain | $12/year | corvenlabs.org |
| **Monthly** | **$35** | |
| **Year 1** | **$432** | |

### Scenario B: Production Launch (Base Mainnet)

| Service | Cost | Notes |
|---------|------|-------|
| Backend | $30 | t3.small × 2 |
| RDS | $25 | db.t3.small |
| Redis | $13 | cache.t3.micro |
| Load Balancer | $16 | ALB |
| RPC | $0 | Alchemy free |
| Domain + SSL | $12/year | Let's Encrypt |
| Data Transfer | $9 | 100 GB |
| **Monthly** | **$93** | |
| **Year 1** | **$1,128** | |

### Scenario C: Full Scale (Reserved)

| Service | Cost | Notes |
|---------|------|-------|
| Backend | $18 | Reserved t3.small × 2 |
| RDS | $16 | Reserved db.t3.small |
| Redis | $8 | Reserved cache.t3.micro |
| Load Balancer | $16 | On-demand |
| RPC | $0 | Alchemy free |
| Data Transfer | $9 | |
| Monitoring | $20 | CloudWatch + Sentry |
| **Monthly** | **$87** | |
| **Year 1 (incl. upfront)** | **$1,044** | |

### Scenario D: High Scale (10K+ users)

| Service | Cost | Notes |
|---------|------|-------|
| Backend | $38 | t3.medium × 2 (reserved) |
| RDS | $32 | db.t3.medium (reserved) |
| Redis | $16 | cache.t3.small (reserved) |
| Load Balancer | $22 | ALB |
| GPU Workers | $50 | Spot g4dn.xlarge |
| RPC | $50 | Paid plan |
| Data Transfer | $45 | 1 TB |
| Monitoring | $50 | Detailed |
| **Monthly** | **$303** | |
| **Year 1** | **$3,636** | |

---

## 11. Actionable Recommendations

### Immediate (Week 1)

1. ✅ **Use t3.micro for launch**
   - Save: $22/mo vs t3.medium

2. ✅ **Enable CloudFlare free tier**
   - Save: $20/mo in data transfer
   - Bonus: Free DDoS protection

3. ✅ **Configure nginx as load balancer**
   - Save: $16/mo ALB cost

### Short-term (Month 1-3)

4. ⏳ **Evaluate actual usage**
   - Monitor before committing to reserved
   - Target: 3 months of data

5. ⏳ **Implement spot instances for proof workers**
   - Save: 65% on compute
   - Implement graceful degradation

6. ⏳ **Optimize database queries**
   - Reduce read operations
   - Add strategic indexes

### Medium-term (Month 3-6)

7. 📅 **Purchase 1-year reserved capacity**
   - Target: 35% savings
   - Only after workload is stable

8. 📅 **Implement proof aggregation**
   - Target: 80% gas savings
   - Complex but high-value

9. 📅 **Add GPU workers for proof generation**
   - Target: 87% compute savings
   - Required at 10K agents+

### Long-term (Month 6+)

10. 📅 **Consider 3-year reserved**
    - Target: 60% savings
    - Only if architecture is stable

11. 📅 **Implement database sharding**
    - Required at 100K+ agents
    - Cost stays linear vs exponential

---

## 12. Cost Tracking Template

```yaml
Monthly Cost Tracker:
  Infrastructure:
    EC2: $___
    RDS: $___
    ElastiCache: $___
    ALB: $___
    Data Transfer: $___
    CloudWatch: $___
    Total Infra: $___

  Third-party:
    RPC (Alchemy): $___
    Sentry: $___
    Domain: $___
    Total 3rd Party: $___

  Blockchain:
    Gas Costs: $___
    Total Blockchain: $___

  Monthly Total: $___
  Yearly Projection: $___
  YTD Actual: $___
```

---

## Summary

**Bottom Line:**
- **Minimum Viable:** $35/mo (testnet launch)
- **Production Ready:** $93/mo (optimistic) / $87/mo (reserved)
- **High Scale:** $303/mo (10K+ users, fully optimized)

**Key Takeaways:**
1. Start small (t3.micro) and scale up
2. Use free tiers initially (Alchemy, CloudFlare)
3. Optimize before scaling vertically
4. Reserve capacity only after 3 months
5. GPU workers are essential for high scale

**With all optimizations: $1,044 - $1,800/year**
**Without optimizations: $3,000 - $6,000/year**

**Recommended approach:** Follow Phase 1 → Phase 2 → Reserved as growth demands.
