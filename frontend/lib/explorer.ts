export function getTxExplorerUrl(txHash: string) {
  return `https://sepolia.basescan.org/tx/${txHash}`
}

export function getAddressExplorerUrl(address: string) {
  return `https://sepolia.basescan.org/address/${address}`
}
