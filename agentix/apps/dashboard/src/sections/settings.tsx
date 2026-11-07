'use client';

import { useState, useEffect } from 'react';
import { Save, RotateCcw, ToggleLeft, ToggleRight, Eye, EyeOff } from 'lucide-react';
import { PageHeader, Button, Card, CardHeader, Input, Alert } from '@/components/ui';
import { fetchJSON, putJSON, getLocalToken, setLocalToken } from '@/lib/api';

/**
 * Settings page: RPC URL, the per-run local API token, developer mode, storage paths, and the danger-zone config reset.
 * @returns The settings page; the token field is initialized from dashboard-origin localStorage on mount.
 * Maps to: REST GET /api/config and PUT /api/config; Maps to: internal — getLocalToken / setLocalToken (lib/api).
 */
export function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rpcUrl, setRpcUrl] = useState('');
  const [devMode, setDevMode] = useState(false);
  // Local API token (R-5): the per-run X-Agentix-Token, initialised from
  // dashboard-origin localStorage (not from the server, which cannot be
  // read by the browser). Required for state-changing dashboard actions.
  const [localToken, setLocalTokenState] = useState('');

  /**
   * Persists (or clears) the per-run local API token from the token field into localStorage and reports the result.
   * @returns void.
   * Maps to: internal — setLocalToken (lib/api).
   * Side effects: writes/removes localStorage; shows a success message.
   * Security: the token is a bearer credential for the local API — it is stored only in this browser's localStorage.
   */
  const saveLocalToken = () => {
    setLocalToken(localToken || null);
    setMessage({ type: 'success', text: localToken ? 'Local API token saved in this browser' : 'Local API token cleared' });
  };

  useEffect(() => { setLocalTokenState(getLocalToken() || ''); }, []);

  /**
   * Reloads the runtime config from /api/config into the form fields (RPC URL, developer mode).
   * @returns void; on failure logs the error and leaves the previous config in place.
   * @throws Never — fetch errors are caught and logged.
   * Maps to: REST GET /api/config.
   * Side effects: sets config/rpcUrl/devMode/loading state.
   */
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

  /**
   * Saves the RPC URL to the server config and reloads it.
   * @returns void; on failure shows the error message.
   * @throws Never — errors are caught into `message` state.
   * Maps to: REST PUT /api/config { rpcUrl }.
   * Side effects: writes server config; reloads it.
   */
  const saveConfig = async () => {
    setSaving(true); setMessage(null);
    try { await putJSON('/api/config', { rpcUrl }); setMessage({ type: 'success', text: 'Configuration saved' }); fetchConfig(); }
    catch (e: any) { setMessage({ type: 'error', text: e.message || 'Failed to save' }); }
    setSaving(false);
  };

  /**
   * Flips developer mode on the server (contract addresses/selectors/calldata visible in the UI when on) and updates the toggle.
   * @returns void; on failure swallows the error silently — the toggle may then show the wrong state.
   * @throws Never — errors are caught and ignored.
   * Maps to: REST PUT /api/config { developerMode }.
   * Side effects: writes server config; sets devMode state.
   */
  const toggleDevMode = async () => {
    const next = !devMode;
    try { await putJSON('/api/config', { developerMode: next }); setDevMode(next); setMessage({ type: 'success', text: `Developer mode ${next ? 'enabled' : 'disabled'}` }); }
    catch {}
  };

  /**
   * Resets all configuration to defaults (empty RPC URL, baseSepolia, chain 84532) after a native confirm() dialog, then reloads.
   * @returns void; does nothing when the user cancels the confirm. On failure shows the error message.
   * @throws Never — errors are caught into `message` state.
   * Maps to: REST PUT /api/config.
   * Side effects: overwrites server config with defaults; reloads it.
   */
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
          <CardHeader title="Local API Token" />
          <div className="space-y-3">
            <Input label="Per-run server token" type="password" value={localToken} onChange={e => setLocalTokenState(e.target.value)} placeholder="Paste from the API server startup log" />
            <p className="text-[10px] text-muted-foreground/60">Required for state-changing actions (writes, approvals, policy changes). The server prints a fresh token on every start and writes it 0600 to AGENTIX_HOME/.local-token — paste it here once per server run. It is stored only in this browser's localStorage.</p>
            <Button size="sm" icon={<Save className="w-3.5 h-3.5" />} onClick={saveLocalToken}>Save Token</Button>
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
