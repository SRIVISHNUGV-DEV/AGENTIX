import { cookies } from 'next/headers'

export const ACTIVE_ORG_COOKIE = 'ac_org_id'

export async function getSelectedOrgId() {
  const store = await cookies()
  const raw = store.get(ACTIVE_ORG_COOKIE)?.value
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
