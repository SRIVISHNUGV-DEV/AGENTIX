"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.respondWithError = respondWithError;
class AppError extends Error {
    statusCode;
    expose;
    constructor(statusCode, message, expose = true) {
        super(message);
        this.statusCode = statusCode;
        this.expose = expose;
    }
}
exports.AppError = AppError;
function respondWithError(res, error, context) {
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error"
        });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${context}]`, message);
    return res.status(500).json({
        error: "internal server error"
    });
}
