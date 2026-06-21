# Immediate Value Architecture

## One Sentence

"Give AI agents temporary, revocable authority to perform economic actions."

## Value Proposition

| Before | After |
|--------|-------|
| AI agents can't spend money | AI agents have budget-limited sessions |
| No audit trail for agent actions | Every action logged with full context |
| No way to revoke agent access | Instant revocation via nullifier |
| No permission granularity | Bitfield-based permission control |
| Manual approval for every action | Automated authorization with guardrails |

## Developer Journey (5 minutes)

```
1. npm install                    (30s)
2. npm run setup                  (2m) — configure .env
3. npm run demo                   (1m) — see full flow
4. Read QUICKSTART.md             (2m) — understand the API
```

## Enterprise Journey (30 minutes)

```
1. Deploy contracts               (5m) — Base Sepolia
2. Configure backend              (5m) — .env with production values
3. Run security tests             (2m) — verify all 7 scenarios
4. Load test                      (10m) — concurrent sessions
5. Set up monitoring              (5m) — metrics + audit logs
6. Production checklist           (3m) — verify all items
```

## Integration Points

```
┌─────────────────────────────────────────────────────┐
│                  Your AI Agent                       │
│                                                     │
│  1. Call /covenant/authorize                        │
│     → Get permission to act                         │
│                                                     │
│  2. Call /covenant/task                             │
│     → Create escrowed task                          │
│                                                     │
│  3. Call /covenant/task/:id/submit                  │
│     → Submit deliverable                            │
│                                                     │
│  4. Call /covenant/task/:id/complete                │
│     → Settle payment                                │
│                                                     │
│  5. Call /covenant/audit                            │
│     → View full audit trail                         │
└─────────────────────────────────────────────────────┘
```

## North Star Metric

**Authorized Economic Volume** = Every Covenant action executed under an AgentIX session.

Track:
- User → Who initiated
- Organization → Which org
- Agent → Which agent
- Session → Which session
- Budget → How much was authorized
- Permission → What was allowed
- Task → What was executed
- Settlement → What was paid

## Revenue Model

| Tier | Price | Includes |
|------|-------|----------|
| Free | $0 | 100 sessions/month, 1 org |
| Pro | $99/mo | 10,000 sessions/month, 10 orgs |
| Enterprise | $499/mo | Unlimited, SLA, support |

Per-session fee: $0.01 after free tier

## Immediate Revenue Opportunities

1. **API-as-a-Service** — Charge per session created
2. **Enterprise licenses** — Monthly fee for on-premise deployment
3. **Audit trail exports** — Charge for compliance reports
4. **Custom permission sets** — Charge for enterprise-specific bitfields
5. **Priority support** — Charge for SLA-guaranteed response times
