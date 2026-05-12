import { BACKEND_API_BASE } from '@/lib/api-base'
import { ACTIVE_ORG_COOKIE } from '@/lib/org-session'

export async function GET() {
  const response = await fetch(`${BACKEND_API_BASE}/orgs`, {
    cache: 'no-store',
  })

  const body = await response.text()
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
  })
}

export async function POST(request: Request) {
  const payload = await request.text()
  const response = await fetch(`${BACKEND_API_BASE}/orgs`, {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
    },
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
      `${ACTIVE_ORG_COOKIE}=${parsed.id}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    )
  }

  return new Response(body, {
    status: response.status,
    headers,
  })
}
