import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userOpHash: string }> }
) {
  const { userOpHash } = await params
  const search = new URL(request.url).search
  return proxyBackend(request, buildBackendUrl(`/wallets/userops/${userOpHash}`, search))
}
