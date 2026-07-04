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

export const useWalletCtx = () => useContext(WalletContext);

export function Web3ModalProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem(WKEY);
    if (saved) {
      setAddress(saved);
      detectProvider(saved);
    }
  }, []);

  async function detectProvider(addr: string) {
    const eth = (window as any).ethereum;
    if (eth) {
      try {
        const chain = await eth.request({ method: "eth_chainId" });
        setChainId(parseInt(chain, 16));
        setProvider(eth);
      } catch {}
    }
  }

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
