'use client'

import { useWallet } from '@/components/wallet/wallet-provider'

export type WalletActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type WalletActionOptions = {
  action: string
  orgId: number
  target: string
}

/**
 * Hook that wraps API calls with wallet signature authentication.
 * Validates wallet connection, generates EIP-191 signature, and injects into request.
 */
export function useWalletAction() {
  const { isConnected, isSepolia, signPlatformAction, account } = useWallet()

  /**
   * Execute a wallet-authenticated API call.
   * Automatically handles signature generation and injection.
   */
  async function executeAction<T>(
    options: WalletActionOptions,
    apiCall: (signaturePayload: {
      walletAddress: string
      signature: string
      nonce: string
      requestedAt: number
    }) => Promise<T>
  ): Promise<WalletActionResult<T>> {
    // Validate wallet connection
    if (!isConnected) {
      return { success: false, error: 'Wallet not connected' }
    }

    // Validate correct network
    if (!isSepolia) {
      return { success: false, error: 'Please switch to Sepolia network' }
    }

    try {
      // Generate signature
      const signaturePayload = await signPlatformAction({
        action: options.action,
        orgId: options.orgId,
        target: options.target,
      })

      // Execute API call with signature
      const result = await apiCall(signaturePayload)
      return { success: true, data: result }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed'
      return { success: false, error: message }
    }
  }

  /**
   * Execute a wallet-authenticated POST request.
   */
  async function post<T = unknown>(
    url: string,
    options: WalletActionOptions,
    body?: Record<string, unknown>
  ): Promise<WalletActionResult<T>> {
    return executeAction(options, async (signaturePayload) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(body ?? {}),
          ...signaturePayload,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error ?? 'Request failed')
      }

      return data
    })
  }

  /**
   * Execute a wallet-authenticated DELETE request.
   */
  async function del<T = unknown>(
    url: string,
    options: WalletActionOptions
  ): Promise<WalletActionResult<T>> {
    return executeAction(options, async (signaturePayload) => {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signaturePayload),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error ?? 'Request failed')
      }

      return data
    })
  }

  return {
    isConnected,
    isSepolia,
    account,
    executeAction,
    post,
    del,
  }
}
