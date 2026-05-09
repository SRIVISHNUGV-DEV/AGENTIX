'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/external-agents', label: 'External Agents' },
  { href: '/events', label: 'Events' },
  { href: '/sdk', label: 'SDK' },
]

export default function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-background/80 backdrop-blur-2xl">
      <div className="shell flex h-18 items-center justify-between gap-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[1.15rem] border border-white/10 bg-white text-xs font-bold tracking-[0.18em] text-background shadow-[0_12px_40px_rgba(255,255,255,0.18)]">
            AX
          </span>
          <div>
            <span className="block text-sm font-semibold tracking-tight text-foreground">Agentix</span>
            <span className="block text-[11px] uppercase tracking-[0.22em] text-foreground/45">
              Identity Rail
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-card/75 p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.18)] md:flex">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-white text-background shadow-[0_10px_24px_rgba(255,255,255,0.16)]'
                    : 'text-foreground/65 hover:bg-white/5 hover:text-foreground'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="hidden rounded-full border border-white/10 bg-card/75 px-4 py-2 text-sm font-medium text-foreground/65 transition hover:text-foreground sm:inline-flex"
          >
            Workspace
          </Link>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  )
}
