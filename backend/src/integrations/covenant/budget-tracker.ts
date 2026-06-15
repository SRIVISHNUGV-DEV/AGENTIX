import { initDB } from "../../db"

let redisClient: any = null

async function getRedis() {
  if (redisClient) return redisClient

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  try {
    const { default: Redis } = await import("ioredis")
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true
    })
    await redisClient.connect()
    return redisClient
  } catch {
    redisClient = null
    return null
  }
}

const BUDGET_KEY_PREFIX = "agentix:covenant:budget:"
const BUDGET_TTL_SECONDS = 86400

export class BudgetTracker {
  async initBudget(sessionId: string, maxValue: number): Promise<void> {
    const redis = await getRedis()
    if (redis) {
      const key = `${BUDGET_KEY_PREFIX}${sessionId}`
      await redis.set(key, String(maxValue), "EX", BUDGET_TTL_SECONDS)
      return
    }

    const db = await initDB()
    await db.run(
      `INSERT INTO session_budgets (session_id, total_budget, spent, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         total_budget = excluded.total_budget,
         updated_at = excluded.updated_at`,
      sessionId,
      maxValue,
      Math.floor(Date.now() / 1000)
    )
  }

  async tryDeduct(sessionId: string, amount: number): Promise<{
    allowed: boolean
    remaining: number
    error?: string
  }> {
    const redis = await getRedis()
    if (redis) {
      return this.tryDeductRedis(redis, sessionId, amount)
    }
    return this.tryDeductDB(sessionId, amount)
  }

  private async tryDeductRedis(
    redis: any,
    sessionId: string,
    amount: number
  ): Promise<{ allowed: boolean; remaining: number; error?: string }> {
    const key = `${BUDGET_KEY_PREFIX}${sessionId}`
    const luaScript = `
      local current = tonumber(redis.call('GET', KEYS[1]))
      if current == nil then
        return {0, -1}
      end
      if current < tonumber(ARGV[1]) then
        return {0, current}
      end
      local new_val = current - tonumber(ARGV[1])
      redis.call('SET', KEYS[1], tostring(new_val), 'EX', ARGV[2])
      return {1, new_val}
    `

    const result = await redis.eval(
      luaScript,
      1,
      key,
      String(amount),
      String(BUDGET_TTL_SECONDS)
    ) as number[]

    if (result[0] === 0) {
      if (result[1] === -1) {
        return { allowed: false, remaining: 0, error: "Session budget not initialized" }
      }
      return {
        allowed: false,
        remaining: result[1],
        error: `Insufficient budget: requested ${amount}, remaining ${result[1]}`
      }
    }

    return { allowed: true, remaining: result[1] }
  }

  private async tryDeductDB(
    sessionId: string,
    amount: number
  ): Promise<{ allowed: boolean; remaining: number; error?: string }> {
    const db = await initDB()

    const existing = await db.get(
      `SELECT total_budget, spent FROM session_budgets WHERE session_id = ?`,
      sessionId
    )

    if (!existing) {
      return { allowed: false, remaining: 0, error: "Session budget not initialized" }
    }

    const totalBudget = Number(existing.total_budget)
    const spent = Number(existing.spent)
    const remaining = totalBudget - spent

    if (remaining < amount) {
      return {
        allowed: false,
        remaining,
        error: `Insufficient budget: requested ${amount}, remaining ${remaining}`
      }
    }

    const result = await db.run(
      `UPDATE session_budgets
       SET spent = spent + ?, updated_at = ?
       WHERE session_id = ? AND (total_budget - spent) >= ?`,
      amount,
      Math.floor(Date.now() / 1000),
      sessionId,
      amount
    )

    if (result.changes === 0) {
      return {
        allowed: false,
        remaining,
        error: "Concurrent budget deduction failed — retry"
      }
    }

    return { allowed: true, remaining: remaining - amount }
  }

  async getRemaining(sessionId: string): Promise<number> {
    const redis = await getRedis()
    if (redis) {
      const key = `${BUDGET_KEY_PREFIX}${sessionId}`
      const val = await redis.get(key)
      return val ? Number(val) : 0
    }

    const db = await initDB()
    const row = await db.get(
      `SELECT total_budget - spent as remaining FROM session_budgets WHERE session_id = ?`,
      sessionId
    )
    return row ? Number(row.remaining) : 0
  }

  async refund(sessionId: string, amount: number): Promise<void> {
    const redis = await getRedis()
    if (redis) {
      const key = `${BUDGET_KEY_PREFIX}${sessionId}`
      await redis.incrbyfloat(key, amount)
      return
    }

    const db = await initDB()
    await db.run(
      `UPDATE session_budgets SET spent = MAX(0, spent - ?), updated_at = ? WHERE session_id = ?`,
      amount,
      Math.floor(Date.now() / 1000),
      sessionId
    )
  }
}
