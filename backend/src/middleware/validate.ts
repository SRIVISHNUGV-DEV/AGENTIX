import type { Context, Next } from "hono"
import { z } from "zod"
import type { AppVariables } from "../types/http"
import { schemas, type SchemaName } from "../validation/schemas"
import { AppError } from "../utils/errors"

export function validateBody(schemaName: SchemaName) {
    const schema = schemas[schemaName]
    if (!schema) {
        throw new Error(`Unknown validation schema: ${schemaName}`)
    }

    return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
        const body = c.get("requestBody") ?? {}

        const result = schema.safeParse(body)
        if (!result.success) {
            const firstError = result.error.errors[0]
            const message = firstError
                ? `${firstError.path.join(".")}: ${firstError.message}`
                : "Invalid request body"
            throw new AppError(400, message)
        }

        // Replace parsed body with validated & transformed result
        c.set("requestBody", result.data)
        await next()
    }
}
