import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  return proxyBackend(request, buildBackendUrl(`/orgs/${orgId}/fund`))
}
