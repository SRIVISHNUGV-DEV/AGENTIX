"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const orgs_1 = __importDefault(require("./routes/orgs"));
const agents_1 = __importDefault(require("./routes/agents"));
const credentials_1 = __importDefault(require("./routes/credentials"));
const sessions_1 = __importDefault(require("./routes/sessions"));
const proofs_1 = __importDefault(require("./routes/proofs"));
const wallets_1 = __importDefault(require("./routes/wallets"));
const events_1 = __importDefault(require("./routes/events"));
const ai_1 = __importDefault(require("./routes/ai"));
const auth_1 = __importDefault(require("./routes/auth"));
const externalAgents_1 = __importDefault(require("./routes/externalAgents"));
const agentLoop_1 = __importDefault(require("./routes/agentLoop"));
const v1_1 = __importDefault(require("./routes/v1"));
const mcp_1 = require("./mcp");
const crypto_1 = require("./utils/crypto");
const eventSync_1 = require("./services/eventSync");
const auth_2 = require("./middleware/auth");
const security_1 = require("./middleware/security");
const errors_1 = require("./utils/errors");
const monitoring_1 = require("./utils/monitoring");
const PORT = Number(process.env.PORT || "3000");
const ENABLE_EVENT_SYNC = process.env.ENABLE_EVENT_SYNC !== "false";
const isProduction = process.env.NODE_ENV === "production";
const app = (0, express_1.default)();
const eventSync = new eventSync_1.EventSyncService();
// Security middleware
app.disable("x-powered-by");
// Helmet security headers in all environments (V-005: Security headers)
app.use(security_1.helmetMiddleware);
// Additional security headers
app.use(security_1.securityHeaders);
app.use(security_1.corsMiddleware);
// Rate limiting: stricter in production
const rateLimiter = isProduction
    ? (0, security_1.createRateLimitMiddleware)(15 * 60 * 1000, 100) // 100 requests per 15 min
    : (0, security_1.createRateLimitMiddleware)(15 * 60 * 1000, 10000); // 10000 in dev (generous for hot reload)
app.use(rateLimiter);
// Body parsing with limits
app.use(express_1.default.json({ limit: "32kb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "32kb" }));
// Auth middleware
app.use(auth_2.attachAuth);
app.use("/auth", security_1.authRateLimit, auth_1.default);
app.use("/orgs", orgs_1.default);
app.use("/agents", agents_1.default);
app.use("/credentials", credentials_1.default);
app.use("/sessions", sessions_1.default);
app.use("/proofs", proofs_1.default);
app.use("/prover", proofs_1.default); // Mount proofs router at /prover for prover/status
app.use("/wallets", wallets_1.default);
app.use("/events", events_1.default);
app.use("/ai", ai_1.default);
app.use("/external", externalAgents_1.default);
app.use("/external-agents", externalAgents_1.default); // Alias for frontend compatibility
app.use("/api", agentLoop_1.default);
app.use("/v1", v1_1.default);
// MCP Server routes
app.use("/mcp", (0, mcp_1.createMCPRouter)());
app.use((error, req, res, next) => {
    // Track the error with context
    monitoring_1.errorTracker.captureError(error instanceof Error ? error : new Error(String(error)), "express_error_handler", {
        path: req.path,
        method: req.method,
        ip: req.ip
    });
    if (error instanceof errors_1.AppError) {
        monitoring_1.metrics.increment("errors.app_error");
        return res.status(error.statusCode).json({
            error: error.expose ? error.message : "internal server error"
        });
    }
    monitoring_1.metrics.increment("errors.server_error");
    console.error("[server]", error?.message ?? error);
    return res.status(500).json({
        error: "internal server error"
    });
});
async function start() {
    await (0, crypto_1.initCrypto)();
    // Enhanced health endpoint with metrics
    app.get("/health", (req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            environment: isProduction ? "production" : "development",
            ...(0, monitoring_1.getHealthMetrics)()
        });
    });
    // Metrics endpoint (protected in production)
    app.get("/metrics", (req, res) => {
        if (isProduction && req.headers.authorization !== `Bearer ${process.env.METRICS_API_KEY}`) {
            return res.status(401).json({ error: "unauthorized" });
        }
        res.json(monitoring_1.metrics.getMetrics());
    });
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT} (${isProduction ? "production" : "development"})`);
    });
    if (ENABLE_EVENT_SYNC) {
        eventSync.start().catch((error) => {
            console.error("Event sync bootstrap failed:", error.message);
            monitoring_1.errorTracker.captureError(error, "event_sync_start");
        });
    }
    else {
        console.log("Event sync disabled by configuration");
    }
}
start();
