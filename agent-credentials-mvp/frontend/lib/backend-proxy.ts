import { cookies } from 'next/headers'
import { BACKEND_API_BASE } from '@/lib/api-base'
import { AUTH_COOKIE_NAME } from '@/lib/auth'

export async function createBackendAuthHeaders(request: Request) {
  const headers = new Headers()
  const contentType = request.headers.get('Content-Type')

  if (contentType) {
    headers.set('Content-Type', contentType)
  }

  const authorization = request.headers.get('Authorization')
  if (authorization) {
    headers.set('Authorization', authorization)
    return headers
  }

  const store = await cookies()
  const token = store.get(AUTH_COOKIE_NAME)?.value?.trim()
  if (token) {
    headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`)
  }

  return headers
}

export async function proxyBackend(request: Request, target: string | URL) {
  const headers = await createBackendAuthHeaders(request)
  const response = await fetch(target, {
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

export function buildBackendUrl(path: string, search = '') {
  const url = new URL(path, BACKEND_API_BASE)
  url.search = search
  return url
}
