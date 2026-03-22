import { BACKEND_API_BASE } from '@/lib/api-base'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const payload = await request.text()
  const response = await fetch(`${BACKEND_API_BASE}/agents/${agentId}/revoke`, {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const body = await response.text()
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
  })
}
