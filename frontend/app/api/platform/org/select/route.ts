import { ACTIVE_ORG_COOKIE } from '@/lib/org-session'

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null)
  const orgId = Number(payload?.orgId)

  if (!Number.isFinite(orgId) || orgId <= 0) {
    return new Response(JSON.stringify({ error: 'orgId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true, orgId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${ACTIVE_ORG_COOKIE}=${orgId}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    },
  })
}
