import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_API_BASE } from '@/lib/api-base'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ walletAddress: string }> }
) {
  const { walletAddress } = await params
  const body = await request.text()

  const response = await fetch(`${BACKEND_API_BASE}/wallets/${walletAddress}/userop/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  })

  return NextResponse.json(await response.json(), { status: response.status })
}
