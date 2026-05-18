export { AgentClient } from "./AgentClient";
export { SessionManager } from "./SessionManager";
export * from "./types";
// Re-export AGENT_PERMISSIONS constants
export const AGENT_PERMISSIONS = {
    READ_FILE: 1 << 0, // 1
    WRITE_FILE: 1 << 1, // 2
    EXECUTE_COMMAND: 1 << 2, // 4
    QUERY: 1 << 3, // 8
    API_CALL: 1 << 4, // 16
    SIGN_TRANSACTION: 1 << 5, // 32
    DEPLOY_CONTRACT: 1 << 6, // 64
    CUSTOM: 1 << 7, // 128
    ALL: 255 // All permissions
};
