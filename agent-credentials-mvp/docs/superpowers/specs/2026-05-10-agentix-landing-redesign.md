# Agentix Landing Page Redesign Specification

**Date:** 2026-05-10  
**Status:** Approved for Implementation  
**Approach:** Cinematic Full-Bleed with Neural Coordination Core 3D Hero  

---

## Executive Summary

This specification defines a complete redesign of the Agentix landing page to world-class standards comparable to Vercel, Linear, and modern AI infrastructure platforms. The design emphasizes pure black/white aesthetics, cinematic 3D hero experience, and clear dual-path messaging (Developer SDK + Platform).

---

## Design Philosophy

### Aesthetic Principles
- **Pure Monochrome:** #000000, #0A0A0A, #111111, #FFFFFF, #E5E5E5, #888888
- **Aggressive Whitespace:** Room for content to breathe
- **Strong Typography Hierarchy:** Inter/Geist font system
- **Performance-First:** GPU-optimized animations, SSR-safe components
- **Infrastructure-Grade Feel:** Premium, engineered, trustworthy

### What to Avoid
- Crypto casino UI patterns
- Neon overload / rainbow gradients
- Web3 gimmicks
- Excessive accent colors
- Generic dashboard aesthetics

---

## Component Strategy: React Bits Integration

Based on reactbits.dev catalog, we will integrate:

### Backgrounds
| Component | Purpose | Section |
|-----------|---------|---------|
| **Particles** | Floating ambient particles | Hero section (subtle) |
| **Grid Pattern** | Subtle grid overlay | Global background |
| **Starfield** (customized B&W) | Deep space feel | CTA section |

### 3D & Core Visuals
| Component | Purpose | Implementation |
|-----------|---------|----------------|
| **Mesh gradient (custom)** | Neural Core glow | Behind 3D hero |
| **Orb** | Supporting ambient element | Secondary hero layer |

### Animations & Effects
| Component | Purpose | Section |
|-----------|---------|---------|
| **Blur Text** | Hero headline reveal | Hero section |
| **Split Text** | Word-by-word animations | Section headings |
| **Shiny Text** | Highlighted keywords | Throughout |
| **Animated Card** | Bento card reveals | Protocol section |

### Interactive Elements
| Component | Purpose | Implementation |
|-----------|---------|----------------|
| **Magnetic Button** | CTA hover effects | All buttons |
| **Spotlight Card** | Hover state lighting | Feature cards |
| **Timeline** | Protocol flow | Security section |

---

## Section Specifications

### Section 01: Cinematic Hero

**Layout:** Full viewport height (100vh), 3D Neural Coordination Core centered, typography overlaid

**3D Element: Neural Coordination Core**
```
Description: Abstract sphere composed of interconnected nodes
- 50-80 floating nodes forming a geodesic-like structure
- Connecting lines between nearby nodes (distance-based)
- Slow rotation (0.001 rad/frame)
- Pulse animation on select nodes (random intervals)
- Subtle glow effect on connection intersections
- Monochrome: white nodes on black background
- Mouse-reactive: slight rotation based on cursor position (optional, performance-checked)
- Two light sources: key light from top-left, rim light from bottom-right
```

**Content:**
- Headline: "Zero-Knowledge Credentials"
- Subhead: "Private agent identity infrastructure for the autonomous economy"
- Primary CTA: "Get Started" (SDK)
- Secondary CTA: "View Documentation"
- Scroll indicator: Animated chevron

**Animations:**
- Hero text: blurText reveal on mount, staggered word reveal
- Neural Core: Continuous rotation, node pulse loop
- Scroll indicator: Bouncing arrow, fade out on scroll

**Tech Stack:**
- react-three-fiber + @react-three/drei for 3D
- Framer Motion for text animations
- Custom NeuralCore component

---

### Section 02: Protocol Explanation (Bento Grid)

**Layout:** Centered headline + 4-card asymmetric grid
```
Grid Structure:
[Large Card    ] [Small Card]
[Small Card    ] [Large Card]
```

**Cards:**
1. **ZK-Proof Authentication** (large)
   - Icon: Shield with mathematical symbol
   - "Verify agent credentials without revealing sensitive data"
   
2. **Session Management** (small)
   - Icon: Clock/history
   - "On-chain session tracking"
   
3. **Wallet Attestation** (small)
   - Icon: Wallet chain link
   - "Link wallets to agents"
   
4. **Identity Verification** (large)
   - Icon: Identity fingerprint
   - "Decentralized identity for autonomous agents"

**Animations:**
- Scroll-triggered reveal with AnimatedCard component
- Stagger delay: 100ms between cards
- Hover: Subtle scale (1.02) + spotlight effect via SpotlightCard

