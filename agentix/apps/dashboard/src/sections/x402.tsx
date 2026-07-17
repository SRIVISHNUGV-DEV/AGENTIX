'use client';

import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Shield, Globe, RefreshCw, Settings, ArrowUpRight, ArrowDownLeft, Wallet } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton, StatCard, Input } from '@/components/ui';
import { fetchJSON, postJSON, truncate } from '@/lib/api';

export function X402Page() {
  const [stats, setStats] = useState<any>(null);
  const [sellerStats, setSellerStats] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [usdcBalance, setUsdcBalance] = useState<string>('—');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'buyer' | 'seller' | 'policy'>('overview');

  const fetchData = async () => {
    try {
      const [s, ss, p, pay, r] = await Promise.allSettled([
        fetchJSON<any>('/api/x402/stats'),
        fetchJSON<any>('/api/x402/seller/stats'),
        fetchJSON<any>('/api/x402/policy'),
        fetchJSON<any>('/api/x402/payments?limit=100'),
        fetchJSON<any>('/api/x402/seller/routes'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (ss.status === 'fulfilled') setSellerStats(ss.value);
      if (p.status === 'fulfilled') {
        setPolicy(p.value);
        // Fetch USDC balance for the configured wallet
        if (p.value?.agentWalletAddress) {
          try {
            const bal = await fetchJSON<any>(`/api/x402/balance?wallet=${p.value.agentWalletAddress}`);
            setUsdcBalance(bal.balance || '—');
          } catch {}
        }
      }
      if (pay.status === 'fulfilled') setPayments(pay.value || []);
      if (r.status === 'fulfilled') setRoutes(r.value || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const savePolicy = async () => {
    try {
      await postJSON('/api/x402/policy', policy);
    } catch {}
  };

  if (loading) return <Skeleton className="h-64" />;

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
    { id: 'buyer' as const, label: 'Outgoing', icon: ArrowUpRight },
    { id: 'seller' as const, label: 'Incoming', icon: ArrowDownLeft },
    { id: 'policy' as const, label: 'Policy', icon: Shield },
  ];

  return (
    <div>
      <PageHeader title="x402 Payments" description="ERC-4337 agentic commerce payments via the x402 protocol"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchData} />}
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 bg-secondary/50 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Spent" value={stats?.totalSpent || '$0.00'} icon={<ArrowUpRight className="w-4 h-4" />} />
            <StatCard label="Total Earned" value={sellerStats?.totalEarned || '$0.00'} icon={<ArrowDownLeft className="w-4 h-4" />} />
            <StatCard label="Payments Made" value={String(stats?.totalTransactions || 0)} icon={<DollarSign className="w-4 h-4" />} />
            <StatCard label="Daily Spend" value={stats?.dailySpend || '$0.00'} icon={<TrendingUp className="w-4 h-4" />} />
          </div>

          {/* Agent Wallet Info */}
          {policy?.agentWalletAddress && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Wallet className="w-4 h-4 text-muted-foreground/60" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Agent Wallet (ERC-4337)</span>
                    <p className="text-xs font-mono mt-0.5">{policy.agentWalletAddress}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">USDC Balance</span>
                  <p className="text-sm font-medium">{usdcBalance}</p>
                </div>
              </div>
            </Card>
          )}

          {!policy?.agentWalletAddress && (
            <Card className="p-4 border-amber-500/30 bg-amber-500/5">
              <p className="text-xs text-amber-300/80">No agent wallet configured for x402 payments. Set your ERC-4337 wallet address in the Policy tab.</p>
            </Card>
          )}

          {/* Top domains */}
          {stats?.topDomains?.length > 0 && (
            <Card className="p-4">
              <h3 className="text-xs font-medium mb-3">Top Paid Domains</h3>
              <div className="space-y-2">
                {stats.topDomains.map((d: any) => (
                  <div key={d.domain} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-muted-foreground/40" />
                      <span className="font-mono">{d.domain}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground/60">{d.count} txs</span>
                      <span className="font-medium">{d.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Seller routes */}
          {routes.length > 0 && (
            <Card className="p-4">
              <h3 className="text-xs font-medium mb-3">Paid Endpoints (Seller)</h3>
              <div className="space-y-2">
                {routes.map((r: any) => (
                  <div key={r.pattern} className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono">{r.pattern}</span>
                      <p className="text-muted-foreground/50 mt-0.5">{r.description}</p>
                    </div>
                    <Badge variant="success">{r.price}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Outgoing payments (buyer) */}
      {tab === 'buyer' && (
        <div className="space-y-3">
          {payments.length === 0 ? (
            <EmptyState icon={<ArrowUpRight className="w-8 h-8" />} title="No Outgoing Payments"
              description="When your agent pays for x402-protected resources via the ERC-4337 bundler, transactions appear here." />
          ) : (
            <Card>
              <Table
                columns={[
                  { key: 'domain', header: 'Domain', render: (p: any) => <span className="font-mono text-xs">{p.domain}</span> },
                  { key: 'amount', header: 'Amount', render: (p: any) => <span className="font-medium">${(parseInt(p.amount) / 1e6).toFixed(4)}</span> },
                  { key: 'wallet_address', header: 'Wallet', render: (p: any) => p.wallet_address ? <span className="font-mono text-xs">{truncate(p.wallet_address, 6)}</span> : '—' },
                  { key: 'tx_hash', header: 'Tx Hash', render: (p: any) => p.tx_hash ? <span className="font-mono text-xs">{truncate(p.tx_hash, 8)}</span> : '—' },
                  { key: 'user_op_hash', header: 'UserOp', render: (p: any) => p.user_op_hash ? <span className="font-mono text-xs">{truncate(p.user_op_hash, 8)}</span> : '—' },
                  { key: 'scheme', header: 'Scheme', render: (p: any) => <Badge variant="default">{p.scheme}</Badge> },
                  { key: 'created_at', header: 'Time', render: (p: any) => new Date(p.created_at * 1000).toLocaleString() },
                ]}
                data={payments}
                emptyMessage="No payments"
              />
            </Card>
          )}
        </div>
      )}

      {/* Incoming payments (seller) */}
      {tab === 'seller' && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground/60">
            When other agents pay to access your protected endpoints via ERC-4337 UserOps, those payments appear here.
            Payments are verified by checking the on-chain USDC transfer in the tx receipt.
          </div>
          {sellerStats?.topResources?.length > 0 ? (
            <Card className="p-4">
              <h3 className="text-xs font-medium mb-3">Top Earners</h3>
              <div className="space-y-2">
                {sellerStats.topResources.map((r: any) => (
                  <div key={r.resource} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{r.resource}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground/60">{r.count} txs</span>
                      <span className="font-medium text-success">{r.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <EmptyState icon={<ArrowDownLeft className="w-8 h-8" />} title="No Incoming Payments"
              description="Enable x402 seller mode in Settings to monetize your API endpoints. Payments are settled via USDC on Base." />
          )}
        </div>
      )}

      {/* Policy */}
      {tab === 'policy' && policy && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-xs font-medium mb-4">Payment Policy (ERC-4337)</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Agent Wallet Address (ERC-4337 Smart Contract)</label>
                <Input value={policy.agentWalletAddress || ''} placeholder="0x... (your AgentWallet proxy address)"
                  onChange={e => setPolicy({ ...policy, agentWalletAddress: e.target.value })} />
                <p className="text-[10px] text-muted-foreground/40 mt-1">The smart contract wallet that holds USDC and executes payments via the bundler.</p>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Session Key (Private Key for Signing UserOps)</label>
                <Input type="password" value={policy.sessionKey || ''} placeholder="0x... (session key private key)"
                  onChange={e => setPolicy({ ...policy, sessionKey: e.target.value })} />
                <p className="text-[10px] text-muted-foreground/40 mt-1">The session key authorized on this wallet. Signs UserOperations for the bundler.</p>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Max Per Request</label>
                <Input value={`$${(parseInt(policy.maxPaymentPerRequest) / 1e6).toFixed(2)}`}
                  onChange={e => setPolicy({ ...policy, maxPaymentPerRequest: String(Math.round(parseFloat(e.target.value.replace('$', '')) * 1e6)) })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Daily Limit</label>
                <Input value={`$${(parseInt(policy.dailyLimit) / 1e6).toFixed(2)}`}
                  onChange={e => setPolicy({ ...policy, dailyLimit: String(Math.round(parseFloat(e.target.value.replace('$', '')) * 1e6)) })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Auto-Approve Threshold</label>
                <Input value={`$${(parseInt(policy.autoApproveThreshold) / 1e6).toFixed(2)}`}
                  onChange={e => setPolicy({ ...policy, autoApproveThreshold: String(Math.round(parseFloat(e.target.value.replace('$', '')) * 1e6)) })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={policy.autoApprove} onChange={e => setPolicy({ ...policy, autoApprove: e.target.checked })} />
                <span className="text-xs">Auto-approve payments below threshold (skip risk check)</span>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Blocked Domains (comma-separated)</label>
                <Input value={policy.blockedDomains?.join(', ') || ''} placeholder="example.com, bad-site.com"
                  onChange={e => setPolicy({ ...policy, blockedDomains: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} />
              </div>
              <Button onClick={savePolicy}>Save Policy</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
