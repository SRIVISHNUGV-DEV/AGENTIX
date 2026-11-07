"use client";

import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from "react";

const WKEY = "agentix_wallet";

interface WalletCtx {
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  openModal: () => Promise<void>;
  disconnect: () => void;
  provider: any | null;
}

const WalletContext = createContext<WalletCtx>({
  address: null,
  chainId: null,
  isConnected: false,
  connecting: false,
  connect: async () => {},
  openModal: async () => {},
  disconnect: () => {},
  provider: null,
});

/**
 * Returns the wallet context (address, chainId, isConnected, connect, disconnect, provider).
 * @returns The nearest Web3ModalProvider value; outside a provider this silently returns the disconnected default (all no-ops) instead of throwing — so a missing provider looks like "no wallet", not an error.
 * Maps to: internal — Web3ModalProvider.
 */
export const useWalletCtx = () => useContext(WalletContext);

/**
 * Provides wallet connection state to the dashboard and restores the last connected address on mount.
 * Why it exists: every section that signs or deploys needs one shared connected-wallet source instead of each reading window.ethereum.
 * @returns `children` inside the WalletContext provider (address, chainId, isConnected, connecting, connect, openModal, disconnect, provider).
 * Maps to: component ClientProvider; Maps to: wallet — injected `window.ethereum` provider.
 * Side effects: reads/writes localStorage (`agentix_wallet`); reads chainId from the injected provider on mount.
 * Security: only the wallet address is persisted — never a private key; connect/disconnect are user-gesture driven.
 */
export function Web3ModalProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem(WKEY);
    if (saved) {
      setAddress(saved);
      detectProvider();
    }
  }, []);

  /**
   * Reads the chainId from the injected provider and stores it plus the provider handle.
   * Called on mount (after restoring a saved address) so the UI knows which chain the wallet is on.
   * @returns void; silently does nothing when no injected provider exists or the request fails.
   * @throws Never — provider errors are swallowed.
   * Maps to: internal — Web3ModalProvider.
   * Side effects: sets chainId/provider state.
   */
  async function detectProvider() {
    const eth = (window as any).ethereum;
    if (eth) {
      try {
        const chain = await eth.request({ method: "eth_chainId" });
        setChainId(parseInt(chain, 16));
        setProvider(eth);
      } catch {}
    }
  }

  /**
   * Connects the injected wallet: requests accounts, then stores the address, chainId, and provider.
   * @returns void; alerts "No wallet detected" when there is no injected provider, and logs (but does not surface) a rejected/failed request.
   * @throws Never — wallet errors are caught and logged; `connecting` is always reset.
   * Maps to: wallet — `eth_requestAccounts` / `eth_chainId` on the injected provider.
   * Side effects: persists the connected address in localStorage; sets address/chainId/provider state.
   * Security: the connection is user-approved in the wallet prompt; only the address is stored.
   */
  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      alert("No wallet detected. Install MetaMask or another Web3 wallet.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        setAddress(accounts[0]);
        localStorage.setItem(WKEY, accounts[0]);
        const chain = await eth.request({ method: "eth_chainId" });
        setChainId(parseInt(chain, 16));
        setProvider(eth);
      }
    } catch (e: any) {
      console.error("Wallet connection failed:", e);
    }
    setConnecting(false);
  }, []);

  /**
   * Disconnects the wallet: clears address, chainId, and provider state and forgets the saved address.
   * Note: this only forgets the wallet locally — it cannot revoke the dapp's permission inside the wallet itself.
   * @returns void.
   * Maps to: internal — Web3ModalProvider.
   * Side effects: removes `agentix_wallet` from localStorage.
   */
  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setProvider(null);
    localStorage.removeItem(WKEY);
  }, []);

  return (
    <WalletContext.Provider value={{
      address,
      chainId,
      isConnected: !!address,
      connecting,
      connect,
      openModal: connect,
      disconnect,
      provider,
    }}>
      {children}
    </WalletContext.Provider>
  );
}
