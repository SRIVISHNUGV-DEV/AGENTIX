import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ walletAddress: string }> }
) {
  const { walletAddress } = await params
  return proxyBackend(request, buildBackendUrl(`/wallets/${walletAddress}/userop/prepare`))
}
