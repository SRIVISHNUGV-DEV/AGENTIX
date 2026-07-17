'use client';

import { useState, useEffect } from 'react';
import { User, RefreshCw, Shield, ShieldOff, ExternalLink } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Skeleton } from '@/components/ui';
import { fetchJSON, truncate, explorerAddress } from '@/lib/api';

export function IdentitiesPage() {
  const [identities, setIdentities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIdentities = async () => {
    setLoading(true);
    try {
      const wallets = await fetchJSON<any>('/api/wallets');
      const list = wallets.value || wallets || [];
      if (list.length === 0) {
        setIdentities([]);
        setLoading(false);
        return;
      }
      const results = await Promise.allSettled(
        list.slice(0, 20).map(async (w: any) => {
          const wAddr = w.walletAddress || w.wallet_address;
          try {
            const info = await fetchJSON<any>(`/api/identity/${wAddr}`);
            return { wallet: wAddr, ...info };
          } catch {
            return { wallet: wAddr, identityId: null };
          }
        })
      );
      setIdentities(results.filter(r => r.status === 'fulfilled').map(r => (r as any).value));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchIdentities(); }, []);

  const columns = [
    { key: 'wallet', header: 'Wallet', render: (i: any) => <span className="font-mono text-xs">{truncate(i.wallet, 8)}</span> },
    { key: 'identityId', header: 'Identity', render: (i: any) => i.identityId ? <span className="font-mono text-xs">{i.identityId.toString()}</span> : <span className="text-muted-foreground/50">—</span> },
    { key: 'status', header: 'Status', render: (i: any) => i.active !== undefined ? <Badge variant={i.active ? 'success' : 'danger'}>{i.active ? 'Active' : 'Inactive'}</Badge> : <Badge variant="default">Unknown</Badge> },
    { key: 'actions', header: '', render: (i: any) => i.wallet ? (
      <a href={explorerAddress(i.wallet)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-foreground transition-colors"><ExternalLink className="w-3.5 h-3.5" /></a>
    ) : null, className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Identities" description="Agent identities registered on-chain"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchIdentities} />}
      />

      {loading ? <Skeleton className="h-48" /> : identities.length === 0 ? (
        <EmptyState icon={<User className="w-8 h-8" />} title="No Identities" description="Identities are created when wallets are registered on-chain. Create a wallet first." />
      ) : (
        <Card>
          <Table columns={columns} data={identities} emptyMessage="No identities found" />
        </Card>
      )}
    </div>
  );
}
