import { buildBackendUrl } from '@/lib/backend-proxy'
import { getSelectedOrgId } from '@/lib/org-session'

export async function GET() {
  const orgId = await getSelectedOrgId()

  const response = await fetch(buildBackendUrl(`/agents?orgId=${orgId}`), {
    method: 'GET',
    cache: 'no-store',
  })

  const responseBody = await response.text()

  return new Response(responseBody, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

export async function POST(request: Request) {
  const body = await request.json()

  const response = await fetch(buildBackendUrl('/agents'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const responseBody = await response.text()

  return new Response(responseBody, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}
