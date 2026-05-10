import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const stableDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return stableDateFormatter.format(date)
}

export function truncateAddress(address: string, chars = 8): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function truncateHash(hash: string, maxLength: number = 24): string {
  if (hash.length <= maxLength) return hash
  const start = Math.floor((maxLength - 3) / 2)
  const end = Math.ceil((maxLength - 3) / 2)
  return `${hash.slice(0, start)}...${hash.slice(-end)}`
}
