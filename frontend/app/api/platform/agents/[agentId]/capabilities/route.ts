import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const incomingUrl = new URL(request.url)
  return proxyBackend(request, buildBackendUrl(`/agents/${agentId}/capabilities`, incomingUrl.search))
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  return proxyBackend(request, buildBackendUrl(`/agents/${agentId}/capabilities`))
}