---

### Section 03: Developer Experience

**Layout:** Split 50/50, text left, code window right

**Content:**
- Headline: "Integrate in minutes"
- Subhead: "Self-hosted SDK with TypeScript support. Drop-in integration for your existing agent infrastructure."
- Feature list:
  - TypeScript SDK with full type safety
  - React hooks for agent authentication
  - RESTful API with OpenAPI spec
  - WebSocket support for real-time updates

**Code Window:**
- macOS-style window chrome (red/yellow/green dots)
- filename tab: `agent-auth.ts`
- Syntax highlighting (dark theme)
- Typing animation on initial load
- Content: SDK initialization + credential issuance example

**Animations:**
- Text slides in from left
- Code window fades in + typing effect
- Magnetic buttons on hover

---

### Section 04: Platform Operations

**Layout:** Split reversed (50/50), dashboard mockup left, text right

**Dashboard Mockup:**
- Minimal card container with glass effect
- Header: "Agents" with count badge (24 active)
- List items:
  - agent-billing-01 ● Online (green)
  - agent-analytics-02 ● Online (green)
  - agent-support-03 ○ Idle (gray)
- Status dots pulse-animation

**Content:**
- Headline: "Manage your agent fleet"
- Subhead: "Browser-based dashboard for operators. Monitor agent status, issue credentials, and audit sessions without writing code."
- Feature list:
  - Real-time agent status monitoring
  - One-click credential issuance
  - Session audit trails
  - Team collaboration features

**Animations:**
- Dashboard slides in from left
- Status dots: continuous pulse
- Text slides in from right

---

### Section 05: Security / ZK Architecture

**Layout:** Centered headline + 3-step flow diagram

**Content:**
- Headline: "Zero-Knowledge by Design"
- Subhead: "Verify without exposing. Privacy-preserving credentials for regulated environments."

**Flow Steps:**
1. **Private Inputs** → Original data never leaves the agent
2. **ZK Proof Generation** → Cryptographic proof of authorization
3. **Verified Result** → Verifier learns nothing beyond validity

**Visual:**
- 3 nodes connected by animated lines
- Arrow progression animation on scroll
- Each node has abstract geometric icon (not emoji)
- Subtle glow on active step during scroll

---

### Section 06: Final CTA

**Layout:** Centered content on gradient background (subtle radial)

**Content:**
- Headline: "Start building with Agentix"
- Subhead: "Join developers building the future of autonomous agent infrastructure. Free for development, scale with confidence."
- Primary CTA: "Get Started Free"
- Secondary CTA: "View Documentation"
- Trust line: "Self-hosted. Open source. Production-ready."

**Background:**
- Starfield or particle field component (monochrome, subtle)
- No 3D element here to avoid distraction from conversion

**Animations:**
- Text fades in
- Magnetic CTA buttons

---

### Section 07: Footer

**Layout:** 2-column (brand + links)

**Content:**
Left:
- Logo mark (Neural node icon)
- "Agentix"
- "Zero-knowledge credentials for autonomous agent infrastructure."

Right (3 columns):
- **Product:** Documentation, SDK, Dashboard, Pricing
- **Resources:** GitHub, Examples, Blog, Support
- **Legal:** Privacy, Terms, Security

Bottom bar:
- "© 2026 Agentix Protocol"
- "Built for the autonomous economy"

**Style:**
- Ultra-minimal
- No background separation (continues from CTA)
- Subtle divider line

---

## Animation System Specifications

