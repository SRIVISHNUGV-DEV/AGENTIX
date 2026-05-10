"use client";
import { motion } from "framer-motion";
import { NeuralCore } from "./neural-core";
import { MagneticButton } from "@/components/ui/magnetic-button";
import { BlurText } from "@/components/ui/blur-text";
import { ChevronDown } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`, backgroundSize: "50px 50px" }} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] md:w-[800px] md:h-[800px]"><NeuralCore /></div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-4xl mx-auto">
          <BlurText as="h1" className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-6" delay={0.2}>Zero-Knowledge Credentials</BlurText>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.5 }} className="text-lg sm:text-xl md:text-2xl text-zinc-400 mb-10 max-w-2xl mx-auto">Private agent identity infrastructure for the autonomous economy</motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.7 }} className="flex flex-col sm:flex-row gap-4 justify-center">
            <MagneticButton variant="primary" href="/dashboard">Get Started</MagneticButton>
            <MagneticButton variant="secondary" href="/docs">View Documentation</MagneticButton>
          </motion.div>
        </div>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} className="flex flex-col items-center gap-2">
          <span className="text-xs text-zinc-600 uppercase tracking-wider">Scroll</span>
          <ChevronDown className="w-5 h-5 text-zinc-600" />
        </motion.div>
      </motion.div>
    </section>
  );
}
