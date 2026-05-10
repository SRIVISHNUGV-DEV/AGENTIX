# Agentix Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Agentix landing page with cinematic full-bleed layout, Neural Coordination Core 3D hero, React Bits components, and pure monochrome Vercel/Linear aesthetic.

**Architecture:** Next.js 16 + TypeScript + Tailwind + Framer Motion + React Three Fiber. Modular landing components with shared animation utilities. 3D Neural Core using Three.js with instanced mesh for performance. React Bits patterns for scroll animations and micro-interactions.

**Tech Stack:** React 19, Next.js 16, TypeScript 5, Tailwind 4, Framer Motion 11, @react-three/fiber 9, @react-three/drei 10, Three.js 0.164

---

## File Structure Overview

```
frontend/
├── app/
│   ├── page.tsx                    # Landing page assembling sections (MODIFY)
│   ├── layout.tsx                  # Root layout with fonts (MODIFY)
│   └── globals.css                 # Global styles, CSS variables (MODIFY)
│
├── components/landing/
│   ├── hero-section.tsx            # Full-screen 3D hero with text overlay (CREATE)
│   ├── neural-core.tsx             # 3D Neural Coordination Core component (CREATE)
│   ├── protocol-grid.tsx           # Bento grid protocol explanation (CREATE)
│   ├── developer-section.tsx       # Code window + feature list (CREATE)
│   ├── platform-section.tsx        # Dashboard mockup + features (CREATE)
│   ├── security-section.tsx        # ZK flow visualization (CREATE)
│   ├── cta-section.tsx             # Final conversion CTA (CREATE)
│   └── footer-section.tsx          # Ultra-clean footer (CREATE)
│
├── components/ui/
│   ├── magnetic-button.tsx         # React Bits magnetic hover effect (CREATE)
│   ├── blur-text.tsx               # Blur-to-clear text reveal (CREATE)
│   ├── animated-section.tsx        # Scroll-triggered wrapper (CREATE)
│   ├── spotlight-card.tsx          # Hover spotlight effect (CREATE)
│   └── code-window.tsx             # macOS-style terminal (CREATE)
│
├── lib/
│   ├── animations.ts               # Shared animation configs (CREATE)
│   └── utils.ts                    # Existing cn() utility (EXISTING)
│
└── public/
    └── (no new assets needed - pure CSS/3D)
```

---

## Pre-Implementation: Environment Setup

### Task 0: Install Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add animation and 3D dependencies**

```bash
cd D:/BLOCKCHAIN\ AND\ ZK\ PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend
npm install framer-motion three @react-three/fiber @react-three/drei
npm install -D @types/three
```

- [ ] **Step 2: Verify installations**

