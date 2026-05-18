"use client";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

interface SpotlightCardProps { children: ReactNode; className?: string; }

export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const background = useMotionTemplate`radial-gradient(400px circle at ${mouseX}px ${mouseY}px, rgba(255,255,255,0.1), transparent 60%)`;

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  return (
    <motion.div ref={ref} onMouseMove={handleMouseMove} className={cn("relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition-transform duration-300 hover:scale-[1.02]", className)}>
      <motion.div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background }} />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
