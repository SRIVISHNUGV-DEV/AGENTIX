import { BACKEND_API_BASE } from '@/lib/api-base'
import { AUTH_COOKIE_NAME, getAuthToken } from '@/lib/auth'

export async function POST() {
  const token = await getAuthToken()

  if (token) {
    await fetch(`${BACKEND_API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => null)
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    },
  })
}
