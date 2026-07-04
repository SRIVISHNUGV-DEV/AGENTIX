import { createHash, randomBytes } from "crypto";

export function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function checksum(data: string): string {
  return sha256(data);
}

export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatEth(wei: string): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExpired(expiry: number): boolean {
  return nowUnix() > expiry;
}

export function relativeTime(timestamp: number): string {
  const diff = nowUnix() - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
