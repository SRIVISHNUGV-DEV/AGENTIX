"use client";
import { AnimatedSection } from "@/components/ui/animated-section";
import { MagneticButton } from "@/components/ui/magnetic-button";

export function CTASection() {
  return (
    <section className="relative py-32 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-black">
        <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(255,255,255,0.05) 0%, transparent 60%)" }} />
      </div>
      <div className="relative max-w-3xl mx-auto text-center">
        <AnimatedSection animation="fadeUp">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">Start building with Agentix</h2>
        </AnimatedSection>
        <AnimatedSection animation="fadeUp" delay={0.1}>
          <p className="text-zinc-400 text-lg mb-10 max-w-xl mx-auto">Join developers building the future of autonomous agent infrastructure. Free for development, scale with confidence.</p>
        </AnimatedSection>
        <AnimatedSection animation="fadeUp" delay={0.2}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <MagneticButton variant="primary" href="/dashboard">Get Started Free</MagneticButton>
            <MagneticButton variant="secondary" href="/docs">View Documentation</MagneticButton>
          </div>
        </AnimatedSection>
        <AnimatedSection animation="fadeIn" delay={0.3}>
          <p className="text-zinc-600 text-sm">Self-hosted. Open source. Production-ready.</p>
        </AnimatedSection>
      </div>
    </section>
  );
}
