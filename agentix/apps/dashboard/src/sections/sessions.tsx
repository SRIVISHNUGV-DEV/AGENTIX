'use client';

import { useState, useEffect } from 'react';
import { KeyRound, RefreshCw, Shield, ShieldOff, ExternalLink, Plus, Loader2, Check, Wallet, Clock, AlertTriangle } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Dialog, Input, Select, Alert, StatusDot, Skeleton } from '@/components/ui';
import { fetchJSON, postJSON, deleteJSON, truncate, explorerAddress } from '@/lib/api';
import { sendCreateLightweightSession, getAccount } from '@/lib/tx-sender';
import { useWalletCtx } from '@/lib/web3modal-provider';

export function SessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { address, isConnected, openModal } = useWalletCtx();

  const [form, setForm] = useState({
    walletAddress: '',
    dailySpendLimitEth: '0.1',
    dailyTxLimit: '10',
    expiryDays: '30',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sessionData, walletData] = await Promise.allSettled([
        fetchJSON<any>('/api/sessions/all'),
        fetchJSON<any>('/api/wallets'),
      ]);
      if (sessionData.status === 'fulfilled') setSessions(sessionData.value.value || sessionData.value || []);
      if (walletData.status === 'fulfilled') {
        const list = walletData.value.value || walletData.value || [];
        setWallets(list);
        if (list.length > 0 && !form.walletAddress) setForm(f => ({ ...f, walletAddress: list[0].walletAddress || list[0].wallet_address }));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const createSession = async () => {
    if (!isConnected) { openModal(); return; }
    if (!form.walletAddress) { setError('Select a wallet first'); return; }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const ownerAddress = address!;
      await sendCreateLightweightSession(form.walletAddress, ownerAddress, {
        dailySpendLimitEth: form.dailySpendLimitEth,
        dailyTxLimit: parseInt(form.dailyTxLimit),
        expiryDays: parseInt(form.expiryDays),
      });
      setSuccess('Session created successfully');
      setShowForm(false);
      fetchData();
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes('rejected')) {
        setError('Transaction was rejected in MetaMask');
      } else {
        setError(e.message || 'Failed to create session');
      }
    }
    setCreating(false);
  };

  const revokeSession = async (sessionId: string, walletAddress: string) => {
    if (!confirm('Revoke this session? This cannot be undone.')) return;
    try {
      await deleteJSON('/api/sessions', { sessionId, walletAddress });
      fetchData();
    } catch (e: any) { console.error(e); }
  };

  const columns = [
    { key: 'sessionId', header: 'Session', render: (s: any) => <span className="font-mono text-xs">{truncate(s.sessionId || s.session_id, 10)}</span> },
    { key: 'wallet', header: 'Wallet', render: (s: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(s.walletAddress || s.wallet_address, 8)}</span> },
    { key: 'key', header: 'Key', render: (s: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(s.sessionKey || s.session_key, 8)}</span> },
    { key: 'dailySpend', header: 'Daily Spend', render: (s: any) => <span className="text-xs">{s.dailySpendLimit || s.daily_spend_limit || '—'} ETH</span> },
    { key: 'expires', header: 'Expires', render: (s: any) => (
      <div className="flex items-center gap-1.5">
        {s.expiry > 1e12 && (s.expiry * 1000 < Date.now() + 86400000) && <Clock className="w-3 h-3 text-warning" />}
        <span className="text-xs text-muted-foreground">{s.expiry > 1e12 ? new Date(s.expiry * 1000).toLocaleDateString() : '—'}</span>
      </div>
    )},
    { key: 'status', header: '', render: (s: any) => (
      <div className="flex items-center gap-2 justify-end">
        <Badge variant={s.revoked ? 'danger' : 'success'}>{s.revoked ? 'Revoked' : 'Active'}</Badge>
        {!s.revoked && (
          <button onClick={() => revokeSession(s.sessionId || s.session_id, s.walletAddress || s.wallet_address)}
            className="text-[10px] text-muted-foreground/40 hover:text-destructive transition-colors">Revoke</button>
        )}
      </div>
    ), className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Sessions" description="Lightweight sessions authorize agent actions within defined limits"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchData} />
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { setError(null); setSuccess(null); setShowForm(true); }}>
              Create Session
            </Button>
          </div>
        }
      />

      {success && <Alert variant="success" className="mb-4">{success}</Alert>}
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      <Dialog open={showForm} onClose={() => setShowForm(false)} title="Create Lightweight Session">
        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Target Wallet</div>
            {wallets.length === 0 ? (
              <div className="text-xs text-muted-foreground/60 px-3 py-2 rounded-lg bg-secondary">No wallets available. Create a wallet first.</div>
            ) : (
              <select value={form.walletAddress} onChange={e => setForm({ ...form, walletAddress: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                {wallets.map((w: any) => (
                  <option key={w.walletAddress || w.wallet_address} value={w.walletAddress || w.wallet_address}>
                    {truncate(w.walletAddress || w.wallet_address, 10)} — Owner: {truncate(w.ownerAddress || w.owner_address, 6)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Spend (ETH)" type="number" value={form.dailySpendLimitEth}
              onChange={e => setForm({ ...form, dailySpendLimitEth: e.target.value })} min="0" step="0.01" />
            <Input label="Daily Tx Limit" type="number" value={form.dailyTxLimit}
              onChange={e => setForm({ ...form, dailyTxLimit: e.target.value })} min="1" step="1" />
          </div>

          <Input label="Expiry (days)" type="number" value={form.expiryDays}
            onChange={e => setForm({ ...form, expiryDays: e.target.value })} min="1" step="1" />

          <div className="flex items-start gap-2 p-3 rounded-lg border border-border bg-secondary/50">
            <Wallet className="w-4 h-4 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
            <div className="text-[10px] text-muted-foreground/80 leading-relaxed">
              Creates a lightweight owner-signed session. You will be asked to sign a message and confirm a transaction in your wallet.
              Session key will be your connected wallet address.
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={createSession} disabled={creating || wallets.length === 0}
              icon={creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
              {creating ? 'Creating...' : 'Create & Sign'}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={creating}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {loading ? <Skeleton className="h-48" /> : sessions.length === 0 ? (
        <EmptyState icon={<KeyRound className="w-8 h-8" />} title="No Active Sessions"
          description="Create a lightweight session to authorize agent actions within daily spending limits."
          action={wallets.length > 0 ? <Button size="sm" onClick={() => setShowForm(true)} icon={<Plus className="w-3.5 h-3.5" />}>Create Session</Button> : undefined} />
      ) : (
        <Card><Table columns={columns} data={sessions} emptyMessage="No sessions found" /></Card>
      )}
    </div>
  );
}
