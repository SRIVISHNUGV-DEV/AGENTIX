const isProduction = process.env.NODE_ENV === 'production'

export const BACKEND_API_BASE =
  process.env.AGENT_CREDENTIALS_API_URL ??
  process.env.NEXT_PUBLIC_AGENT_CREDENTIALS_API_URL ??
  (isProduction ? "http://backend:3001" : "http://127.0.0.1:3001")
