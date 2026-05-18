import { buildBackendUrl, proxyBackend } from '@/lib/backend-proxy'

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params
  const incomingUrl = new URL(request.url)
  return proxyBackend(
    request,
    buildBackendUrl(`/external/${path.map(encodeURIComponent).join('/')}`, incomingUrl.search)
  )
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