Run: `npm list framer-motion three @react-three/fiber`
Expected: All packages show installed versions

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "deps: add framer-motion, three, r3f for 3D animations"
```

---

## Phase 1: Foundation Components

### Task 1: Animation Utilities

**Files:**
- Create: `frontend/lib/animations.ts`

**Purpose:** Centralized animation configuration reused across all landing components

- [ ] **Step 1: Create animation utilities file**

```typescript
// frontend/lib/animations.ts
export const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const slideLeft = {
  hidden: { opacity: 0, x: 60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const slideRight = {
  hidden: { opacity: 0, x: -60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const blurReveal = {
  hidden: { opacity: 0, filter: "blur(20px)" },
  visible: {
    opacity: 1,
    filter: "blur(0px)",
    transition: {
      duration: 0.8,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

// Timing constants
export const TIMING = {
  micro: 0.2,
  standard: 0.4,
  dramatic: 0.8,
  stagger: 0.1,
};

// Easing
export const EASE_OUT_QUAD = [0.25, 0.46, 0.45, 0.94];
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/animations.ts
git commit -m "feat: add shared animation utilities"
```

---

### Task 2: Animated Section Wrapper

**Files:**
- Create: `frontend/components/ui/animated-section.tsx`

**Purpose:** Reusable scroll-triggered animation wrapper

- [ ] **Step 1: Create animated section component**

```typescript
// frontend/components/ui/animated-section.tsx
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

const animations: Record<AnimationType, Variants> = {
  fadeUp,
  fadeIn,
  slideLeft,
  slideRight,
};

export function AnimatedSection({
  children,
  animation = "fadeUp",
  delay = 0,
  className = "",
  once = true,
}: AnimatedSectionProps) {
  const selectedAnimation = animations[animation];

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.2 }}
      variants={{
        hidden: selectedAnimation.hidden,
        visible: {
          ...selectedAnimation.visible,
          transition: {
            ...((selectedAnimation.visible as { transition?: object }).transition || {}),
            delay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ui/animated-section.tsx
git commit -m "feat: add animated-section wrapper component"
```

---

### Task 3: Magnetic Button

**Files:**
- Create: `frontend/components/ui/magnetic-button.tsx`

**Purpose:** Button with magnetic hover effect (React Bits pattern)

- [ ] **Step 1: Create magnetic button component**

```typescript
// frontend/components/ui/magnetic-button.tsx
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

export function MagneticButton({
  children,
  variant = "primary",
  onClick,
  className,
  href,
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 15, stiffness: 150 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const distanceX = e.clientX - centerX;
    const distanceY = e.clientY - centerY;

    x.set(distanceX * 0.2);
    y.set(distanceY * 0.2);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const baseStyles = cn(
    "relative inline-flex items-center justify-center px-8 py-4 rounded-lg font-semibold text-base transition-colors",
    variant === "primary" && "bg-white text-black hover:bg-zinc-200",
    variant === "secondary" && "border border-zinc-600 text-zinc-300 hover:border-white hover:text-white bg-transparent",
    className
  );

  const Component = href ? motion.a : motion.button;

  return (
    <Component
      ref={ref as any}
      href={href}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      className={baseStyles}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </Component>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ui/magnetic-button.tsx
git commit -m "feat: add magnetic-button with hover effect"
```

---

### Task 4: Blur Text Component

**Files:**
- Create: `frontend/components/ui/blur-text.tsx`

**Purpose:** Text that animates from blur to clear

- [ ] **Step 1: Create blur-text component**

```typescript
// frontend/components/ui/blur-text.tsx
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BlurTextProps {
  children: string;
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
}

export function BlurText({
  children,
  className,
  delay = 0,
  as: Component = "h1",
}: BlurTextProps) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(20px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{
        duration: 0.8,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      <Component className={className}>{children}</Component>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ui/blur-text.tsx
git commit -m "feat: add blur-text reveal animation"
```

---

### Task 5: Spotlight Card

**Files:**
- Create: `frontend/components/ui/spotlight-card.tsx`

**Purpose:** Card with mouse-following spotlight effect

- [ ] **Step 1: Create spotlight card component**

```typescript
// frontend/components/ui/spotlight-card.tsx
"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

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
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition-transform duration-300 hover:scale-[1.02]",
        className
      )}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ui/spotlight-card.tsx
git commit -m "feat: add spotlight-card hover effect"
```

---

### Task 6: Code Window

**Files:**
- Create: `frontend/components/ui/code-window.tsx`

**Purpose:** macOS-style code terminal window

- [ ] **Step 1: Create code-window component**

```typescript
// frontend/components/ui/code-window.tsx
"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CodeWindowProps {
  filename: string;
  code: string;
  className?: string;
  typingEffect?: boolean;
}

export function CodeWindow({
  filename,
  code,
  className,
  typingEffect = true,
}: CodeWindowProps) {
  const [displayedCode, setDisplayedCode] = useState(typingEffect ? "" : code);

  useEffect(() => {
    if (!typingEffect) return;

    let index = 0;
    const timer = setInterval(() => {
      if (index <= code.length) {
        setDisplayedCode(code.slice(0, index));
        index++;
      } else {
        clearInterval(timer);
      }
    }, 15);

    return () => clearInterval(timer);
  }, [code, typingEffect]);

  // Simple syntax highlighting
  const highlightedCode = displayedCode
    .replace(/(\/\/.*$)/gm, '<span class="text-zinc-500">$1</span>')
    .replace(/\b(import|from|const|await|return)\b/g, '<span class="text-purple-400">$1</span>')
    .replace(/\b(true|false|null|undefined)\b/g, '<span class="text-orange-400">$1</span>')
    .replace(/('.*?'|".*?"|`.*?`)/g, '<span class="text-green-400">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>')
    .replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="text-yellow-400">$1</span>')
    .replace(/\b([a-z][a-zA-Z0-9]*)\s*(?=\()/g, '<span class="text-blue-400">$1</span>');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className={cn(
        "rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 font-mono text-sm",
        className
      )}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="w-3 h-3 rounded-full bg-red-500/20" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
        <div className="w-3 h-3 rounded-full bg-green-500/20" />
        <span className="ml-4 text-xs text-zinc-600">{filename}</span>
      </div>

      {/* Code content */}
      <div className="p-4 overflow-x-auto">
        <pre className="text-zinc-300 leading-relaxed">
          <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          {typingEffect && displayedCode.length < code.length && (
            <span className="inline-block w-2 h-4 bg-zinc-500 ml-0.5 animate-pulse" />
          )}
        </pre>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ui/code-window.tsx
git commit -m "feat: add code-window component with typing effect"
```

---

## Phase 2: 3D Neural Coordination Core

### Task 7: Neural Core Component

**Files:**
- Create: `frontend/components/landing/neural-core.tsx`

**Purpose:** Interactive 3D sphere of interconnected nodes representing agent coordination

- [ ] **Step 1: Create neural-core component**

```typescript
// frontend/components/landing/neural-core.tsx
"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

interface NeuralCoreProps {
  nodeCount?: number;
  className?: string;
}

function NeuralSphere({ nodeCount = 64 }: { nodeCount?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const [hovered, setHovered] = useState(false);

  // Generate sphere points using Fibonacci sphere algorithm
  const { positions, connections } = useMemo(() => {
    const positions: number[] = [];
    const connections: number[] = [];
    const points: THREE.Vector3[] = [];

    const phi = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < nodeCount; i++) {
      const y = 1 - (i / (nodeCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;

      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;

      positions.push(x * 2, y * 2, z * 2);
      points.push(new THREE.Vector3(x * 2, y * 2, z * 2));
    }

    // Create connections between nearby points
    const connectionDistance = 2.5;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dist = points[i].distanceTo(points[j]);
        if (dist < connectionDistance) {
          connections.push(
            points[i].x, points[i].y, points[i].z,
            points[j].x, points[j].y, points[j].z
          );
        }
      }
    }

    return { positions: new Float32Array(positions), connections: new Float32Array(connections) };
  }, [nodeCount]);

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(connections, 3));
    return geometry;
  }, [connections]);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.001;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
    if (linesRef.current) {
      linesRef.current.rotation.y += 0.001;
      linesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
  });

  return (
    <group>
      {/* Connection lines */}
      <lineSegments ref={linesRef} geometry={lineGeometry}>
        <lineBasicMaterial color="#333333" transparent opacity={0.3} />
      </lineSegments>

      {/* Nodes */}
      <Points
        ref={pointsRef}
        positions={positions}
        stride={3}
        frustumCulled={false}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <PointMaterial
          transparent
          color={hovered ? "#ffffff" : "#888888"}
          size={0.08}
          sizeAttenuation={true}
          depthWrite={false}
          opacity={0.9}
        />
      </Points>

      {/* Center glow */}
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshBasicMaterial color="#222222" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#ffffff" />
      <NeuralSphere nodeCount={80} />
    </>
  );
}

export function NeuralCore({ nodeCount = 64, className }: NeuralCoreProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/neural-core.tsx
git commit -m "feat: add 3D neural-core component with connected nodes"
```

---

## Phase 3: Landing Sections

### Task 8: Hero Section

**Files:**
- Create: `frontend/components/landing/hero-section.tsx`

**Purpose:** Full-screen hero with 3D Neural Core and centered text overlay

- [ ] **Step 1: Create hero-section component**

```typescript
// frontend/components/landing/hero-section.tsx
"use client";

import { motion } from "framer-motion";
import { NeuralCore } from "./neural-core";
import { MagneticButton } from "@/components/ui/magnetic-button";
import { BlurText } from "@/components/ui/blur-text";
import { ChevronDown } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      {/* Grid background */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      {/* 3D Neural Core */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] md:w-[800px] md:h-[800px]">
          <NeuralCore />
        </div>
      </div>

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50" />

      {/* Content overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-4xl mx-auto">
          <BlurText
            as="h1"
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-6"
            delay={0.2}
          >
            Zero-Knowledge Credentials
          </BlurText>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-lg sm:text-xl md:text-2xl text-zinc-400 mb-10 max-w-2xl mx-auto"
          >
            Private agent identity infrastructure for the autonomous economy
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <MagneticButton variant="primary" href="/dashboard">
              Get Started
            </MagneticButton>
            <MagneticButton variant="secondary" href="/docs">
              View Documentation
            </MagneticButton>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2"
        >
          <span className="text-xs text-zinc-600 uppercase tracking-wider">Scroll</span>
          <ChevronDown className="w-5 h-5 text-zinc-600" />
        </motion.div>
      </motion.div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/hero-section.tsx
git commit -m "feat: add hero-section with 3D neural core"
```

---

### Task 9: Protocol Grid Section

**Files:**
- Create: `frontend/components/landing/protocol-grid.tsx`

**Purpose:** Bento grid explaining the core protocol features

- [ ] **Step 1: Create protocol-grid component**

```typescript
// frontend/components/landing/protocol-grid.tsx
"use client";

import { motion } from "framer-motion";
import { AnimatedSection } from "@/components/ui/animated-section";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Shield, Clock, Wallet, Fingerprint } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "ZK-Proof Authentication",
    description: "Verify agent credentials without revealing sensitive data",
    large: true,
  },
  {
    icon: Clock,
    title: "Session Management",
    description: "On-chain session tracking",
    large: false,
  },
  {
    icon: Wallet,
    title: "Wallet Attestation",
    description: "Link wallets to agents",
    large: false,
  },
  {
    icon: Fingerprint,
    title: "Identity Verification",
    description: "Decentralized identity for autonomous agents",
    large: true,
  },
];

export function ProtocolGrid() {
  return (
    <section className="py-24 px-6 bg-black">
      <div className="max-w-6xl mx-auto">
        <AnimatedSection animation="fadeUp" className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
            Protocol Infrastructure
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Built for developers who need cryptographic guarantees without compromising privacy
          </p>
        </AnimatedSection>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.1 },
            },
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              variants={{
                hidden: { opacity: 0, y: 30 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
                },
              }}
              className={feature.large ? "md:col-span-1" : ""}
            >
              <SpotlightCard className="h-full p-6 md:p-8">
                <feature.icon className="w-8 h-8 text-white mb-4" strokeWidth={1.5} />
                <h3 className="text-xl font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-zinc-400">
                  {feature.description}
                </p>
              </SpotlightCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/protocol-grid.tsx
git commit -m "feat: add protocol-grid bento section"
```

---

### Task 10: Developer Section

**Files:**
- Create: `frontend/components/landing/developer-section.tsx`

**Purpose:** Showcase SDK integration with code window

- [ ] **Step 1: Create developer-section component**

```typescript
// frontend/components/landing/developer-section.tsx
"use client";

import { AnimatedSection } from "@/components/ui/animated-section";
import { CodeWindow } from "@/components/ui/code-window";
import { Code2, Layers, Zap, Radio } from "lucide-react";

const features = [
  { icon: Code2, text: "TypeScript SDK with full type safety" },
  { icon: Layers, text: "React hooks for agent authentication" },
  { icon: Zap, text: "RESTful API with OpenAPI spec" },
  { icon: Radio, text: "WebSocket support for real-time updates" },
];

const exampleCode = `// Initialize Agentix SDK
import { AgentixSDK } from '@agentix/sdk'

const agent = await AgentixSDK.create({
  apiKey: 'ax_live_...',
  environment: 'production'
})

// Issue credentials with ZK proofs
const credential = await agent.credentials.issue({
  agentId: 'agent-123',
  permissions: ['read:users', 'write:logs']
})

// Verify proof without revealing data
const isValid = await agent.credentials.verify(credential)
console.log('Credential valid:', isValid) // true`;

export function DeveloperSection() {
  return (
    <section className="py-24 px-6 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text content */}
          <AnimatedSection animation="slideRight">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
              Integrate in minutes
            </h2>
            <p className="text-zinc-400 text-lg mb-8">
              Self-hosted SDK with TypeScript support. Drop-in integration for your existing agent infrastructure.
            </p>

            <ul className="space-y-4">
              {features.map((feature) => (
                <li key={feature.text} className="flex items-center gap-3">
                  <feature.icon className="w-5 h-5 text-white" strokeWidth={1.5} />
                  <span className="text-zinc-300">{feature.text}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>

          {/* Code window */}
          <AnimatedSection animation="slideLeft" delay={0.2}>
            <CodeWindow
              filename="agent-auth.ts"
              code={exampleCode}
              typingEffect={true}
            />
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/developer-section.tsx
git commit -m "feat: add developer-section with code window"
```

---

### Task 11: Platform Section

**Files:**
- Create: `frontend/components/landing/platform-section.tsx`

**Purpose:** Showcase dashboard for operators

- [ ] **Step 1: Create platform-section component**

```typescript
// frontend/components/landing/platform-section.tsx
"use client";

import { motion } from "framer-motion";
import { AnimatedSection } from "@/components/ui/animated-section";
import { Activity, Key, History, Users } from "lucide-react";

const features = [
  { icon: Activity, text: "Real-time agent status monitoring" },
  { icon: Key, text: "One-click credential issuance" },
  { icon: History, text: "Session audit trails" },
  { icon: Users, text: "Team collaboration features" },
];

const agents = [
  { name: "agent-billing-01", status: "online" },
  { name: "agent-analytics-02", status: "online" },
  { name: "agent-support-03", status: "idle" },
];

function DashboardMockup() {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-white font-semibold">Agents</h3>
        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">24 active</span>
      </div>

      {/* Agent list */}
      <div className="space-y-3">
        {agents.map((agent, index) => (
          <motion.div
            key={agent.name}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center justify-between p-3 bg-black/50 rounded-lg"
          >
            <span className="text-sm text-zinc-300 font-mono">{agent.name}</span>
            <div className="flex items-center gap-2">
              {agent.status === "online" ? (
                <>
                  <motion.span
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-green-500"
                  />
                  <span className="text-xs text-green-500">Online</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span className="text-xs text-zinc-500">Idle</span>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function PlatformSection() {
  return (
    <section className="py-24 px-6 bg-black">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Dashboard mockup - reversed order on desktop */}
          <AnimatedSection animation="slideRight" className="order-2 lg:order-1">
            <DashboardMockup />
          </AnimatedSection>

          {/* Text content */}
          <AnimatedSection animation="slideLeft" delay={0.2} className="order-1 lg:order-2">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
              Manage your agent fleet
            </h2>
            <p className="text-zinc-400 text-lg mb-8">
              Browser-based dashboard for operators. Monitor agent status, issue credentials, and audit sessions without writing code.
            </p>

            <ul className="space-y-4">
              {features.map((feature) => (
                <li key={feature.text} className="flex items-center gap-3">
                  <feature.icon className="w-5 h-5 text-white" strokeWidth={1.5} />
                  <span className="text-zinc-300">{feature.text}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/platform-section.tsx
git commit -m "feat: add platform-section with dashboard mockup"
```

---

### Task 12: Security Section

**Files:**
- Create: `frontend/components/landing/security-section.tsx`

**Purpose:** Visualize ZK-proof flow

- [ ] **Step 1: Create security-section component**

```typescript
// frontend/components/landing/security-section.tsx
"use client";

import { motion } from "framer-motion";
import { AnimatedSection } from "@/components/ui/animated-section";
import { Lock, Zap, Check } from "lucide-react";

const steps = [
  {
    icon: Lock,
    title: "Private Inputs",
    description: "Original data never leaves the agent",
    color: "bg-zinc-800",
  },
  {
    icon: Zap,
    title: "ZK Proof Generation",
    description: "Cryptographic proof of authorization",
    color: "bg-zinc-700",
  },
  {
    icon: Check,
    title: "Verified Result",
    description: "Verifier learns nothing beyond validity",
    color: "bg-zinc-800",
  },
];

export function SecuritySection() {
  return (
    <section className="py-24 px-6 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        <AnimatedSection animation="fadeUp" className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
            Zero-Knowledge by Design
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Verify without exposing. Privacy-preserving credentials for regulated environments.
          </p>
        </AnimatedSection>

        {/* Flow diagram */}
        <div className="relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent -translate-y-1/2" />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.2 },
              },
            }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                variants={{
                  hidden: { opacity: 0, y: 30 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
                  },
                }}
                className="relative"
              >
                <div
                  className={`${step.color} rounded-xl p-8 border border-zinc-700 text-center relative z-10`}
                >
                  <div className="w-12 h-12 rounded-full bg-black/30 flex items-center justify-center mx-auto mb-4">
                    <step.icon className="w-6 h-6 text-white" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-zinc-400">{step.description}</p>
                </div>

                {/* Arrow connector (desktop) */}
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/security-section.tsx
git commit -m "feat: add security-section with ZK flow visualization"
```

---

### Task 13: CTA Section

**Files:**
- Create: `frontend/components/landing/cta-section.tsx`

**Purpose:** Final conversion section

- [ ] **Step 1: Create cta-section component**

```typescript
// frontend/components/landing/cta-section.tsx
"use client";

import { AnimatedSection } from "@/components/ui/animated-section";
import { MagneticButton } from "@/components/ui/magnetic-button";

export function CTASection() {
  return (
    <section className="relative py-32 px-6 overflow-hidden">
      {/* Radial gradient background */}
      <div className="absolute inset-0 bg-black">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(255,255,255,0.05) 0%, transparent 60%)",
          }}
        />
      </div>

      <div className="relative max-w-3xl mx-auto text-center">
        <AnimatedSection animation="fadeUp">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            Start building with Agentix
          </h2>
        </AnimatedSection>

        <AnimatedSection animation="fadeUp" delay={0.1}>
          <p className="text-zinc-400 text-lg mb-10 max-w-xl mx-auto">
            Join developers building the future of autonomous agent infrastructure. Free for development, scale with confidence.
          </p>
        </AnimatedSection>

        <AnimatedSection animation="fadeUp" delay={0.2}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <MagneticButton variant="primary" href="/dashboard">
              Get Started Free
            </MagneticButton>
            <MagneticButton variant="secondary" href="/docs">
              View Documentation
            </MagneticButton>
          </div>
        </AnimatedSection>

        <AnimatedSection animation="fadeIn" delay={0.3}>
          <p className="text-zinc-600 text-sm">
            Self-hosted. Open source. Production-ready.
          </p>
        </AnimatedSection>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/cta-section.tsx
git commit -m "feat: add cta-section final conversion"
```

---

### Task 14: Footer Section

**Files:**
- Create: `frontend/components/landing/footer-section.tsx`

**Purpose:** Ultra-clean footer

- [ ] **Step 1: Create footer-section component**

```typescript
// frontend/components/landing/footer-section.tsx
const footerLinks = {
  Product: [
    { name: "Documentation", href: "/docs" },
    { name: "SDK", href: "/docs/sdk" },
    { name: "Dashboard", href: "/dashboard" },
    { name: "Pricing", href: "/pricing" },
  ],
  Resources: [
    { name: "GitHub", href: "https://github.com/agentix" },
    { name: "Examples", href: "/examples" },
    { name: "Blog", href: "/blog" },
    { name: "Support", href: "/support" },
  ],
  Legal: [
    { name: "Privacy", href: "/privacy" },
    { name: "Terms", href: "/terms" },
    { name: "Security", href: "/security" },
  ],
};

export function FooterSection() {
  return (
    <footer className="py-16 px-6 bg-black border-t border-zinc-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between gap-12">
          {/* Brand */}
          <div className="md:max-w-xs">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full" />
              </div>
              <span className="text-xl font-bold text-white">Agentix</span>
            </div>
            <p className="text-zinc-500 text-sm">
              Zero-knowledge credentials for autonomous agent infrastructure.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-12 md:gap-16">
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-zinc-400 mb-4">
                  {category}
                </h4>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-sm text-zinc-500 hover:text-white transition-colors"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-zinc-900 flex flex-col sm:flex-row justify-between items-center gap-4">
          <span className="text-xs text-zinc-600">
            © 2026 Agentix Protocol
          </span>
          <span className="text-xs text-zinc-600">
            Built for the autonomous economy
          </span>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/landing/footer-section.tsx
git commit -m "feat: add footer-section"
```

---

## Phase 4: Integration

### Task 15: Update Main Landing Page

**Files:**
- Modify: `frontend/app/page.tsx`

**Purpose:** Assemble all sections into unified landing page

- [ ] **Step 1: Read current page.tsx**

```bash
cat D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/app/page.tsx
```

- [ ] **Step 2: Replace page.tsx with new landing page**

```typescript
// frontend/app/page.tsx
import { HeroSection } from "@/components/landing/hero-section";
import { ProtocolGrid } from "@/components/landing/protocol-grid";
import { DeveloperSection } from "@/components/landing/developer-section";
import { PlatformSection } from "@/components/landing/platform-section";
import { SecuritySection } from "@/components/landing/security-section";
import { CTASection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export default function Home() {
  return (
    <main className="min-h-screen bg-black">
      <HeroSection />
      <ProtocolGrid />
      <DeveloperSection />
      <PlatformSection />
      <SecuritySection />
      <CTASection />
      <FooterSection />
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: update main page with redesigned landing sections"
```

---

### Task 16: Update Layout

**Files:**
- Modify: `frontend/app/layout.tsx`

**Purpose:** Ensure proper metadata and smooth scroll

- [ ] **Step 1: Read current layout.tsx**

```bash
cat D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/app/layout.tsx
```

- [ ] **Step 2: Update layout.tsx with improved metadata**

Add to metadata object:
```typescript
export const metadata: Metadata = {
  title: "Agentix - Zero-Knowledge Credentials for Autonomous Agents",
  description:
    "Private agent identity infrastructure for the autonomous economy. Issue verifiable credentials without revealing sensitive data.",
  keywords: [
    "zero-knowledge",
    "credentials",
    "autonomous agents",
    "blockchain",
    "ZK proofs",
  ],
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: update layout metadata for new landing page"
```

---

### Task 17: Update Global CSS

**Files:**
- Modify: `frontend/app/globals.css`

**Purpose:** Add smooth scroll and fine-tune base styles

- [ ] **Step 1: Read current globals.css**

```bash
cat D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/app/globals.css | head -50
```

- [ ] **Step 2: Add smooth scroll if not present**

At the top of globals.css, add:
```css
html {
  scroll-behavior: smooth;
}

/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: add smooth scroll and reduced motion support"
```

---

## Phase 5: Testing & Verification

### Task 18: Type Check

**Files:** None (verification step)

- [ ] **Step 1: Run TypeScript check**

```bash
cd D:/BLOCKCHAIN\ AND\ ZK\ PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend
npx tsc --noEmit
```

Expected: No TypeScript errors

---

### Task 19: Build Check

**Files:** None (verification step)

- [ ] **Step 1: Run Next.js build**

```bash
cd D:/BLOCKCHAIN\ AND\ ZK\ PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend
npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 2: Commit if build passes**

```bash
git commit -m "chore: verify build passes for redesigned landing"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Verify all components exist**

```bash
ls -la D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/components/landing/
ls -la D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/components/ui/
ls -la D:/BLOCKCHAIN/AND/ZK/PROJECTS/AGENT_CREDENTIAL/agent-credentials-mvp/frontend/lib/
```

Expected files:
- landing/: hero-section.tsx, neural-core.tsx, protocol-grid.tsx, developer-section.tsx, platform-section.tsx, security-section.tsx, cta-section.tsx, footer-section.tsx
- ui/: animated-section.tsx, magnetic-button.tsx, blur-text.tsx, spotlight-card.tsx, code-window.tsx
- lib/: animations.ts (plus existing utils.ts)

---

## Spec Coverage Checklist

| Spec Requirement | Implementation Task |
|-----------------|---------------------|
| Cinematic full-bleed hero | Task 8 |
| Neural Coordination Core 3D | Task 7 |
| Pure monochrome palette | All tasks (bg-black, text-white) |
| Protocol bento grid | Task 9 |
| Developer path (code window) | Task 10 |
| Platform path (dashboard) | Task 11 |
| ZK flow visualization | Task 12 |
| Final CTA | Task 13 |
| Ultra-clean footer | Task 14 |
| Magnetic buttons | Task 3 |
| Blur text reveal | Task 4 |
| Spotlight cards | Task 5 |
| Scroll animations | Task 2 |
| Smooth scroll | Task 17 |
| Reduced motion support | Task 17 |

---

## Completion Summary

After completing all tasks:

1. Run dev server: `npm run dev`
2. Navigate to http://localhost:3000
3. Verify:
   - Hero 3D scene renders
   - Scroll reveals sections
   - Buttons have magnetic hover
   - Code window shows typing animation
   - Dashboard mockup shows pulsing status
   - Mobile responsive layout
   - No console errors

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-agentix-landing-redesign.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you like to use?