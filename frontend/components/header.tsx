'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/events', label: 'Events' },
  { href: '/sdk', label: 'SDK' },
]

export default function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-background/90 backdrop-blur-xl">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white text-xs font-bold tracking-[0.18em] text-background">
            AC
          </span>
          <div>
            <span className="block text-sm font-semibold tracking-tight text-foreground">
              Agent Credentials
            </span>
            <span className="block text-[11px] uppercase tracking-[0.22em] text-foreground/45">
              Platform
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-card p-1 md:flex">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-white text-background'
                    : 'text-foreground/65 hover:bg-white/5 hover:text-foreground'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="hidden text-sm font-medium text-foreground/65 transition hover:text-foreground sm:inline-flex">
            Workspace
          </Link>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  )
}
