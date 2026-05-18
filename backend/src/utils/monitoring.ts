import { AppError } from "./errors"

const SENTRY_DSN = process.env.SENTRY_DSN
const ENVIRONMENT = process.env.NODE_ENV || "development"

// Simple error tracking without Sentry dependency
// Can be replaced with @sentry/node when needed
class ErrorTracker {
    private errors: Array<{
        error: Error
        context: string
        timestamp: number
        metadata?: Record<string, any>
    }> = []

    private maxErrors = 1000

    captureError(error: Error, context: string, metadata?: Record<string, any>) {
        const entry = {
            error,
            context,
            timestamp: Date.now(),
            metadata
        }

        this.errors.push(entry)

        // Keep only last N errors
        if (this.errors.length > this.maxErrors) {
            this.errors.shift()
        }

        // Always log to console
        console.error(`[${context}]`, error.message, metadata || "")

        // If Sentry DSN is configured, could send to Sentry here
        if (SENTRY_DSN) {
            // Import sentry dynamically if DSN is available
            this.sendToSentry(error, context, metadata)
        }
    }

    private async sendToSentry(error: Error, context: string, metadata?: Record<string, any>) {
        try {
            // This is a placeholder - actual Sentry integration would be:
            // import * as Sentry from '@sentry/node'
            // Sentry.captureException(error, { extra: { context, ...metadata } })
            console.log("[Sentry] Would send error to Sentry:", error.message)
        } catch {
            // Silent fail - don't break app flow
        }
    }

    getErrors(since?: number) {
        if (since) {
            return this.errors.filter(e => e.timestamp > since)
        }
        return this.errors
    }

    clearErrors() {
        this.errors = []
    }
}

export const errorTracker = new ErrorTracker()

// Metrics collection
class MetricsCollector {
    private metrics: Map<string, {
        count: number
        lastValue: number
        timestamps: number[]
    }> = new Map()

    increment(name: string, value = 1) {
        const existing = this.metrics.get(name)
        if (existing) {
            existing.count += value
            existing.timestamps.push(Date.now())
        } else {
            this.metrics.set(name, {
                count: value,
                lastValue: value,
                timestamps: [Date.now()]
            })
        }
    }

    gauge(name: string, value: number) {
        this.metrics.set(name, {
            count: 1,
            lastValue: value,
            timestamps: [Date.now()]
        })
    }

    getMetrics() {
        const result: Record<string, any> = {}
        this.metrics.forEach((value, key) => {
            result[key] = {
                count: value.count,
                lastValue: value.lastValue,
                timestamps: value.timestamps.slice(-10) // Last 10 only
            }
        })
        return result
    }
}

export const metrics = new MetricsCollector()

// Enhanced error response with tracking
export function respondWithError(
    res: any,
    error: unknown,
    context: string,
    metadata?: Record<string, any>
) {
    const errorObj = error instanceof Error
        ? error
        : new Error(String(error))

    // Track the error
    errorTracker.captureError(errorObj, context, metadata)

    if (error instanceof AppError) {
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error",
            ...(ENVIRONMENT !== "production" && { stack: error.stack })
        })
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[${context}]`, message)

    return res.status(500).json({
        error: "internal server error",
        ...(ENVIRONMENT !== "production" && { stack: errorObj.stack })
    })
}

// Health check with metrics
export function getHealthMetrics() {
    return {
        environment: ENVIRONMENT,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        errors: errorTracker.getErrors(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
        metrics: metrics.getMetrics()
    }
}
