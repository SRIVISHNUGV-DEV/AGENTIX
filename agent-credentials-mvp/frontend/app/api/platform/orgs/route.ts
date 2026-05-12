import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'
import { ACTIVE_ORG_COOKIE } from '@/lib/org-session'

export async function GET() {
  return proxyBackend(new Request(buildBackendUrl('/orgs').toString(), { method: 'GET' }), buildBackendUrl('/orgs'))
}

export async function POST(request: Request) {
  // Parse the body to get signature payload
  const body = await request.json()

  const response = await fetch(buildBackendUrl('/orgs'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const responseBody = await response.text()
  const headers = new Headers({
    'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
  })

  if (response.ok) {
    const parsed = JSON.parse(responseBody)
    headers.append(
      'Set-Cookie',
      `${ACTIVE_ORG_COOKIE}=${parsed.id}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    )
  }

  return new Response(responseBody, {
    status: response.status,
    headers,
  })
}
