"use client";
import { motion } from "framer-motion";
import { AnimatedSection } from "@/components/ui/animated-section";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Shield, Clock, Wallet, Fingerprint } from "lucide-react";

const features = [
  { icon: Shield, title: "ZK-Proof Authentication", description: "Verify agent credentials without revealing sensitive data", large: true },
  { icon: Clock, title: "Session Management", description: "On-chain session tracking", large: false },
  { icon: Wallet, title: "Wallet Attestation", description: "Link wallets to agents", large: false },
  { icon: Fingerprint, title: "Identity Verification", description: "Decentralized identity for autonomous agents", large: true },
];

export function ProtocolGrid() {
  return (
    <section className="py-24 px-6 bg-black">
      <div className="max-w-6xl mx-auto">
        <AnimatedSection animation="fadeUp" className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">Protocol Infrastructure</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">Built for developers who need cryptographic guarantees without compromising privacy</p>
        </AnimatedSection>
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <motion.div key={feature.title} variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } } }} className={feature.large ? "md:col-span-1" : ""}>
              <SpotlightCard className="h-full p-6 md:p-8">
                <feature.icon className="w-8 h-8 text-white mb-4" strokeWidth={1.5} />
                <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-zinc-400">{feature.description}</p>
              </SpotlightCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
