import { BACKEND_API_BASE } from '@/lib/api-base'

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params
  const incomingUrl = new URL(request.url)
  const upstreamUrl = new URL(`/external/${path.map(encodeURIComponent).join('/')}`, BACKEND_API_BASE)
  upstreamUrl.search = incomingUrl.search

  const headers = new Headers()
  const contentType = request.headers.get('Content-Type')
  if (contentType) {
    headers.set('Content-Type', contentType)
  }

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    cache: 'no-store',
  })

  const body = await response.text()
  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
