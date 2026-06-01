import { randomUUID } from "crypto"

const isProduction = process.env.NODE_ENV === "production"

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace"

const LOG_LEVELS: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
}

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL as LogLevel] ?? LOG_LEVELS.info

export type LogEntry = {
  level: LogLevel
  time: string
  msg: string
  reqId?: string
  err?: { message: string; stack?: string; code?: string }
  [key: string]: unknown
}

class Logger {
  private generateId(): string {
    return randomUUID().slice(0, 8)
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[level] < currentLevel) return

    const entry: LogEntry = {
      level,
      time: new Date().toISOString(),
      msg,
      ...meta,
    }

    if (meta?.err instanceof Error) {
      entry.err = {
        message: meta.err.message,
        stack: meta.err.stack,
        code: (meta.err as any).code,
      }
      delete meta.err
    }

    const output = JSON.stringify(entry)

    if (level === "fatal" || level === "error") {
      process.stderr.write(output + "\n")
    } else {
      process.stdout.write(output + "\n")
    }
  }

  fatal(msg: string, meta?: Record<string, unknown>) {
    this.write("fatal", msg, meta)
  }

  error(msg: string, meta?: Record<string, unknown>) {
    this.write("error", msg, meta)
  }

  warn(msg: string, meta?: Record<string, unknown>) {
    this.write("warn", msg, meta)
  }

  info(msg: string, meta?: Record<string, unknown>) {
    this.write("info", msg, meta)
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    this.write("debug", msg, meta)
  }

  trace(msg: string, meta?: Record<string, unknown>) {
    this.write("trace", msg, meta)
  }

  child(meta: Record<string, unknown>): Logger {
    const child = new Logger()
    const origWrite = child.write.bind(child)
    child.write = (level, msg, childMeta) => {
      origWrite(level, msg, { ...meta, ...childMeta })
    }
    return child
  }
}

export const logger = new Logger()

export function createRequestLogger() {
  return async (c: any, next: any) => {
    const reqId = randomUUID().slice(0, 8)
    const method = c.req.method
    const path = c.req.path
    const start = Date.now()

    c.set("reqId", reqId)

    logger.info("request start", {
      reqId,
      method,
      path,
      query: c.req.query(),
    })

    try {
      await next()
    } finally {
      const duration = Date.now() - start
      const status = c.res?.status ?? 500

      logger.info("request end", {
        reqId,
        method,
        path,
        status,
        duration,
      })
    }
  }
}
