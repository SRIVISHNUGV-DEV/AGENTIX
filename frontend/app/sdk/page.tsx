import Header from '@/components/header'
import Footer from '@/components/footer'
import { GridBackdrop } from '@/components/effects/grid-backdrop'
import { SpotlightCard } from '@/components/effects/spotlight-card'
import { CodeBlock } from '@/components/common/code-block'

export const metadata = {
  title: 'SDK & Self-host - Agent Credentials',
  description: 'Use the SDK and self-hosted flow if you want to run the platform in your own environment.',
}

const quickstart = `import { AgentClient } from "@agent-credentials/sdk"

const client = new AgentClient("http://127.0.0.1:3000")
await client.init()

const registration = await client.registerAgent({
  orgName: "Acme Treasury",
  agentName: "Payout Agent",
  permissions: 7,
  expiry: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14
})

await client.createWallet({ agentId: registration.agentId })

const session = await client.createSession({ agentId: registration.agentId })
const state = await client.getAgentState(registration.agentId)

console.log({ registration, session, state })`

const endpoints = [
  ['POST', '/v1/agents/provision', 'Create an organization + agent in one call.'],
  ['POST', '/credentials', 'Register a credential commitment and update the active root.'],
  ['GET', '/proofs/:agentId', 'Get Merkle and revocation proof data.'],
  ['POST', '/wallets', 'Deploy an AgentWallet for the selected agent.'],
  ['POST', '/sessions', 'Submit the zk proof to create an on-chain session.'],
  ['POST', '/credentials/revoke', 'Revoke credential/session creation rights.'],
  ['GET', '/events', 'Read indexed contract events.'],
]

export default function SDKPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <GridBackdrop />
      <Header />
      <main className="relative z-10">
        <section className="shell py-16 sm:py-20">
          <span className="section-kicker">Self-host path</span>
          <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] sm:text-6xl">
             SDK for teams that want to run the platform in their own stack.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-foreground/66">
            The platform remains the default product framing. This page exists for infrastructure teams that want direct backend and SDK control, custom orchestration, or private deployments.
          </p>
        </section>

        <section className="shell grid gap-6 pb-10 lg:grid-cols-[1fr_1fr]">
          <SpotlightCard className="p-6">
            <div id="quickstart">
              <p className="text-xs uppercase tracking-[0.22em] text-accent">Quickstart</p>
              <h2 className="mt-2 text-2xl font-semibold">One SDK flow</h2>
            </div>
            <div className="mt-6">
              <CodeBlock code={quickstart} language="typescript" />
            </div>
          </SpotlightCard>

          <SpotlightCard className="p-6">
            <div id="endpoints">
              <p className="text-xs uppercase tracking-[0.22em] text-accent">Endpoints</p>
              <h2 className="mt-2 text-2xl font-semibold">What the SDK hits</h2>
            </div>
            <div className="mt-6 space-y-3">
              {endpoints.map(([method, path, description]) => (
                <div key={path} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-white/10 bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
                      {method}
                    </span>
                    <code className="text-sm text-foreground">{path}</code>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-foreground/63">{description}</p>
                </div>
              ))}
            </div>
          </SpotlightCard>
        </section>
      </main>
      <Footer />
    </div>
  )
}
