import { cookies } from 'next/headers'

export const AUTH_COOKIE_NAME = 'ac_session'

export async function getAuthToken() {
  const store = await cookies()
  return store.get(AUTH_COOKIE_NAME)?.value ?? null
}
