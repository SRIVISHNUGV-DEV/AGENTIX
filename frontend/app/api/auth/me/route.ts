import { BACKEND_API_BASE } from '@/lib/api-base'
import { getAuthToken } from '@/lib/auth'

export async function GET() {
  const token = await getAuthToken()

  if (!token) {
    return new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const response = await fetch(`${BACKEND_API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  const body = await response.text()
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
  })
}
