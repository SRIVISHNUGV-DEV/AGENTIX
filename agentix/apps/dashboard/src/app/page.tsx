'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Wallet, Copy, Check, ExternalLink, Menu, Bell } from 'lucide-react';
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

/**
 * Header wallet control: a Connect button when disconnected, or the connected address with a dropdown (copy address, view on explorer, disconnect).
 * @returns The connect button (disabled while connecting), or the address pill + dropdown when connected.
 * Maps to: component useWalletCtx (web3modal-provider); Maps to: external — sepolia.basescan.org address page.
 * Security: shows the connected address; Disconnect only forgets it locally (see disconnect()).
 */
function WalletButton() {
  const { address, isConnected, connecting, openModal, disconnect } = useWalletCtx();
  const [copied, setCopied] = useState(false);
  const [dropdown, setDropdown] = useState(false);

  /**
   * Copies the connected address to the clipboard and flashes "Copied" for 2s.
   * @returns void; no-op when there is no connected address.
   * Failure modes: the clipboard write is unawaited, so a denied clipboard permission still flashes "Copied" even though nothing was copied.
   * Maps to: internal — WalletButton.
   * Side effects: writes to the system clipboard; a 2s timer resets the copied state.
   */
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

/**
 * The dashboard shell: theme/sidebar state, the onboarding gate, the command palette (Cmd/Ctrl+K, "/"), and page routing.
 * On mount it restores the theme/sidebar prefs, then asks /api/onboarding/status: uninitialized (or unreachable with onboarding incomplete) shows the wizard; initialized shows the shell, and an unreachable backend with completed onboarding shows a banner instead of the wizard.
 * @returns A loading splash while onboarding status resolves; the OnboardingWizard when setup is incomplete; otherwise the sidebar + top bar + active page.
 * Maps to: component Sidebar, CommandPalette, OnboardingWizard; Maps to: REST GET /api/onboarding/status.
 * Side effects: reads/writes localStorage (agentix-theme, agentix-sidebar-collapsed, agentix_onboarding_done); listens for window keydown and the `agentix:navigate` custom event.
 */
function DashboardInner() {
  const [activePage, setActivePage] = useState('overview');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [backendDown, setBackendDown] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('agentix-theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    if (localStorage.getItem('agentix-sidebar-collapsed') === 'true') setCollapsed(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('agentix-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('agentix-sidebar-collapsed', collapsed ? 'true' : 'false');
  }, [collapsed]);

  /**
   * Flips the theme between light and dark; persistence to localStorage is done by the theme effect in DashboardInner.
   * @returns void.
   * Maps to: internal — DashboardInner.
   */
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);
  /**
   * Flips the desktop sidebar between full width and the 64px icon rail; persistence to localStorage is done by the collapsed effect in DashboardInner.
   * @returns void.
   * Maps to: internal — DashboardInner.
   */
  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), []);

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
        return;
      }
      // "/" opens the palette too, unless the user is already typing.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select, [contenteditable=true]')) return;
        e.preventDefault();
        setPaletteOpen(true);
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
          <p className="text-sm text-muted-foreground">Loading AGENTIX...</p>
        </div>
      </div>
    );
  }

  if (showOnboarding || activePage === 'onboarding') {
    return <OnboardingWizard />;
  }

  const Page = PAGES[activePage] || OverviewPage;
  const activeLabel = PAGE_LABELS[activePage] || activePage.charAt(0).toUpperCase() + activePage.slice(1);

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
          theme={theme}
          onToggleTheme={toggleTheme}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
        />

        <div className="flex flex-col flex-1 min-w-0 min-h-screen">
          {/* Top Bar */}
          <header className="sticky top-0 z-30 flex items-center gap-2 px-4 md:px-6 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
            <nav aria-label="Breadcrumb" className="min-w-0 hidden sm:block">
              <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <li className="truncate text-muted-foreground/60">AGENTIX</li>
                <li aria-hidden="true" className="text-muted-foreground/30">/</li>
                <li aria-current="page" className="truncate font-medium text-foreground">{activeLabel}</li>
              </ol>
            </nav>
            <button onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-all text-xs w-48 md:w-64 ml-auto">
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search pages...</span>
              <span className="sm:hidden">Search</span>
              <kbd className="ml-auto">⌘K</kbd>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivePage('anomalies')}
                title="Anomalies"
                aria-label="Anomalies"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Bell className="w-4 h-4" />
              </button>
              <span className="text-[10px] text-muted-foreground/40 font-mono hidden lg:block">Base Sepolia</span>
              <WalletButton />
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 p-4 md:p-6 overflow-auto">
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

/**
 * Dashboard entry point: wraps the shell in the wallet provider so every section can use the wallet context.
 * @returns DashboardInner inside ClientProvider.
 * Maps to: component ClientProvider, DashboardInner.
 */
export default function Dashboard() {
  return (
    <ClientProvider>
      <DashboardInner />
    </ClientProvider>
  );
}
