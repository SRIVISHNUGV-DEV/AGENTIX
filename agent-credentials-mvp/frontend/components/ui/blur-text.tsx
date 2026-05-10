"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BlurTextProps { children: string; className?: string; delay?: number; as?: "h1" | "h2" | "h3" | "p" | "span"; }

export function BlurText({ children, className, delay = 0, as: Component = "h1" }: BlurTextProps) {
  return (
    <motion.div initial={{ opacity: 0, filter: "blur(20px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.8, delay, ease: [0.25, 0.46, 0.45, 0.94] }}>
      <Component className={className}>{children}</Component>
    </motion.div>
  );
}
