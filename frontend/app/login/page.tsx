import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button'

export const metadata = {
  title: 'Connect Wallet - Agent Credentials',
  description: 'Connect your wallet to access the MVP platform and manage agent credentials, sessions, and treasury controls.',
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10 shell py-16 sm:py-24">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <span className="section-kicker">Platform access</span>
            <h1 className="text-5xl font-semibold tracking-[-0.05em] sm:text-6xl">
              Bring your organization in, connect agents, and operate them from one console.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-foreground/65">
              This product is designed as an operator platform first. Teams sign in, connect their agent systems, mint credentials, open sessions, revoke access, and move treasury funds across agents without touching low-level proofs directly.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard">
                <Button className="rounded-full bg-accent px-6 text-accent-foreground hover:bg-accent/90">
                  Enter organization workspace
                </Button>
              </Link>
              <Link href="/sdk">
                <Button variant="outline" className="rounded-full border-white/15 bg-white/5 text-foreground hover:bg-white/10">
                  Self-host with SDK
                </Button>
              </Link>
            </div>
          </div>

          <SpotlightCard className="p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.22em] text-accent">MVP access</p>
            <div className="mt-6">
              <ConnectWalletButton />
            </div>
            <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-7 text-foreground/62">
              This MVP uses a connected wallet as the operator identity. Proper organization auth and SSO can come later without changing the contract or platform flows.
            </div>
            <Link href="/dashboard" className="mt-6 block">
              <Button className="w-full rounded-full bg-white text-background hover:bg-white/90">
                Enter workspace
              </Button>
            </Link>
          </SpotlightCard>
        </div>
      </main>
      <Footer />
    </div>
  )
}
