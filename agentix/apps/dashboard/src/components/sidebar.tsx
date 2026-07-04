'use client';

import {
  Home, Wallet, Bot, Building2, KeyRound,
  ScrollText, BarChart3, HardDrive, Stethoscope, AlertTriangle,
  Settings, GitBranch, Layers, Wrench, Terminal
} from 'lucide-react';
import { useWalletCtx } from '@/lib/web3modal-provider';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot, group: 'Protocol' },
  { id: 'organizations', label: 'Organizations', icon: Building2, group: 'Protocol' },
  { id: 'sessions', label: 'Sessions', icon: KeyRound, group: 'Protocol' },
  { id: 'capabilities', label: 'Capabilities', icon: Layers, group: 'Protocol' },
  { id: 'delegations', label: 'Delegations', icon: GitBranch, group: 'Protocol' },
  { id: 'transactions', label: 'Transactions', icon: ScrollText, group: 'Activity' },
  { id: 'events', label: 'Events', icon: ActivityIcon, group: 'Activity' },
  { id: 'actions', label: 'Actions', icon: Terminal, group: 'Activity' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Observability' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope, group: 'Observability' },
  { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle, group: 'Observability' },
  { id: 'backups', label: 'Backups', icon: HardDrive, group: 'Operations' },
  { id: 'developer', label: 'Developer', icon: Wrench, group: 'Operations' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Operations' },
];

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2 8h3l2-5 2 10 2-5 3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Sidebar({ activePage, onNavigate, theme, onToggleTheme }: SidebarProps) {
  const { address, isConnected, connecting, disconnect } = useWalletCtx();

  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group || '';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  return (
    <aside className="sidebar-desktop h-screen sticky top-0 flex flex-col border-r border-border bg-[hsl(var(--sidebar-bg))] overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border flex-shrink-0">
        <div className="w-5 h-5 rounded bg-foreground flex items-center justify-center">
          <span className="text-background font-bold text-[8px] tracking-widest">A</span>
        </div>
        <span className="text-[11px] font-medium tracking-tight">AgentIX</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Overview (ungrouped) */}
        {groups['']?.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`sidebar-link w-full ${activePage === item.id ? 'active' : ''}`}>
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}

        {Object.entries(groups).filter(([g]) => g).map(([group, items]) => (
          <div key={group}>
            <div className="px-3 py-1">
              <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-[0.15em]">{group}</span>
            </div>
            <div className="space-y-0.5">
              {items.map(item => (
                <button key={item.id} onClick={() => onNavigate(item.id)}
                  className={`sidebar-link w-full ${activePage === item.id ? 'active' : ''}`}>
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3 space-y-2 flex-shrink-0">
        <button onClick={onToggleTheme} className="sidebar-link w-full text-[11px]">
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
        {address && isConnected ? (
          <div className="px-3 py-2 rounded-lg bg-secondary/50">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="status-dot online" />
              <span className="text-[9px] text-muted-foreground tracking-wider uppercase">Connected</span>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
            <button onClick={disconnect} className="text-[9px] text-muted-foreground/50 hover:text-foreground mt-1 tracking-wider uppercase">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="px-3 text-[10px] text-muted-foreground/40">No wallet connected</div>
        )}
      </div>
    </aside>
  );
}
