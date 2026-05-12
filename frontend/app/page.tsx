import Link from 'next/link'
import { ArrowRight, Orbit, ShieldCheck, WalletCards, Waves } from 'lucide-react'
import Header from '@/components/header'
import Footer from '@/components/footer'
import { Button } from '@/components/ui/button'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { DepthOrbit } from '@/components/effects/depth-orbit'
import { getDashboardStats } from '@/lib/mock-api'
import { SignalStrip } from '@/components/common/signal-strip'
import { StackMetrics } from '@/components/common/stack-metrics'

export const metadata = {
  title: 'Agentix',
  description:
    'Agentix is the operator platform for issuing private agent credentials, creating signed on-chain sessions, and operating agent wallets from one workspace.',
}

const pillars = [
  {
    title: 'Private credentials',
    description: 'Issue agent credentials privately, anchor roots on-chain, and keep raw secrets out of the operator surface.',
    icon: Orbit,
  },
  {
    title: 'Signed operations',
    description: 'Every critical platform action is confirmed by the organization owner wallet before a transaction is sent.',
    icon: ShieldCheck,
  },
  {
    title: 'Session-controlled wallets',
    description: 'Deploy wallets, fund them, create bounded sessions, and inspect indexed on-chain events in one workflow.',
    icon: WalletCards,
  },
]

const signalItems = ['Groth16 proofs', 'Poseidon trees', 'Sepolia contracts', 'Wallet signatures', 'Event indexing']

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
        <section className="shell py-10 sm:py-14">
          <div className="hero-panel depth-shell noise-overlay p-7 sm:p-10 lg:p-14">
            <div className="grid gap-10 xl:grid-cols-[1.05fr_0.95fr] xl:items-center">
              <div className="max-w-4xl">
                <span className="section-kicker">Protocol and operator platform</span>
                <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-7xl xl:text-[5.8rem]">
                  Identity, liquidity, and execution staged like private infrastructure.
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/64">
                  Agentix gives autonomous systems a quieter, sharper control plane. Credentials stay private, sessions
                  stay bounded, and treasury motion stays legible at a glance.
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
                      SDK and self-host
                    </Button>
                  </Link>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                  {[
                    ['Private proof rail', 'Credential state without secret leakage'],
                    ['Dedicated org stack', 'Registry, session manager, and wallet factory per org'],
                    ['4337-ready wallets', 'Session-bound execution with owner confirmation'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-[1.4rem] border border-white/10 bg-background/55 p-4 backdrop-blur-xl">
                      <div className="micro-label">{title}</div>
                      <p className="mt-2 text-sm leading-6 text-foreground/62">{body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="lux-panel p-6">
                  <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                    <div>
                      <div className="micro-label">Rendered control surface</div>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight">A calmer operating posture.</h2>
                      <p className="mt-3 text-sm leading-7 text-foreground/62">
                        Less dashboard noise. More spatial hierarchy, live contract visibility, and direct action flow.
                      </p>
                    </div>
                    <div className="relative">
                      <div className="satin-grid absolute inset-0" />
                      <DepthOrbit />
                    </div>
                  </div>
                </div>

                <div className="lux-panel p-5">
                  <div className="micro-label">Operational sequence</div>
                  <div className="mt-4 space-y-3">
                    {[
                      'Connect the organization owner wallet.',
                      'Create a workspace and register agents.',
                      'Deploy the organization-specific contract stack.',
                      'Issue credentials, fund wallets, and open sessions.',
                    ].map((step, index) => (
                      <div key={step} className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white text-xs font-semibold text-background">
                          0{index + 1}
                        </div>
                        <div className="pt-1 text-sm leading-7 text-foreground/66">{step}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="halo-divider mt-10 pt-8">
              <SignalStrip items={signalItems} />
            </div>
          </div>
        </section>

        <section className="shell pb-10">
          <StackMetrics
            items={[
              { label: 'Agents', value: stats.totalAgents, detail: 'Connected to live workspaces' },
              { label: 'Sessions', value: stats.totalSessions, detail: 'Created through proof verification' },
              { label: 'Wallets', value: stats.totalWallets, detail: 'Deployed through AgentWalletFactory' },
              { label: 'Events', value: stats.recentEvents, detail: 'Indexed back into the platform' },
            ]}
          />
        </section>

        <section className="shell pb-12">
          <div className="grid gap-4 lg:grid-cols-3">
            {pillars.map(({ title, description, icon: Icon }) => (
              <SpotlightCard key={title} className="p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white text-background">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-foreground/62">{description}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>

        <section className="shell pb-20">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="hero-panel p-8">
              <div className="micro-label">Why the flow feels tight</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                A product surface shaped around trust, latency, and operator focus.
              </h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="metric-tile">
                  <div className="micro-label">Per-organization deployment</div>
                  <p className="mt-3 text-sm leading-7 text-foreground/62">
                    Registries, session managers, and wallet factories are isolated per organization to keep state and
                    operational load separated.
                  </p>
                </div>
                <div className="metric-tile">
                  <div className="micro-label">Continuous traceability</div>
                  <p className="mt-3 text-sm leading-7 text-foreground/62">
                    Sessions, wallet deployments, and contract events are pulled back into the platform with direct
                    explorer links for immediate auditability.
                  </p>
                </div>
              </div>
            </div>

            <div className="hero-panel p-8">
              <div className="micro-label">For infrastructure teams</div>
              <div className="mt-3 flex items-start gap-3">
                <Waves className="mt-1 h-5 w-5 text-foreground/55" />
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Self-host remains first-class.</h2>
                  <p className="mt-3 text-sm leading-7 text-foreground/62">
                    The platform is the default operator story. The SDK and self-hosted flow remain available for teams
                    that want to own orchestration, deployment, or custom proof pipelines.
                  </p>
                </div>
              </div>
              <Link href="/sdk" className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground">
                Open the SDK page
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
