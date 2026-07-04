"use client";

import { ReactNode } from "react";
import { Web3ModalProvider } from "@/lib/web3modal-provider";

export function ClientProvider({ children }: { children: ReactNode }) {
  return <Web3ModalProvider>{children}</Web3ModalProvider>;
}
