"use client";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

interface MagneticButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary";
  onClick?: () => void;
  className?: string;
  href?: string;
}

export function MagneticButton({ children, variant = "primary", onClick, className, href }: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { damping: 15, stiffness: 150 });
  const springY = useSpring(y, { damping: 15, stiffness: 150 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left - rect.width / 2) * 0.2);
    y.set((e.clientY - rect.top - rect.height / 2) * 0.2);
  };

  const handleMouseLeave = () => { x.set(0); y.set(0); };
  const base = cn("relative inline-flex items-center justify-center px-8 py-4 rounded-lg font-semibold text-base transition-colors",
    variant === "primary" && "bg-white text-black hover:bg-zinc-200",
    variant === "secondary" && "border border-zinc-600 text-zinc-300 hover:border-white hover:text-white bg-transparent",
    className);
  const Component = href ? motion.a : motion.button;
  return <Component ref={ref as any} href={href} onClick={onClick} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{ x: springX, y: springY }} className={base} whileTap={{ scale: 0.98 }}>{children}</Component>;
}
