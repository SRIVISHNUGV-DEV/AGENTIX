"use client";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export async function fetchJSON<T>(path: string): Promise<T> {
  return request<T>(path);
}

export async function postJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function putJSON<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteJSON<T>(path: string, body?: any): Promise<T> {
  return request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined });
}

export const EXPLORER = "https://sepolia.basescan.org";

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerAddress(addr: string) {
  return `${EXPLORER}/address/${addr}`;
}

export function explorerBlock(block: number | string) {
  return `${EXPLORER}/block/${block}`;
}

export function truncate(addr: string, chars = 6): string {
  if (!addr) return "—";
  return addr.length > chars + 4 ? `${addr.slice(0, chars)}...${addr.slice(-4)}` : addr;
}
