"use client";
import { motion, Variants } from "framer-motion";
import { ReactNode } from "react";
import { fadeUp, fadeIn, slideLeft, slideRight } from "@/lib/animations";

type AnimationType = "fadeUp" | "fadeIn" | "slideLeft" | "slideRight";

interface AnimatedSectionProps {
  children: ReactNode;
  animation?: AnimationType;
  delay?: number;
  className?: string;
  once?: boolean;
}

const animations: Record<AnimationType, Variants> = { fadeUp, fadeIn, slideLeft, slideRight };

export function AnimatedSection({ children, animation = "fadeUp", delay = 0, className = "", once = true }: AnimatedSectionProps) {
  const selected = animations[animation];
  return (
    <motion.div initial="hidden" whileInView="visible" viewport={{ once, amount: 0.2 }} variants={{
      hidden: selected.hidden,
      visible: { ...selected.visible, transition: { ...((selected.visible as { transition?: object }).transition || {}), delay } }
    }} className={className}>
      {children}
    </motion.div>
  );
}
