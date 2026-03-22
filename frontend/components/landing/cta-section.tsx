'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function CTASection() {
  return (
    <section className="py-20 sm:py-28 bg-background border-t border-border/30">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-5xl sm:text-6xl font-bold text-foreground text-balance mb-6">
          Ready to get started?
        </h2>
        <p className="text-lg text-foreground/60 mb-10 max-w-2xl mx-auto">
          Deploy agent credentials in minutes. Secure, auditable, and built for production.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/dashboard">
            <Button size="lg" className="bg-foreground text-background hover:bg-foreground/90 px-8 h-11 font-medium">
              Enter Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/integration">
            <Button size="lg" variant="outline" className="px-8 h-11 font-medium border-foreground/20 hover:border-foreground/40">
              Learn More
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
