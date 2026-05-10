import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_API_BASE } from '@/lib/api-base'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userOpHash: string }> }
) {
  const { userOpHash } = await params
  const search = request.nextUrl.search

  const response = await fetch(`${BACKEND_API_BASE}/wallets/userops/${userOpHash}${search}`, {
    method: 'GET',
    cache: 'no-store',
  })

  return NextResponse.json(await response.json(), { status: response.status })
}
