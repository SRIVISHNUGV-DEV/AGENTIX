'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function HeroSection() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 20% 50%, rgba(0,0,0,0.02) 0%, transparent 50%)',
      }} />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-20">
        <div className="mb-8 flex justify-center">
          <span className="text-xs font-medium tracking-widest text-foreground/60 uppercase">Secure Agent Authorization</span>
        </div>

        <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight text-foreground mb-6 text-balance leading-tight">
          AI Agent Credentials
        </h1>

        <p className="text-lg sm:text-xl text-foreground/70 mb-12 max-w-3xl mx-auto text-balance leading-relaxed">
          Authorize AI agents to sign transactions without exposing credentials. Built on zero-knowledge proofs for enterprise security.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-20">
          <Link href="/dashboard">
            <Button size="lg" className="bg-foreground text-background hover:bg-foreground/90 px-8 h-11 font-medium">
              Dashboard
            </Button>
          </Link>
          <Link href="/integration">
            <Button size="lg" variant="outline" className="px-8 h-11 font-medium border-foreground/20 hover:border-foreground/40">
              Documentation
            </Button>
          </Link>
        </div>

        <div className="mt-16 pt-12 border-t border-border">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {[
              { number: '256-bit', label: 'Encryption' },
              { number: 'Multi', label: 'Chain' },
              { number: 'Session', label: 'Control' },
              { number: '100%', label: 'Audit' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-foreground mb-1">{item.number}</div>
                <div className="text-xs text-foreground/60 uppercase tracking-widest">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
