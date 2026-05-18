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
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-white font-semibold">Agents</h3>
        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">24 active</span>
      </div>
      <div className="space-y-3">
        {agents.map((agent, index) => (
          <motion.div key={agent.name} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.1 }} className="flex items-center justify-between p-3 bg-black/50 rounded-lg">
            <span className="text-sm text-zinc-300 font-mono">{agent.name}</span>
            <div className="flex items-center gap-2">
              {agent.status === "online" ? (
                <>
                  <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-2 h-2 rounded-full bg-green-500" />
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
          <AnimatedSection animation="slideRight" className="order-2 lg:order-1">
            <DashboardMockup />
          </AnimatedSection>
          <AnimatedSection animation="slideLeft" delay={0.2} className="order-1 lg:order-2">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">Manage your agent fleet</h2>
            <p className="text-zinc-400 text-lg mb-8">Browser-based dashboard for operators. Monitor agent status, issue credentials, and audit sessions without writing code.</p>
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
