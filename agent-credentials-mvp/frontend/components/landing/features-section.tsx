'use client'

import { ShieldCheck, Zap, Wallet, Lock, Eye, GitBranch } from 'lucide-react'

const features = [
  {
    icon: ShieldCheck,
    title: 'Zero-Knowledge Proofs',
    description: 'Prove agent authorization without revealing private credentials.',
  },
  {
    icon: Wallet,
    title: 'Multi-Chain Support',
    description: 'Manage wallets across Ethereum, Polygon, Arbitrum, and Base.',
  },
  {
    icon: Zap,
    title: 'Session Management',
    description: 'Time-limited, revocable sessions for transaction signing.',
  },
  {
    icon: Lock,
    title: 'Automatic Rotation',
    description: 'Credential rotation and expiration policies built-in.',
  },
  {
    icon: Eye,
    title: 'Full Audit Trail',
    description: 'Complete event logs of all agent actions with on-chain verification.',
  },
  {
    icon: GitBranch,
    title: 'Developer API',
    description: 'Simple REST API and TypeScript SDK. Integrate in minutes.',
  },
]

export function FeaturesSection() {
  return (
    <section className="py-24 bg-background border-b border-border/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-20">
          <h2 className="text-5xl sm:text-6xl font-bold text-foreground mb-6 text-balance">
            Enterprise Security
          </h2>
          <p className="text-lg text-foreground/60 max-w-2xl mx-auto">
            Everything needed to safely authorize AI agents in production
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(feature => {
            const Icon = feature.icon
            return (
              <div key={feature.title} className="p-6 border border-border/30 hover:border-foreground/20 rounded-lg transition-colors group">
                <Icon className="h-5 w-5 text-foreground mb-4" />
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-foreground/60 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
