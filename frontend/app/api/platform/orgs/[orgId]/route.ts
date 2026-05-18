import { buildBackendUrl, createBackendAuthHeaders } from '@/lib/backend-proxy'
import { ACTIVE_ORG_COOKIE } from '@/lib/org-session'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const response = await fetch(buildBackendUrl(`/orgs/${orgId}`), {
    method: 'DELETE',
    body: await request.text(),
    headers: await createBackendAuthHeaders(request),
    cache: 'no-store',
  })

  const body = await response.text()
  const headers = new Headers({
    'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
  })

  if (response.ok) {
    headers.append('Set-Cookie', `${ACTIVE_ORG_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`)
  }

  return new Response(body, {
    status: response.status,
    headers,
  })
}
