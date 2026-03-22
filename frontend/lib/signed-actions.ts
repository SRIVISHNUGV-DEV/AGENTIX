const SEPOLIA_CHAIN_ID = 11155111

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
    'Agent Credentials Authorization',
    `Action: ${input.action}`,
    `Org: ${input.orgId}`,
    `Target: ${input.target}`,
    `Wallet: ${input.walletAddress.toLowerCase()}`,
    `Nonce: ${input.nonce}`,
    `RequestedAt: ${input.requestedAt}`,
    `ChainId: ${SEPOLIA_CHAIN_ID}`,
  ].join('\n')
}
