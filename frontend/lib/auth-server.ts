import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME } from './auth'

export async function getAuthToken() {
  const store = await cookies()
  return store.get(AUTH_COOKIE_NAME)?.value ?? null
}
