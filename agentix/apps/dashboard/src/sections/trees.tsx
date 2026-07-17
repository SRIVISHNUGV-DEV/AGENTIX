'use client';

import { useState, useEffect } from 'react';
import { TreePine, RefreshCw, Lock, Layers, Leaf } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, CardHeader, Skeleton } from '@/components/ui';
import { fetchJSON } from '@/lib/api';

function truncateHash(s: string, chars = 12): string {
  if (!s || s === '0' || s === '0x0') return '—';
  return s.length > chars + 4 ? `${s.slice(0, chars)}...${s.slice(-6)}` : s;
}

export function TreesPage() {
  const [trees, setTrees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrees = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/trees/all');
      setTrees(data.value || data || []);
    } catch (e) { console.error('Failed to fetch trees:', e); }
    setLoading(false);
  };

  useEffect(() => { fetchTrees(); }, []);

  return (
    <div>
      <PageHeader title="Merkle Trees" description="Active and revoked credential commitment trees"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary border border-border">
              <Lock className="w-3 h-3 text-muted-foreground/60" />
              <span className="text-[9px] text-muted-foreground/60 tracking-wider uppercase">Read-Only</span>
            </div>
            <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchTrees} />
          </div>
        }
      />

      {loading ? <Skeleton className="h-64" /> : trees.length === 0 ? (
        <EmptyState icon={<TreePine className="w-8 h-8" />} title="No Trees Initialized" description="Trees are created when you issue credentials. Issue a credential from the Credentials page." />
      ) : (
        <div className="space-y-4">
          {trees.map((tree: any) => (
            <Card key={tree.organizationId}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-medium">{tree.name || 'Standalone'}</h3>
                  <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">{truncateHash(tree.organizationId, 16)}</p>
                </div>
                <Badge variant={tree.activeLeaves > 0 ? 'success' : 'default'}>{tree.activeLeaves > 0 ? 'Active' : 'Empty'}</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2"><span className="w-1.5 h-1.5 rounded-full bg-success" /><span className="text-[10px] text-muted-foreground/60 tracking-wider uppercase">Active Tree</span></div>
                  <div className="space-y-1.5 pl-3 border-l border-border">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Root</span><span className="font-mono text-[10px]">{truncateHash(tree.activeRoot, 14)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Epoch</span><span className="font-mono">{tree.activeEpoch}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Leaves</span><span className="font-mono">{tree.activeLeaves}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Depth</span><span className="font-mono">20</span></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2"><span className="w-1.5 h-1.5 rounded-full bg-destructive/60" /><span className="text-[10px] text-muted-foreground/60 tracking-wider uppercase">Revoked Tree</span></div>
                  <div className="space-y-1.5 pl-3 border-l border-border">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Root</span><span className="font-mono text-[10px]">{truncateHash(tree.revokedRoot, 14)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Epoch</span><span className="font-mono">{tree.revokedEpoch}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Revoked</span><span className="font-mono">{tree.revokedLeaves || tree.revokedEpoch}</span></div>
                  </div>
                </div>
              </div>

              {/* Mini tree visualization */}
              {tree.activeLeaves > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2 mb-2"><Layers className="w-3 h-3 text-muted-foreground/40" /><span className="text-[10px] text-muted-foreground/60 tracking-wider uppercase">Leaves</span></div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: Math.min(tree.activeLeaves, 24) }).map((_, i) => (
                      <div key={i} className="w-4 h-4 rounded bg-success/20 border border-success/30 flex items-center justify-center"><Leaf className="w-2 h-2 text-success/60" /></div>
                    ))}
                    {tree.activeLeaves > 24 && <div className="w-4 h-4 rounded bg-secondary border border-border flex items-center justify-center text-[7px] text-muted-foreground/40">+{tree.activeLeaves - 24}</div>}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
