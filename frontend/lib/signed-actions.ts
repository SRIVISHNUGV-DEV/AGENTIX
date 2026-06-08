const CHAIN_ID = 84532

export type SignedActionInput = {
  action: string
  orgId: number
  target: string
  walletAddress: string
  nonce: string
  requestedAt: number
}

export function buildSignedActionMessage(input: SignedActionInput) {
  return [
    'Agentix Authorization',
    `Action: ${input.action}`,
    `Org: ${input.orgId}`,
    `Target: ${input.target}`,
    `Wallet: ${input.walletAddress.toLowerCase()}`,
    `Nonce: ${input.nonce}`,
    `RequestedAt: ${input.requestedAt}`,
    `ChainId: ${CHAIN_ID}`,
  ].join('\n')
}
