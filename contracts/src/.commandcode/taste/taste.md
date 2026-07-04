# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# architecture
- Never store or ask for private keys in the AgentIX SDK; authentication must use EIP-712 signatures from the wallet owner, and transactions must be sent through the wallet provider, not a private-key signer. Confidence: 0.95
- Deploy on Base Sepolia testnet, not Ethereum Sepolia. Confidence: 0.65

