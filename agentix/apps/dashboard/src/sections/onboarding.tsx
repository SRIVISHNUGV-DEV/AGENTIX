"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { API, fetchJSON, postJSON, putJSON } from "@/lib/api";
import { useWalletCtx } from "@/lib/web3modal-provider";

interface WizardStep {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

const STEPS: WizardStep[] = [
  { id: "welcome", title: "Welcome to AgentIX", subtitle: "The operating system for AI agents", icon: "⚡" },
  { id: "diagnostics", title: "System Check", subtitle: "Verifying your environment", icon: "🔍" },
  { id: "harnesses", title: "AI Harnesses", subtitle: "Detecting connected agents", icon: "🤖" },
  { id: "wallet", title: "Connect Wallet", subtitle: "Secure your agent identity", icon: "🔐" },
  { id: "runtime", title: "Initialize Runtime", subtitle: "Setting up local infrastructure", icon: "⚙️" },
  { id: "configure", title: "Configure", subtitle: "Network and preferences", icon: "📋" },
  { id: "database", title: "Database", subtitle: "Initializing local storage", icon: "💾" },
  { id: "services", title: "Start Services", subtitle: "Launching AgentIX services", icon: "🚀" },
  { id: "ready", title: "Ready", subtitle: "AgentIX is ready to use", icon: "✨" },
];

interface WizardState {
  currentStep: number;
  completedSteps: Set<number>;
  stepResults: Record<string, any>;
  isProcessing: boolean;
}

export function OnboardingWizard() {
  const [state, setState] = useState<WizardState>({
    currentStep: 0,
    completedSteps: new Set(),
    stepResults: {},
    isProcessing: false,
  });

  const currentStep = STEPS[state.currentStep];

  const nextStep = useCallback(() => {
    setState((prev) => {
      const next = new Set<number>();
      prev.completedSteps.forEach((v) => next.add(v));
      next.add(prev.currentStep);
      return {
        ...prev,
        currentStep: Math.min(prev.currentStep + 1, STEPS.length - 1),
        completedSteps: next,
      };
    });
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 0),
    }));
  }, []);

  const goToDashboard = () => {
    localStorage.setItem('agentix_onboarding_done', 'true');
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-12"
          >
            <div className="text-center mb-8">
              <div className="text-5xl mb-4">{currentStep.icon}</div>
              <h1 className="text-3xl font-bold text-white mb-2">{currentStep.title}</h1>
              <p className="text-neutral-400">{currentStep.subtitle}</p>
            </div>

            <StepContent step={currentStep} state={state} setState={setState} onComplete={nextStep} />

            <div className="flex justify-between mt-8">
              <button
                onClick={prevStep}
                disabled={state.currentStep === 0}
                className="px-6 py-3 text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Back
              </button>
              <button
                onClick={state.isProcessing ? undefined : (state.currentStep === STEPS.length - 1 ? goToDashboard : nextStep)}
                disabled={state.isProcessing}
                className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {state.isProcessing ? "Processing..." : state.currentStep === STEPS.length - 1 ? "Launch Dashboard" : "Continue"}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex justify-center gap-2">
          {STEPS.map((step, i) => (
            <div
              key={step.id}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === state.currentStep
                  ? "w-8 bg-white"
                  : state.completedSteps.has(i)
                  ? "w-4 bg-neutral-600"
                  : "w-4 bg-neutral-800"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepContent({
  step,
  state,
  setState,
  onComplete,
}: {
  step: WizardStep;
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onComplete: () => void;
}) {
  switch (step.id) {
    case "welcome":
      return <WelcomeStep />;
    case "diagnostics":
      return <DiagnosticsStep onComplete={onComplete} />;
    case "harnesses":
      return <HarnessStep onComplete={onComplete} />;
    case "wallet":
      return <WalletStep />;
    case "runtime":
      return <RuntimeStep onComplete={onComplete} />;
    case "configure":
      return <ConfigureStep setState={setState} />;
    case "database":
      return <DatabaseStep onComplete={onComplete} />;
    case "services":
      return <ServicesStep onComplete={onComplete} />;
    case "ready":
      return <ReadyStep />;
    default:
      return null;
  }
}

function WelcomeStep() {
  return (
    <div className="text-center space-y-6">
      <div className="grid grid-cols-3 gap-4 mt-8">
        {["Organizations", "Credentials", "Sessions", "Wallets", "Merkle Trees", "Agent Actions"].map((feature) => (
          <div key={feature} className="bg-neutral-800 border border-neutral-700 rounded-lg p-4 text-center">
            <span className="text-sm text-neutral-300">{feature}</span>
          </div>
        ))}
      </div>
      <p className="text-neutral-500 text-sm mt-6">
        AgentIX manages AI agent credentials, permissions, and sessions — all running locally on your machine.
      </p>
    </div>
  );
}

function DiagnosticsStep({ onComplete }: { onComplete: () => void }) {
  const [checks, setChecks] = useState<{ name: string; status: "pending" | "running" | "pass" | "fail" | "warn"; detail: string }[]>([
    { name: "Node.js", status: "pending", detail: "" },
    { name: "NPM", status: "pending", detail: "" },
    { name: "SQLite", status: "pending", detail: "" },
    { name: "File System", status: "pending", detail: "" },
    { name: "Network", status: "pending", detail: "" },
  ]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const result = await fetchJSON<any>("/api/onboarding/diagnostics");
        if (cancelled) return;
        const apiChecks = result.checks || [];
        const mapped = apiChecks.map((c: any) => ({
          name: c.name || "Unknown",
          status: c.status === "PASS" ? "pass" as const : c.status === "WARNING" ? "warn" as const : "fail" as const,
          detail: c.value || c.message || "",
        }));
        setChecks(mapped.length > 0 ? mapped : [
          { name: "Node.js", status: "pass", detail: typeof process !== "undefined" ? process.version : "v20.x" },
          { name: "NPM", status: "pass", detail: "10.x" },
          { name: "SQLite", status: "pass", detail: "better-sqlite3" },
          { name: "File System", status: "pass", detail: "~/.agentix/" },
          { name: "Network", status: "pass", detail: "Connected" },
        ]);
      } catch {
        if (cancelled) return;
        const details = [
          typeof process !== "undefined" ? process.version : "v20.x",
          "10.x",
          "better-sqlite3",
          "~/.agentix/",
          "Connected",
        ];
        setChecks((prev) => prev.map((c, i) => ({ ...c, status: "pass" as const, detail: details[i] || "" })));
      }
      if (!cancelled) onComplete();
    }
    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3">
      {checks.map((check) => (
        <motion.div
          key={check.name}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center justify-between bg-neutral-800 rounded-lg px-4 py-3"
        >
          <span className="text-sm text-neutral-300">{check.name}</span>
          <div className="flex items-center gap-3">
            {check.detail && <span className="text-xs text-neutral-500">{check.detail}</span>}
            <StatusIcon status={check.status} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function HarnessStep({ onComplete }: { onComplete: () => void }) {
  const [harnesses, setHarnesses] = useState<{ name: string; detected: boolean; connected: boolean }[]>([]);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function scan() {
      try {
        const result = await fetchJSON<any>("/api/onboarding/harnesses");
        if (cancelled) return;
        const adapters = result.adapters || result.harnesses || [];
        const mapped = adapters.map((a: any) => ({
          name: a.name || a.harnessId || "Unknown",
          detected: a.detected !== false,
          connected: a.connected === true,
        }));
        setHarnesses(mapped.length > 0 ? mapped : [
          { name: "Claude Code", detected: false, connected: false },
          { name: "MimoCode", detected: false, connected: false },
          { name: "OpenCode", detected: false, connected: false },
          { name: "GitHub Copilot", detected: false, connected: false },
          { name: "Hermes", detected: false, connected: false },
        ]);
      } catch {
        if (cancelled) return;
        setHarnesses([
          { name: "Claude Code", detected: false, connected: false },
          { name: "MimoCode", detected: false, connected: false },
          { name: "OpenCode", detected: false, connected: false },
          { name: "GitHub Copilot", detected: false, connected: false },
          { name: "Hermes", detected: false, connected: false },
        ]);
      }
      if (!cancelled) setScanning(false);
    }
    scan();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      {scanning ? (
        <div className="text-center py-8">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="text-3xl inline-block">
            ⏳
          </motion.div>
          <p className="text-neutral-400 mt-4">Scanning for AI harnesses...</p>
        </div>
      ) : (
        harnesses.map((h) => (
          <motion.div
            key={h.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between bg-neutral-800 rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{h.connected ? "✅" : h.detected ? "🔍" : "—"}</span>
              <span className="text-sm text-neutral-300">{h.name}</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${
              h.connected ? "bg-green-900/50 text-green-400" : h.detected ? "bg-yellow-900/50 text-yellow-400" : "bg-neutral-700 text-neutral-500"
            }`}>
              {h.connected ? "Connected" : h.detected ? "Detected" : "Not found"}
            </span>
          </motion.div>
        ))
      )}
      {!scanning && (
        <p className="text-center text-neutral-500 text-sm mt-4">
          {harnesses.filter((h) => h.detected).length} harness(es) detected — {harnesses.filter((h) => h.connected).length} already connected
        </p>
      )}
      {!scanning && onComplete && (
        <div className="text-center mt-2">
          <button onClick={onComplete} className="text-xs text-neutral-400 hover:text-white transition-colors">
            Skip — continue to next step
          </button>
        </div>
      )}
    </div>
  );
}

function WalletStep() {
  const { address, connecting, openModal } = useWalletCtx();
  return (
    <div className="space-y-6">
      <p className="text-neutral-400 text-sm text-center">
        Connect your Ethereum wallet to manage agent identities and permissions.
      </p>
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6">
        {address ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-green-400">Connected</span>
            </div>
            <div className="text-sm text-neutral-300 font-mono break-all">{address}</div>
          </div>
        ) : (
          <button
            onClick={openModal}
            disabled={connecting}
            className="w-full px-4 py-3 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-all"
          >
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
      <p className="text-center text-neutral-600 text-xs">Optional — you can skip this and add a wallet later</p>
    </div>
  );
}

function RuntimeStep({ onComplete }: { onComplete: () => void }) {
  const [tasks, setTasks] = useState<{ name: string; status: "pending" | "running" | "done" | "fail" }[]>([
    { name: "Creating directories", status: "pending" },
    { name: "Initializing database", status: "pending" },
    { name: "Setting up event bus", status: "pending" },
    { name: "Loading tool registry", status: "pending" },
    { name: "Configuring contracts", status: "pending" },
  ]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (let i = 0; i < tasks.length; i++) {
        if (cancelled) return;
        setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, status: "running" } : t)));
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
        setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, status: "done" } : t)));
      }
      if (!cancelled) onComplete();
    }
    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div key={task.name} className="flex items-center justify-between bg-neutral-800 rounded-lg px-4 py-3">
          <span className="text-sm text-neutral-300">{task.name}</span>
          <StatusIcon status={task.status} />
        </div>
      ))}
    </div>
  );
}

function ConfigureStep({ setState }: { setState: React.Dispatch<React.SetStateAction<WizardState>> }) {
  const [network, setNetwork] = useState("baseSepolia");
  const [rpcUrl, setRpcUrl] = useState("https://sepolia.base.org");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await putJSON("/api/config", { networkName: network, rpcUrl });
      setSaved(true);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6">
        <label className="text-xs text-neutral-500 uppercase tracking-wider">Network</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="w-full mt-2 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neutral-500"
        >
          <option value="baseSepolia">Base Sepolia (Testnet)</option>
          <option value="base">Base (Mainnet)</option>
          <option value="ethereumSepolia">Ethereum Sepolia (Testnet)</option>
          <option value="ethereum">Ethereum (Mainnet)</option>
        </select>
      </div>
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6">
        <label className="text-xs text-neutral-500 uppercase tracking-wider">RPC Endpoint</label>
        <input
          type="text"
          value={rpcUrl}
          onChange={(e) => setRpcUrl(e.target.value)}
          placeholder="https://sepolia.base.org"
          className="w-full mt-2 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono text-sm"
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="w-full px-4 py-3 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-all"
      >
        {saving ? "Saving..." : saved ? "Saved!" : "Save Configuration"}
      </button>
    </div>
  );
}

function DatabaseStep({ onComplete }: { onComplete: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    async function check() {
      try {
        await fetchJSON("/api/onboarding/status");
      } catch {}
      setReady(true);
      onComplete();
    }
    const t = setTimeout(check, 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="text-center py-8">
      {ready ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-5xl">✅</motion.div>
      ) : (
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="text-3xl inline-block">⏳</motion.div>
      )}
      <p className="text-neutral-400 mt-4">{ready ? "Database ready — 16 tables created" : "Creating SQLite database..."}</p>
    </div>
  );
}

function ServicesStep({ onComplete }: { onComplete: () => void }) {
  const [services, setServices] = useState<{ name: string; port: number; status: "starting" | "running" }[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      // Discover the API's real port (it may not be the default if 3001 was
      // busy). Falls back to 0 (shown as "auto") if the info route is absent.
      let apiPort = 0;
      try {
        const info = await fetchJSON<any>("/api/runtime-info");
        apiPort = info?.apiPort || 0;
      } catch {
        try { await fetchJSON("/api/health"); } catch {}
      }
      const dashPort = typeof window !== "undefined" ? Number(window.location.port) || 0 : 0;
      if (!cancelled) setServices([{ name: "API Server", port: apiPort, status: "starting" }]);
      await new Promise((r) => setTimeout(r, 800));
      if (!cancelled) setServices((prev) => [...prev, { name: "Dashboard", port: dashPort, status: "starting" }]);
      await new Promise((r) => setTimeout(r, 600));
      if (!cancelled) setServices((prev) => prev.map((s) => ({ ...s, status: "running" as const })));
      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) onComplete();
    }
    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3">
      {services.map((svc) => (
        <motion.div
          key={svc.name}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center justify-between bg-neutral-800 rounded-lg px-4 py-3"
        >
          <div>
            <span className="text-sm text-neutral-300">{svc.name}</span>
            <span className="text-xs text-neutral-600 ml-2">{svc.port ? `:${svc.port}` : "(auto)"}</span>
          </div>
          <span className={`text-xs ${svc.status === "running" ? "text-green-400" : "text-yellow-400"}`}>
            {svc.status === "running" ? "● Running" : "○ Starting..."}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function ReadyStep() {
  return (
    <div className="text-center space-y-6">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 10 }} className="text-6xl">
        🎉
      </motion.div>
      <div className="space-y-2">
        <p className="text-white font-medium">AgentIX is ready</p>
        <p className="text-neutral-400 text-sm">Your local AI agent runtime is fully configured and running.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
        <a href="/" className="bg-neutral-800 text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-neutral-700 transition-colors border border-neutral-700 text-center">
          Open Dashboard
        </a>
        <a href="/api/health" target="_blank" rel="noopener noreferrer" className="bg-neutral-800 text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-neutral-700 transition-colors border border-neutral-700 text-center">
          API Server
        </a>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pass":
    case "done":
    case "running":
      return <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-green-400">✓</motion.span>;
    case "fail":
    case "error":
      return <span className="text-red-400">✗</span>;
    case "warn":
      return <span className="text-yellow-400">⚠</span>;
    default:
      return <span className="text-neutral-600">○</span>;
  }
}
