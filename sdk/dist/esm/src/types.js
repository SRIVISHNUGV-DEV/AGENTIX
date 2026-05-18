// Permission constants
export const AGENT_PERMISSIONS = {
    READ_FILE: 1 << 0,
    WRITE_FILE: 1 << 1,
    EXECUTE_COMMAND: 1 << 2,
    QUERY: 1 << 3,
    API_CALL: 1 << 4,
    SIGN_TRANSACTION: 1 << 5,
    DEPLOY_CONTRACT: 1 << 6,
    CUSTOM: 1 << 7,
    ALL: 255
};
