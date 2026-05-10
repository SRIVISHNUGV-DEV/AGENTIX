export const BACKEND_API_BASE =
  process.env.AGENT_CREDENTIALS_API_URL ??
  process.env.NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL ??
  "http://127.0.0.1:3001"
