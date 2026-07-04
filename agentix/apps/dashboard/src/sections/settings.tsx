'use client';

import { useState, useEffect } from 'react';
import { Save, RotateCcw, ToggleLeft, ToggleRight, Eye, EyeOff } from 'lucide-react';
import { PageHeader, Button, Card, CardHeader, Input, Alert } from '@/components/ui';
import { fetchJSON, putJSON } from '@/lib/api';

export function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rpcUrl, setRpcUrl] = useState('');
  const [devMode, setDevMode] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<any>('/api/config');
      setConfig(data);
      setRpcUrl(data.rpcUrl || '');
      setDevMode(data.developerMode || false);
    } catch (e: any) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchConfig(); }, []);

  const saveConfig = async () => {
    setSaving(true); setMessage(null);
    try { await putJSON('/api/config', { rpcUrl }); setMessage({ type: 'success', text: 'Configuration saved' }); fetchConfig(); }
    catch (e: any) { setMessage({ type: 'error', text: e.message || 'Failed to save' }); }
    setSaving(false);
  };

  const toggleDevMode = async () => {
    const next = !devMode;
    try { await putJSON('/api/config', { developerMode: next }); setDevMode(next); setMessage({ type: 'success', text: `Developer mode ${next ? 'enabled' : 'disabled'}` }); }
    catch {}
  };

  const resetConfig = async () => {
    if (!confirm('Reset all configuration to defaults?')) return;
    setSaving(true); setMessage(null);
    try { await putJSON('/api/config', { rpcUrl: '', networkName: 'baseSepolia', chainId: 84532 }); setMessage({ type: 'success', text: 'Configuration reset' }); fetchConfig(); }
    catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  return (
    <div>
      <PageHeader title="Settings" description="Runtime configuration" />

      {message && <Alert variant={message.type} className="mb-4 max-w-xl">{message.text}</Alert>}

      <div className="space-y-4 max-w-xl">
        <Card>
          <CardHeader title="Network" />
          <div className="space-y-3">
            <Input label="RPC URL" value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} placeholder="https://sepolia.base.org" />
            <div><div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Network</div><div className="text-xs font-mono text-muted-foreground/60 px-3 py-2 rounded-lg bg-secondary">{config?.networkName || '—'}</div></div>
            <Button size="sm" icon={<Save className="w-3.5 h-3.5" />} onClick={saveConfig} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Developer Mode"
            action={<button onClick={toggleDevMode} className="text-muted-foreground hover:text-foreground transition-colors">{devMode ? <ToggleRight className="w-5 h-5 text-foreground" /> : <ToggleLeft className="w-5 h-5" />}</button>}
          />
          <div className="flex items-center gap-3">
            {devMode ? <Eye className="w-4 h-4 text-muted-foreground" /> : <EyeOff className="w-4 h-4 text-muted-foreground/40" />}
            <div>
              <div className="text-xs">{devMode ? 'Enabled' : 'Disabled'}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{devMode ? 'Contract addresses, selectors, and calldata visible in UI' : 'Human-readable permissions only'}</div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Storage" />
          <div className="space-y-2">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Data Directory</span><span className="font-mono">~/.agentix/</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Database</span><span className="font-mono">{config?.database?.path || '~/.agentix/db/agentix.db'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Backups</span><span className="font-mono">{config?.backup?.path || '~/.agentix/backups/'}</span></div>
          </div>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader title="Danger Zone" />
          <p className="text-xs text-muted-foreground/60 mb-3">These actions are irreversible.</p>
          <Button variant="danger" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={resetConfig} disabled={saving}>Reset Configuration</Button>
        </Card>
      </div>
    </div>
  );
}