### Scroll Triggers
- Use Intersection Observer (native or Framer Motion's `whileInView`)
- Trigger at 20% viewport intersection
- No scrolljacking

### Timing Standards
- Easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` (ease-out-quad)
- Durations:
  - Micro (hover): 200ms
  - Standard: 400ms
  - Dramatic (hero): 800ms
- Stagger: 100ms between elements

### Performance Rules
- Use `transform` and `opacity` only for animations
- Add `will-change` only on animated elements
- Prefer CSS transitions over JS for simple effects
- Use `prefers-reduced-motion` media query
- 3D scene: max 60 FPS, drop effects below 30 FPS

---

## Typography System

### Font Stack
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### Type Scale
| Element | Size | Weight | Line Height | Letter Spacing |
|---------|------|--------|-------------|----------------|
| H1 (Hero) | 72px | 800 | 1.0 | -0.02em |
| H2 (Section) | 48px | 700 | 1.1 | -0.01em |
| H3 (Card) | 24px | 600 | 1.3 | 0 |
| Body | 16px | 400 | 1.6 | 0 |
| Small | 14px | 400 | 1.5 | 0 |
| Caption | 12px | 500 | 1.4 | 0.02em |

---

## Color System

### Palette
```
--black: #000000
--black-100: #0A0A0A
--black-200: #111111
--white: #FFFFFF
--gray-100: #E5E5E5
--gray-200: #888888
--gray-300: #333333
```

### Usage
- Backgrounds: black, black-100, black-200
- Text: white, gray-100, gray-200
- Borders: gray-300 (10% opacity)
- Accents: white only

---

## Component Specifications

### NeuralCoordinationCore (Custom 3D)
```typescript
interface NeuralCoordinationCoreProps {
  nodeCount?: number;        // default: 64
  connectionDistance?: number; // default: 2.5
  rotationSpeed?: number;    // default: 0.001
  pulseSpeed?: number;       // default: 1.5
  responsive?: boolean;      // default: true
}
```

### MagneticButton (React Bits Style)
```typescript
interface MagneticButtonProps {
  children: React.ReactNode;
  variant: 'primary' | 'secondary';
  onClick?: () => void;
}
```

### AnimatedSection
```typescript
interface AnimatedSectionProps {
  children: React.ReactNode;
  animation: 'fadeUp' | 'fadeIn' | 'slideLeft' | 'slideRight';
  delay?: number;
}
```

---

## Responsive Breakpoints

| Breakpoint | Width | Adjustments |
|------------|-------|-------------|
| Mobile | < 640px | Single column, reduced 3D intensity, stacked layouts |
| Tablet | 640-1024px | 2-column hero, maintained 3D |
| Desktop | > 1024px | Full layout as specified |

---

## File Structure

```
frontend/
├── app/
│   ├── page.tsx                    # Main landing page
│   ├── layout.tsx                  # Root layout
│   └── globals.css                 # Global styles
├── components/
│   ├── landing/
│   │   ├── hero-section.tsx        # Full-screen hero with 3D
│   │   ├── neural-core.tsx         # 3D Neural Coordination Core
│   │   ├── protocol-grid.tsx       # Bento grid section
│   │   ├── developer-section.tsx   # Code window section
│   │   ├── platform-section.tsx    # Dashboard preview section
│   │   ├── security-section.tsx    # ZK flow visualization
│   │   ├── cta-section.tsx         # Final conversion section
│   │   └── footer-section.tsx      # Clean footer
│   ├── ui/
│   │   ├── magnetic-button.tsx     # React Bits style
│   │   ├── animated-card.tsx       # Scroll-triggered card
│   │   ├── code-window.tsx         # macOS terminal
│   │   └── blur-text.tsx           # Text reveal animation
│   └── providers/
│       └── animation-provider.tsx  # Framer Motion setup
├── lib/
│   └── animations.ts               # Shared animation configs
└── public/
    └── (static assets)
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "framer-motion": "^11.x",
    "@react-bits/react-bits": "latest",
    "three": "^0.164.x",
    "@react-three/fiber": "^9.x",
    "@react-three/drei": "^10.x",
    "lenis": "^1.x"
  }
}
```

---

## Accessibility Requirements

- WCAG 2.1 AA compliance
- All interactive elements keyboard accessible
- Focus indicators visible (white outline on dark)
- Alt text for all images
- prefers-reduced-motion support (disable non-essential animations)
- Semantic HTML structure
- ARIA labels where needed

---

## Performance Targets

- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Time to Interactive: < 3.5s
- Cumulative Layout Shift: < 0.1
- Lighthouse Score: > 90 (all categories)

---

## Design Decisions Summary

1. **Full-bleed 3D hero** → Establishes infrastructure credibility
2. **Bento grid** → Modern, scannable feature presentation
3. **Split sections for dual paths** → Equal weight to SDK and Platform
4. **React Bits components** → World-class animation quality without reinventing
5. **Monochrome palette** → Professional, protocol-grade aesthetic
6. **Neural Coordination Core** → Visual metaphor for agent orchestration
7. **Magnetic CTA buttons** → Delightful micro-interactions
8. **Scroll-triggered reveals** → Progressive disclosure, engagement

---

## Implementation Sequence

1. **Phase 1: Foundation**
   - Set up animation utilities
   - Install React Bits dependencies
   - Create shared components (MagneticButton, AnimatedSection)

2. **Phase 2: 3D Hero**
   - Build NeuralCoordinationCore component
   - Implement hero section with blur text

3. **Phase 3: Content Sections**
   - Protocol bento grid
   - Developer section with code window
   - Platform section with dashboard mockup
   - Security visualization

4. **Phase 4: Polish**
   - Footer
   - Scroll-triggered animations
   - Performance optimization
   - Responsive adjustments

---

**Approved by:** User  
**Date:** 2026-05-10  
**Next Step:** Create implementation plan via `writing-plans` skill
