'use client';

import { useState, useEffect } from 'react';
import { Wallet, Plus, ExternalLink, RefreshCw, Coins, KeyRound, User } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, CardHeader, Table, StatusDot, Skeleton } from '@/components/ui';
import { fetchJSON, truncate, explorerAddress } from '@/lib/api';
import { sendAndWaitForWalletCreation, getAccount } from '@/lib/tx-sender';

export function WalletsPage() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/wallets');
      setWallets(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchWallets(); }, []);

  const createWallet = async () => {
    setCreating(true);
    try {
      const ownerAddress = await getAccount();
      await sendAndWaitForWalletCreation(ownerAddress);
      await fetchWallets();
    } catch (e: any) {
      if (e.code === 4001 || e.message?.includes('rejected')) alert('Transaction was rejected');
      else alert(e.message);
    }
    setCreating(false);
  };

  const columns = [
    { key: 'address', header: 'Address', render: (w: any) => <span className="font-mono text-xs">{truncate(w.walletAddress || w.wallet_address, 8)}</span> },
    { key: 'owner', header: 'Owner', render: (w: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(w.ownerAddress || w.owner_address, 8)}</span> },
    { key: 'status', header: 'Status', render: () => <Badge variant="success">Deployed</Badge> },
    { key: 'actions', header: '', render: (w: any) => (
      <div className="flex items-center gap-2">
        <a href={explorerAddress(w.walletAddress || w.wallet_address)} target="_blank" rel="noopener noreferrer"
          className="text-muted-foreground/40 hover:text-foreground transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    ), className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Wallets" description="ERC-4337 smart contract wallets for agent transactions"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchWallets} />
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={createWallet} disabled={creating}>
              {creating ? 'Creating...' : 'Create Wallet'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {loading ? <Skeleton className="h-48" /> : wallets.length === 0 ? (
            <EmptyState icon={<Wallet className="w-8 h-8" />} title="No Wallets" description="Create a wallet to let your agent execute transactions on-chain."
              action={<Button size="sm" onClick={createWallet} disabled={creating} icon={<Plus className="w-3.5 h-3.5" />}>Create Wallet</Button>} />
          ) : (
            <Card>
              <Table columns={columns} data={wallets} onRowClick={setSelected} emptyMessage="No wallets found" />
            </Card>
          )}
        </div>

        {selected && (
          <Card>
            <CardHeader title="Wallet Details" />
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Address</div>
                <div className="text-xs font-mono break-all">{selected.walletAddress || selected.wallet_address}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Owner</div>
                <div className="text-xs font-mono break-all">{selected.ownerAddress || selected.owner_address}</div>
              </div>
              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                  <KeyRound className="w-3.5 h-3.5" /> 0 sessions
                </div>
              </div>
              <a href={explorerAddress(selected.walletAddress || selected.wallet_address)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> View on Explorer
              </a>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
