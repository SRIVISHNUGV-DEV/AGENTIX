export function getTxExplorerUrl(txHash: string) {
  return `https://sepolia.etherscan.io/tx/${txHash}`
}

export function getAddressExplorerUrl(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`
}
