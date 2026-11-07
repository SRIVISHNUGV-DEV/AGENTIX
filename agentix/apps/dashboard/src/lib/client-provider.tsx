"use client";

import { ReactNode } from "react";
import { Web3ModalProvider } from "@/lib/web3modal-provider";

/**
 * Wraps the client tree in the wallet provider.
 * Why it exists: the 'use client' boundary — RootLayout is a server component, so wallet context must be supplied by this client wrapper.
 * @returns `children` rendered inside Web3ModalProvider.
 * Maps to: component Web3ModalProvider.
 */
export function ClientProvider({ children }: { children: ReactNode }) {
  return <Web3ModalProvider>{children}</Web3ModalProvider>;
}
