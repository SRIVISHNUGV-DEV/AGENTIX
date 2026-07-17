'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Wallet, Copy, Check, ExternalLink } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { CommandPalette } from '@/components/command-palette';
import { Toast } from '@/components/ui';
import { ClientProvider } from '@/lib/client-provider';
import { useWalletCtx } from '@/lib/web3modal-provider';
import { explorerAddress, API } from '@/lib/api';

import { OverviewPage } from '@/sections/overview';
import { WalletsPage } from '@/sections/wallets';
import { AgentsPage } from '@/sections/agents';
import { IdentitiesPage } from '@/sections/identities';
import { OrganizationsPage } from '@/sections/organizations';
import { CredentialsPage } from '@/sections/credentials';
import { TreesPage } from '@/sections/trees';
import { SessionsPage } from '@/sections/sessions';
import { CapabilitiesPage } from '@/sections/capabilities';
import { DelegationsPage } from '@/sections/delegations';
import { TransactionsPage } from '@/sections/transactions';
import { EventsPage } from '@/sections/events';
import { ActionsPage } from '@/sections/actions';
import { PlansPage } from '@/sections/plans';
import { X402Page } from '@/sections/x402';
import { AnalyticsPage } from '@/sections/analytics';
import { DiagnosticsPage } from '@/sections/diagnostics';
import { AnomaliesPage } from '@/sections/anomalies';
import { BackupsPage } from '@/sections/backups';
import { DeveloperPage } from '@/sections/developer';
import { SettingsPage } from '@/sections/settings';
import { OnboardingWizard } from '@/sections/onboarding';

const PAGES: Record<string, React.FC> = {
  overview: OverviewPage,
  wallets: WalletsPage,
  agents: AgentsPage,
  identities: IdentitiesPage,
  organizations: OrganizationsPage,
  credentials: CredentialsPage,
  trees: TreesPage,
  sessions: SessionsPage,
  capabilities: CapabilitiesPage,
  delegations: DelegationsPage,
  transactions: TransactionsPage,
  events: EventsPage,
  actions: ActionsPage,
  plans: PlansPage,
  x402: X402Page,
  analytics: AnalyticsPage,
  diagnostics: DiagnosticsPage,
  anomalies: AnomaliesPage,
  backups: BackupsPage,
  developer: DeveloperPage,
  settings: SettingsPage,
  onboarding: OnboardingWizard,
};

const PAGE_LABELS: Record<string, string> = {
  overview: 'Overview', wallets: 'Wallets', agents: 'Agents', identities: 'Identities', organizations: 'Organizations',
  credentials: 'Credentials', trees: 'Merkle Trees',
  sessions: 'Sessions', capabilities: 'Capabilities', delegations: 'Delegations',
  transactions: 'Transactions', events: 'Events',   actions: 'Actions', plans: 'Execution Plans', x402: 'x402 Payments', analytics: 'Analytics',
  diagnostics: 'Diagnostics', anomalies: 'Anomalies', backups: 'Backups', developer: 'Developer', settings: 'Settings',
};

function Breadcrumbs({ page }: { page: string }) {
  const label = PAGE_LABELS[page] || page.charAt(0).toUpperCase() + page.slice(1);
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50 mb-4">
      <span className="hover:text-foreground transition-colors cursor-default">Dashboard</span>
      <span className="text-muted-foreground/20">/</span>
      <span className="text-foreground/80 font-medium">{label}</span>
    </div>
  );
}

function WalletButton() {
  const { address, isConnected, connecting, openModal, disconnect } = useWalletCtx();
  const [copied, setCopied] = useState(false);
  const [dropdown, setDropdown] = useState(false);

  const copyAddress = () => {
    if (address) { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  if (address && isConnected) {
    return (
      <div className="relative">
        <button onClick={() => setDropdown(!dropdown)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-accent transition-all text-xs">
          <span className="status-dot online" />
          <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{address.slice(0, 6)}...{address.slice(-4)}</span>
        </button>
        {dropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdown(false)} />
            <div className="absolute right-0 top-full mt-2 w-56 bg-background border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-slide-up">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="status-dot online" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Connected</span>
                </div>
                <p className="text-xs font-mono text-foreground/80 break-all">{address}</p>
              </div>
              <div className="p-1.5">
                <button onClick={copyAddress} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Address'}
                </button>
                <a href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on Explorer
                </a>
                <button onClick={() => { disconnect(); setDropdown(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/5 transition-colors">
                  Disconnect
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button onClick={openModal} disabled={connecting}
      className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-all">
      <Wallet className="w-3.5 h-3.5" />
      {connecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}

function DashboardInner() {
  const [activePage, setActivePage] = useState('overview');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('agentix-theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('agentix-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/onboarding') {
      setShowOnboarding(true);
      setOnboardingLoading(false);
      return;
    }
    const onboardingDone = localStorage.getItem('agentix_onboarding_done') === 'true';
    fetch(`${API}/api/onboarding/status`)
      .then(r => r.json())
      .then(d => {
        if (!d.initialized || !d.rpcConfigured) {
          if (onboardingDone) {
            setShowOnboarding(false);
            setBackendDown(true);
          } else {
            setShowOnboarding(true);
          }
        } else {
          setShowOnboarding(false);
          localStorage.setItem('agentix_onboarding_done', 'true');
        }
      })
      .catch(() => {
        if (onboardingDone) {
          setShowOnboarding(false);
          setBackendDown(true);
        } else {
          setShowOnboarding(true);
        }
      })
      .finally(() => setOnboardingLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Allow any child (e.g. quick-action buttons) to request navigation without
  // prop-drilling setActivePage through every section.
  useEffect(() => {
    const nav = (e: Event) => {
      const page = (e as CustomEvent<string>).detail;
      if (page && PAGES[page]) setActivePage(page);
    };
    window.addEventListener('agentix:navigate', nav as EventListener);
    return () => window.removeEventListener('agentix:navigate', nav as EventListener);
  }, []);

  if (onboardingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 rounded bg-foreground flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-background font-bold text-xs">A</span>
          </div>
          <p className="text-sm text-muted-foreground">Loading AgentIX...</p>
        </div>
      </div>
    );
  }

  if (showOnboarding || activePage === 'onboarding') {
    return <OnboardingWizard />;
  }

  const Page = PAGES[activePage] || OverviewPage;

  return (
    <>
      <div className="dashboard-grid">
        <Sidebar activePage={activePage} onNavigate={setActivePage} theme={theme} onToggleTheme={toggleTheme} />

        <div className="flex flex-col min-h-screen">
          {/* Top Bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between px-6 h-12 border-b border-border bg-background/80 backdrop-blur-xl">
            <button onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-all text-xs w-64">
              <Search className="w-3.5 h-3.5" />
              <span>Search pages...</span>
              <kbd className="ml-auto">⌘K</kbd>
            </button>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground/40 font-mono hidden sm:block">Base Sepolia</span>
              <WalletButton />
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 p-6 overflow-auto">
            <Breadcrumbs page={activePage} />
            {backendDown && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-amber-300/80">
                Backend API server is unreachable. Start the full stack with <code className="text-amber-200">bun run serve</code> from the agentix directory.
              </div>
            )}
            <Page />
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setActivePage} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default function Dashboard() {
  return (
    <ClientProvider>
      <DashboardInner />
    </ClientProvider>
  );
}
