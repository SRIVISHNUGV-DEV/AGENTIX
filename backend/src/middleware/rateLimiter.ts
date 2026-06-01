import type { AppContext } from "../types/http"
import { logger } from "../utils/logger"

// In-memory fallback rate limiter
const memoryHits = new Map<string, { count: number; resetAt: number }>()

function createMemoryRateLimiter(windowMs: number, maxRequests: number) {
  return async (c: AppContext, next: any) => {
    const forwarded = c.req.header("x-forwarded-for")
    const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown"
    const now = Date.now()

    const existing = memoryHits.get(ip)
    if (!existing || existing.resetAt <= now) {
      memoryHits.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (existing.count >= maxRequests) {
      c.header("Retry-After", String(Math.ceil((existing.resetAt - now) / 1000)))
      return c.json({ error: "rate limit exceeded" }, 429)
    }

    existing.count += 1
    await next()
  }
}

let redisClient: any = null

export async function initRateLimiter(redisUrl?: string) {
  if (redisUrl) {
    try {
      const { default: Redis } = await import("ioredis")
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) return null
          return Math.min(times * 100, 1000)
        },
        lazyConnect: true,
      })
      await redisClient.connect()
      logger.info("rate limiter using Redis backend")
      return
    } catch (err) {
      logger.warn("Redis unavailable for rate limiter, falling back to in-memory", { err })
      redisClient = null
    }
  }
  logger.info("rate limiter using in-memory backend")
}

export function createRateLimitMiddleware(windowMs: number, maxRequests: number, prefix = "rl") {
  if (redisClient) {
    return async (c: AppContext, next: any) => {
      const forwarded = c.req.header("x-forwarded-for")
      const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown"
      const key = `${prefix}:${ip}:${Math.floor(Date.now() / windowMs)}`

      try {
        const count = await redisClient.incr(key)
        if (count === 1) {
          await redisClient.pexpire(key, windowMs)
        }
        if (count > maxRequests) {
          return c.json({ error: "rate limit exceeded" }, 429)
        }
      } catch {
        // Redis failure — allow through (fail open for availability)
        logger.warn("rate limiter Redis error, allowing request", { ip })
      }
      await next()
    }
  }

  return createMemoryRateLimiter(windowMs, maxRequests)
}

export async function authRateLimit(c: AppContext, next: any) {
  if (redisClient) {
    const forwarded = c.req.header("x-forwarded-for")
    const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown"
    const windowMs = 15 * 60 * 1000
    const maxRequests = 10
    const key = `auth:${ip}:${Math.floor(Date.now() / windowMs)}`

    try {
      const count = await redisClient.incr(key)
      if (count === 1) await redisClient.pexpire(key, windowMs)
      if (count > maxRequests) {
        return c.json({ error: "too many authentication attempts" }, 429)
      }
    } catch {
      // fail open
    }
  }
  await next()
}
