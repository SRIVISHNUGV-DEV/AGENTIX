"use client";
import { motion } from "framer-motion";
import { AnimatedSection } from "@/components/ui/animated-section";
import { Lock, Zap, Check } from "lucide-react";

const steps = [
  { icon: Lock, title: "Private Inputs", description: "Original data never leaves the agent", color: "bg-zinc-800" },
  { icon: Zap, title: "ZK Proof Generation", description: "Cryptographic proof of authorization", color: "bg-zinc-700" },
  { icon: Check, title: "Verified Result", description: "Verifier learns nothing beyond validity", color: "bg-zinc-800" },
];

export function SecuritySection() {
  return (
    <section className="py-24 px-6 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        <AnimatedSection animation="fadeUp" className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">Zero-Knowledge by Design</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">Verify without exposing. Privacy-preserving credentials for regulated environments.</p>
        </AnimatedSection>
        <div className="relative">
          <div className="hidden md:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent -translate-y-1/2" />
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.2 } } }} className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <motion.div key={step.title} variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } } }} className="relative">
                <div className={`${step.color} rounded-xl p-8 border border-zinc-700 text-center relative z-10`}>
                  <div className="w-12 h-12 rounded-full bg-black/30 flex items-center justify-center mx-auto mb-4">
                    <step.icon className="w-6 h-6 text-white" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-zinc-400">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-px bg-zinc-600 -translate-y-1/2 z-20">
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t border-r border-zinc-600 transform rotate-45" />
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
