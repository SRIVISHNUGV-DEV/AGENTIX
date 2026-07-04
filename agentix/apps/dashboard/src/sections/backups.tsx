'use client';

import { useState, useEffect } from 'react';
import { HardDrive, Plus, RefreshCw, Check } from 'lucide-react';
import { PageHeader, EmptyState, Button, Card, Table, Skeleton } from '@/components/ui';
import { fetchJSON, postJSON } from '@/lib/api';

export function BackupsPage() {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/backups');
      setBackups(data.value || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchBackups(); }, []);

  const createBackup = async () => {
    setCreating(true);
    try { await postJSON<any>('/api/backups', { description: 'Dashboard backup' }); await fetchBackups(); }
    catch (e) { console.error(e); }
    setCreating(false);
  };

  const columns = [
    { key: 'id', header: 'Backup', render: (b: any) => <span className="font-mono text-xs">{b.backup_id || b.id}</span> },
    { key: 'size', header: 'Size', render: (b: any) => <span className="text-xs">{b.size ? `${(b.size / 1024).toFixed(1)} KB` : '—'}</span> },
    { key: 'date', header: 'Created', render: (b: any) => <span className="text-xs text-muted-foreground">{b.created_at ? new Date(b.created_at * 1000).toLocaleDateString() : '—'}</span> },
    { key: 'status', header: '', render: () => <Check className="w-3.5 h-3.5 text-success/60" />, className: 'text-right' },
  ];

  return (
    <div>
      <PageHeader title="Backups" description="Create and restore system backups"
        action={<div className="flex gap-2"><Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchBackups} /><Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={createBackup} disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button></div>}
      />

      {loading ? <Skeleton className="h-48" /> : backups.length === 0 ? (
        <EmptyState icon={<HardDrive className="w-8 h-8" />} title="No Backups" description="Create a backup to protect your data." />
      ) : (
        <Card><Table columns={columns} data={backups} emptyMessage="No backups found" /></Card>
      )}
    </div>
  );
}
