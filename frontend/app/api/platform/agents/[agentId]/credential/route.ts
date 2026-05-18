import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  return proxyBackend(request, buildBackendUrl(`/agents/${agentId}/credentials/issue`))
}
