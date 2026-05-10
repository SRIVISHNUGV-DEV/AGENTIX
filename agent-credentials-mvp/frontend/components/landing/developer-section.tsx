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
          <AnimatedSection animation="slideRight">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">Integrate in minutes</h2>
            <p className="text-zinc-400 text-lg mb-8">Self-hosted SDK with TypeScript support. Drop-in integration for your existing agent infrastructure.</p>
            <ul className="space-y-4">
              {features.map((feature) => (
                <li key={feature.text} className="flex items-center gap-3">
                  <feature.icon className="w-5 h-5 text-white" strokeWidth={1.5} />
                  <span className="text-zinc-300">{feature.text}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>
          <AnimatedSection animation="slideLeft" delay={0.2}>
            <CodeWindow filename="agent-auth.ts" code={exampleCode} typingEffect={true} />
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
