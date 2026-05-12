import Link from 'next/link'
import { ArrowRight, BookOpen, Code2, Cpu, ScrollText } from 'lucide-react'

const sections = [
  {
    icon: BookOpen,
    title: 'Workspace guide',
    description: 'Start from the dashboard, select an organization, create an agent, then use signed actions on the agent page.',
    href: '/dashboard',
  },
  {
    icon: Cpu,
    title: 'Runtime onboarding',
    description: 'Connect external runtimes and map them to protocol-native agents.',
    href: '/ai-agents',
  },
  {
    icon: ScrollText,
    title: 'Event history',
    description: 'Inspect indexed contract events, wallets, and sessions for the active organization.',
    href: '/events',
  },
  {
    icon: Code2,
    title: 'SDK and API surface',
    description: 'Review the current API endpoints and integration notes that match the running backend.',
    href: '/sdk',
  },
]

export const metadata = {
  title: 'Docs - Agentix',
  description: 'Current navigation and integration reference for the local Agentix workspace.',
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-semibold tracking-tight hover:text-zinc-300">Agentix</Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">Docs</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8">
          <h1 className="text-3xl font-semibold">Documentation</h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-400">
            This page now only links to routes that exist in the local app. The stale nested docs pages were removed from the flow.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {sections.map(({ icon: Icon, title, description, href }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800">
                  <Icon className="h-5 w-5 text-zinc-300" />
                </div>
                <div className="flex-1">
                  <h2 className="flex items-center gap-2 font-medium">
                    {title}
                    <ArrowRight className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-0.5" />
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500">{description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
