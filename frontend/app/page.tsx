import Link from 'next/link'
import { ArrowRight, Fingerprint, ShieldCheck, WalletCards } from 'lucide-react'
import Header from '@/components/header'
import Footer from '@/components/footer'
import { Button } from '@/components/ui/button'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { getDashboardStats } from '@/lib/mock-api'

export const metadata = {
  title: 'Agent Credentials',
  description:
    'A platform for issuing private agent credentials, creating signed on-chain sessions, and operating agent wallets from one workspace.',
}

const pillars = [
  {
    title: 'Issue credentials',
    description: 'Create private credentials for each agent and anchor the active root on-chain.',
    icon: Fingerprint,
  },
  {
    title: 'Approve actions by wallet signature',
    description: 'Every contract write is explicitly approved by the organization owner wallet.',
    icon: ShieldCheck,
  },
  {
    title: 'Operate agent wallets',
    description: 'Deploy wallets, fund them, create sessions, and review contract events in one place.',
    icon: WalletCards,
  },
]

export default async function Home() {
  let stats = {
    totalAgents: 0,
    totalSessions: 0,
    totalWallets: 0,
    recentEvents: 0,
  }

  try {
    const statsRes = await getDashboardStats()
    stats = statsRes.data
  } catch {}

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10">
        <section className="shell py-18 sm:py-24">
          <div className="max-w-4xl">
            <span className="section-kicker">Platform for agent authorization</span>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] sm:text-7xl">
              Private credentials. Signed operations. On-chain session control.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/65">
              Connect an organization wallet, create agent identities, issue credentials, deploy wallets,
              fund operations, create sessions, and revoke access without exposing agent secrets.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard">
                <Button className="h-11 rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90">
                  Open workspace
                </Button>
              </Link>
              <Link href="/sdk">
                <Button
                  variant="outline"
                  className="h-11 rounded-full border-white/15 bg-transparent px-6 text-foreground hover:bg-white/5"
                >
                  Self-host / SDK
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {[
              ['Agents', stats.totalAgents],
              ['Sessions', stats.totalSessions],
              ['Wallets', stats.totalWallets],
              ['Indexed events', stats.recentEvents],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-card p-5">
                <div className="text-sm text-foreground/55">{label}</div>
                <div className="mt-3 text-3xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="shell pb-18">
          <div className="grid gap-4 lg:grid-cols-3">
            {pillars.map(({ title, description, icon: Icon }) => (
              <SpotlightCard key={title} className="p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white text-background">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-foreground/62">{description}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>

        <section className="shell pb-20">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-white/10 bg-card p-8">
              <div className="text-sm uppercase tracking-[0.2em] text-foreground/45">Typical flow</div>
              <div className="mt-5 space-y-4">
                {[
                  'Connect the organization owner wallet.',
                  'Create an organization and add agents.',
                  'Deploy a dedicated contract stack for that organization.',
                  'Issue credentials, create wallets, and fund operations.',
                  'Open sessions and inspect indexed contract events.',
                ].map((step, index) => (
                  <div key={step} className="flex gap-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm">
                      {index + 1}
                    </div>
                    <div className="pt-1 text-foreground/72">{step}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-card p-8">
              <div className="text-sm uppercase tracking-[0.2em] text-foreground/45">What stays available</div>
              <div className="mt-5 space-y-3 text-sm leading-7 text-foreground/62">
                <p>The website is now focused on the operator workflow first, not the full technical stack.</p>
                <p>The SDK page stays available for teams that want to self-host or integrate the system directly.</p>
              </div>
              <Link
                href="/dashboard"
                className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Go to workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
