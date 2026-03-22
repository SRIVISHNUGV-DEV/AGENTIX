import { BACKEND_API_BASE } from '@/lib/api-base'
import { AUTH_COOKIE_NAME } from '@/lib/auth'

export async function POST(request: Request) {
  const payload = await request.text()
  const response = await fetch(`${BACKEND_API_BASE}/auth/login`, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  })

  const body = await response.text()
  const headers = new Headers({
    'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
  })

  if (response.ok) {
    const parsed = JSON.parse(body)
    headers.append(
      'Set-Cookie',
      `${AUTH_COOKIE_NAME}=${parsed.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`
    )
  }

  return new Response(body, { status: response.status, headers })
}
