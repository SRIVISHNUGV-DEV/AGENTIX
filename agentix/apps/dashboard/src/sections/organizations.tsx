'use client';

import { useState, useEffect } from 'react';
import { Building2, Plus, RefreshCw, CheckCircle2, XCircle, Bot, CreditCard, KeyRound, Wallet, User, Settings, ArrowRight, Loader2, ExternalLink, Cpu, Shield, Copy, Sparkles, Server, Globe, Trash2 } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Dialog, Input, Alert, StatusDot, Skeleton } from '@/components/ui';
import { fetchJSON, postJSON, deleteJSON, truncate, explorerAddress } from '@/lib/api';
import { useWalletCtx } from '@/lib/web3modal-provider';
import { sendAndWaitForWalletCreation, getAccount, sendCreateLightweightSession } from '@/lib/tx-sender';
import { getHarnessWallets, saveHarnessWallets, getAgentKey, setAgentKey } from '@/lib/storage';

const LOGO_MAP: Record<string, string> = {
  'claude-code': '/provider-logos/anthropic.svg',
  'mimocode': '/provider-logos/openai.svg',
  'opencode': '/provider-logos/deepseek.svg',
  'github-copilot': '/provider-logos/openai.svg',
  'hermes': '/provider-logos/google.svg',
  'cursor': '/provider-logos/cursor.svg',
  'gemini': '/provider-logos/gemini.svg',
  'openclaude': '/provider-logos/openclaude.svg',
};

type Tab = 'overview' | 'agents' | 'runtimes' | 'credentials' | 'sessions';

export function OrganizationsPage() {
  const { address, isConnected, openModal } = useWalletCtx();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Agent/harness state
  const [harnesses, setHarnesses] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [harnessWalletMap, setHarnessWalletMap] = useState<Record<string, string>>(() => getHarnessWallets());
  const [creating, setCreating] = useState(false);
  const [agentKey, setAgentKeyState] = useState<{ address: string; privateKey: string } | null>(() => getAgentKey());
  const [showSecretKey, setShowSecretKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Session form
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [sessionSpendLimit, setSessionSpendLimit] = useState('0.1');
  const [sessionTxLimit, setSessionTxLimit] = useState('10');
  const [sessionExpiryDays, setSessionExpiryDays] = useState('30');
  const [sessionKey, setSessionKey] = useState('');
  const [sessionTargets, setSessionTargets] = useState('');

  // Credential form
  const [showIssueCred, setShowIssueCred] = useState(false);
  const [credAgentId, setCredAgentId] = useState('');
  const [credWallet, setCredWallet] = useState('');
  const [credBudget, setCredBudget] = useState('0.1');
  const [credExpiry, setCredExpiry] = useState('30');

  // Runtime state
  const [runtimes, setRuntimes] = useState<any[]>([]);
  const [showAddRuntime, setShowAddRuntime] = useState(false);
  const [rtName, setRtName] = useState('');
  const [rtEndpoint, setRtEndpoint] = useState('');
  const [rtModel, setRtModel] = useState('');
  const [rtApiKey, setRtApiKey] = useState('');

  useEffect(() => { saveHarnessWallets(harnessWalletMap); }, [harnessWalletMap]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [orgData, reqData, h, w, s, c, r] = await Promise.allSettled([
        fetchJSON<any>('/api/organizations'),
        fetchJSON<any>('/api/organizations/requests'),
        fetchJSON<any>('/api/onboarding/harnesses'),
        fetchJSON<any>('/api/wallets'),
        fetchJSON<any>('/api/sessions/all'),
        fetchJSON<any>('/api/credentials'),
        fetchJSON<any>('/api/runtimes'),
      ]);
      if (orgData.status === 'fulfilled') setOrgs(orgData.value.value || orgData.value || []);
      if (reqData.status === 'fulfilled') setRequests(reqData.value.value || reqData.value || []);
      if (h.status === 'fulfilled') {
        const list = h.value?.harnesses || [];
        setHarnesses(list.filter((x: any) => x.detect?.found).map((x: any) => ({ ...x.detect.harness, adapter: x.adapter })));
      }
      if (w.status === 'fulfilled') setWallets(w.value.value || w.value || []);
      if (s.status === 'fulfilled') setSessions(s.value.value || s.value || []);
      if (c.status === 'fulfilled') setCredentials(c.value.value || c.value || []);
      if (r.status === 'fulfilled') setRuntimes(Array.isArray(r.value) ? r.value : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const submitRequest = async () => {
    if (!name.trim() || !address) return;
    setSubmitting(true); setMessage(null);
    try {
      const result = await postJSON<any>('/api/organizations/requests', { name: name.trim(), ownerAddress: address });
      if (result.success) { setMessage({ type: 'success', text: 'Request submitted.' }); setName(''); setShowForm(false); fetchAll(); }
      else setMessage({ type: 'error', text: result.error || 'Failed' });
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSubmitting(false);
  };

  const approveRequest = async (id: string) => { try { await postJSON(`/api/organizations/requests/${id}`, { action: 'approve' }); fetchAll(); } catch {} };
  const rejectRequest = async (id: string) => { try { await postJSON(`/api/organizations/requests/${id}`, { action: 'reject' }); fetchAll(); } catch {} };

  // Runtime CRUD
  const orgRuntimes = runtimes.filter((r: any) => r.organization_id === selectedOrg?.id);

  const addRuntime = async () => {
    if (!rtName.trim() || !rtEndpoint.trim() || !selectedOrg) return;
    try {
      const result = await postJSON<any>('/api/runtimes', {
        organizationId: selectedOrg.id,
        name: rtName.trim(),
        endpoint: rtEndpoint.trim(),
        modelName: rtModel.trim(),
        apiKeyHash: rtApiKey ? btoa(rtApiKey) : '',
      });
      if (result.success) {
        setShowAddRuntime(false); setRtName(''); setRtEndpoint(''); setRtModel(''); setRtApiKey('');
        setSuccess('Runtime registered'); fetchAll();
      } else setError(result.error || 'Failed');
    } catch (e: any) { setError(e.message); }
  };

  const deleteRuntime = async (id: string) => {
    try { await deleteJSON('/api/runtimes', { id }); fetchAll(); } catch {}
  };

  const checkRuntimeHealth = async (rt: any) => {
    try {
      const result = await postJSON<any>('/api/runtimes/health', { id: rt.id, endpoint: rt.endpoint });
      setSuccess(`Runtime ${rt.name}: ${result.status}`);
      fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  // Org-scoped data
  const orgCredentials = credentials.filter((c: any) => c.organizationId === selectedOrg?.id || c.organization_id === selectedOrg?.id);
  const orgWallets = wallets; // All wallets (orgs don't own wallets directly, agents do)
  const orgSessions = sessions;

  // Agent setup
  const setupAgent = async (harness: any) => {
    if (!isConnected) { openModal(); return; }
    if (harnessWalletMap[harness.id]) { setError(`${harness.name} already has a wallet`); return; }
    setCreating(true); setError(null);
    try {
      const owner = await getAccount();
      const { ethers } = await import('ethers');
      const wallet = ethers.Wallet.createRandom();
      const key = { address: wallet.address, privateKey: wallet.privateKey };
      setAgentKeyState(key);
      setAgentKey(key);
      setShowSecretKey(wallet.privateKey);

      const result = await sendAndWaitForWalletCreation(owner);
      setHarnessWalletMap(prev => ({ ...prev, [harness.id]: result.walletAddress }));
      await fetchAll();
      setSuccess(`${harness.name} wallet created at ${truncate(result.walletAddress, 8)}`);
    } catch (e: any) { if (e.code !== 4001) setError(e.message || 'Setup failed'); }
    setCreating(false);
  };

  // Session creation
  const handleCreateSession = async (walletAddr: string) => {
    if (!isConnected) return;
    setShowCreateSession(false); setError(null); setSuccess(null);
    try {
      const owner = await getAccount();
      const key = sessionKey || owner;
      const allowedTargets = sessionTargets ? sessionTargets.split(',').map(t => t.trim()).filter(Boolean) : [];
      await sendCreateLightweightSession(walletAddr, owner, {
        sessionKey: key, dailySpendLimitEth: sessionSpendLimit || '0.1',
        dailyTxLimit: parseInt(sessionTxLimit) || 10, expiryDays: parseInt(sessionExpiryDays) || 30, allowedTargets,
      });
      setSuccess('Session created'); fetchAll();
    } catch (e: any) { setError(e.message || 'Session creation failed'); }
  };

  // Credential issuance
  const handleIssueCred = async () => {
    if (!credWallet || !selectedOrg) return;
    setError(null); setSuccess(null);
    try {
      const result = await postJSON<any>('/api/credentials', {
        orgId: selectedOrg.id, budgetLimit: credBudget, expiryDuration: parseInt(credExpiry), expiryUnit: 'days',
        walletAddress: credWallet, ownerAddress: address || '',
      });
      if (result.success) {
        setShowIssueCred(false); setSuccess(`Credential issued! Agent #${result.agentId}`);
        setShowSecretKey(result.secret); fetchAll();
      } else setError(result.error || 'Failed');
    } catch (e: any) { setError(e.message); }
  };

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'runtimes', label: 'Runtimes', icon: Server },
    { id: 'credentials', label: 'Credentials', icon: CreditCard },
    { id: 'sessions', label: 'Sessions', icon: KeyRound },
  ];

  return (
    <div>
      <PageHeader title="Organizations" description="Organization hub — agents, credentials, and sessions"
        action={<div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchAll} />
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowForm(true)}>Request Org</Button>
        </div>}
      />

      {message && <Alert variant={message.type} className="mb-4">{message.text}</Alert>}
      {error && <Alert variant="error" className="mb-4"><div className="flex-1">{error}</div><button onClick={() => setError(null)} className="flex-shrink-0">&times;</button></Alert>}
      {success && <Alert variant="success" className="mb-4"><div className="flex-1">{success}</div><button onClick={() => setSuccess(null)} className="flex-shrink-0">&times;</button></Alert>}

      {/* Secret key banner */}
      {showSecretKey && (
        <Alert variant="warning" className="mb-4">
          <div className="flex-1">
            <div className="text-xs font-medium mb-1">Secret Key — Save this!</div>
            <div className="flex items-center gap-2 bg-background/50 rounded px-3 py-2 mt-1">
              <code className="text-[10px] font-mono break-all flex-1">{showSecretKey}</code>
              <button onClick={() => navigator.clipboard.writeText(showSecretKey)} className="text-muted-foreground/40 hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <button onClick={() => setShowSecretKey(null)} className="text-[10px] text-muted-foreground/40 hover:text-foreground flex-shrink-0">Dismiss</button>
        </Alert>
      )}

      <Dialog open={showForm} onClose={() => setShowForm(false)} title="Request Organization">
        <div className="space-y-4">
          <Input label="Organization Name" value={name} onChange={e => setName(e.target.value)} placeholder="My Organization" />
          <div><div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Owner</div><div className="text-xs font-mono text-muted-foreground/60 px-3 py-2 rounded-lg bg-secondary">{address || 'Connect wallet first'}</div></div>
          <div className="flex gap-2"><Button size="sm" onClick={submitRequest} disabled={submitting || !name.trim() || !address}>{submitting ? 'Submitting...' : 'Submit'}</Button><Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </div>
      </Dialog>

      {/* Session Dialog */}
      <Dialog open={showCreateSession} onClose={() => setShowCreateSession(false)} title="Create Lightweight Session">
        <div className="space-y-4">
          <Input label="Session Key Address" value={sessionKey} onChange={e => setSessionKey(e.target.value)} placeholder="Defaults to your wallet" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Daily Spend (ETH)" value={sessionSpendLimit} onChange={e => setSessionSpendLimit(e.target.value)} type="number" placeholder="0.1" />
            <Input label="Daily Tx Limit" value={sessionTxLimit} onChange={e => setSessionTxLimit(e.target.value)} type="number" placeholder="10" />
          </div>
          <Input label="Expiry (days)" value={sessionExpiryDays} onChange={e => setSessionExpiryDays(e.target.value)} type="number" placeholder="30" />
          <Input label="Allowed Targets (optional)" value={sessionTargets} onChange={e => setSessionTargets(e.target.value)} placeholder="0xabc..., 0xdef..." />
          <div className="flex gap-2">
            <Button onClick={() => { const w = orgWallets[0]; if (w) handleCreateSession(w.wallet_address); }} icon={<KeyRound className="w-3.5 h-3.5" />}>Create & Sign</Button>
            <Button variant="ghost" onClick={() => setShowCreateSession(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Credential Dialog */}
      <Dialog open={showIssueCred} onClose={() => setShowIssueCred(false)} title="Issue Credential">
        <div className="space-y-4">
          <select value={credWallet} onChange={e => setCredWallet(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground">
            <option value="">Select wallet...</option>
            {orgWallets.map((w: any) => <option key={w.wallet_address} value={w.wallet_address}>{truncate(w.wallet_address, 12)}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Budget (ETH)" value={credBudget} onChange={e => setCredBudget(e.target.value)} type="number" placeholder="0.1" />
            <Input label="Expiry (days)" value={credExpiry} onChange={e => setCredExpiry(e.target.value)} type="number" placeholder="30" />
          </div>
          <p className="text-[10px] text-muted-foreground/60">Creates a Poseidon(7) ZK credential in {selectedOrg?.name}'s Merkle tree.</p>
          <div className="flex gap-2">
            <Button onClick={handleIssueCred} icon={<CreditCard className="w-3.5 h-3.5" />}>Issue</Button>
            <Button variant="ghost" onClick={() => setShowIssueCred(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Runtime Dialog */}
      <Dialog open={showAddRuntime} onClose={() => setShowAddRuntime(false)} title="Register Runtime">
        <div className="space-y-4">
          <Input label="Runtime Name" value={rtName} onChange={e => setRtName(e.target.value)} placeholder="Production LLM Server" />
          <Input label="Endpoint URL" value={rtEndpoint} onChange={e => setRtEndpoint(e.target.value)} placeholder="https://api.mycompany.com/v1" />
          <Input label="Model Name" value={rtModel} onChange={e => setRtModel(e.target.value)} placeholder="gpt-4, llama-3, custom-model" />
          <Input label="API Key (stored hashed)" value={rtApiKey} onChange={e => setRtApiKey(e.target.value)} type="password" placeholder="sk-..." />
          <p className="text-[10px] text-muted-foreground/60">Register your company's self-hosted model runtime. The endpoint should expose a health check at /health.</p>
          <div className="flex gap-2">
            <Button onClick={addRuntime} icon={<Server className="w-3.5 h-3.5" />}>Register</Button>
            <Button variant="ghost" onClick={() => setShowAddRuntime(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {loading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left: Org List */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">Organizations</h3>
            {orgs.map((o: any) => (
              <button key={o.id} onClick={() => { setSelectedOrg(o); setActiveTab('overview'); }}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  selectedOrg?.id === o.id ? 'border-foreground/30 bg-foreground/5' : 'border-border bg-card hover:border-foreground/20'
                }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">{o.name}</div>
                    <div className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">{o.id}</div>
                  </div>
                  <Badge variant={o.active ? 'success' : 'danger'}>{o.active ? 'Active' : 'Inactive'}</Badge>
                </div>
              </button>
            ))}

            {/* Pending Requests */}
            {requests.length > 0 && (
              <>
                <h3 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mt-4 mb-2">Pending Requests</h3>
                {requests.map((r: any) => (
                  <div key={r.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium">{r.name}</div>
                        <div className="text-[9px] font-mono text-muted-foreground/40">{truncate(r.owner_address, 8)}</div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => approveRequest(r.id)} className="p-1 rounded hover:bg-success/10"><CheckCircle2 className="w-3.5 h-3.5 text-success/60" /></button>
                        <button onClick={() => rejectRequest(r.id)} className="p-1 rounded hover:bg-destructive/10"><XCircle className="w-3.5 h-3.5 text-destructive/60" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {orgs.length === 0 && requests.length === 0 && (
              <div className="text-xs text-muted-foreground/50 py-6 text-center">No organizations yet.</div>
            )}
          </div>

          {/* Right: Org Detail */}
          <div className="lg:col-span-3">
            {!selectedOrg ? (
              <Card className="py-16 text-center">
                <Building2 className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground/50">Select an organization to view details.</p>
              </Card>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex gap-1 mb-4 border-b border-border pb-0">
                  {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all -mb-[1px] ${
                          activeTab === tab.id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground/60 hover:text-foreground'
                        }`}>
                        <Icon className="w-3.5 h-3.5" /> {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <div className="space-y-4">
                    <Card>
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-medium">{selectedOrg.name}</div>
                        <Badge variant={selectedOrg.active ? 'success' : 'danger'}>{selectedOrg.active ? 'Active' : 'Inactive'}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><span className="text-muted-foreground/60">ID</span><div className="font-mono mt-0.5">{selectedOrg.id}</div></div>
                        <div><span className="text-muted-foreground/60">Owner</span><div className="font-mono mt-0.5">{truncate(selectedOrg.owner_address, 10)}</div></div>
                        <div><span className="text-muted-foreground/60">Credential Anchor</span><div className="font-mono mt-0.5">{selectedOrg.credential_anchor ? truncate(selectedOrg.credential_anchor, 10) : 'Not deployed'}</div></div>
                        <div><span className="text-muted-foreground/60">Created</span><div className="mt-0.5">{selectedOrg.created_at ? new Date(selectedOrg.created_at * 1000).toLocaleDateString() : '—'}</div></div>
                      </div>
                    </Card>

                    <div className="grid grid-cols-3 gap-3">
                      <Card className="text-center py-4"><div className="text-lg font-bold">{orgCredentials.length}</div><div className="text-[10px] text-muted-foreground/60">Credentials</div></Card>
                      <Card className="text-center py-4"><div className="text-lg font-bold">{orgWallets.length}</div><div className="text-[10px] text-muted-foreground/60">Wallets</div></Card>
                      <Card className="text-center py-4"><div className="text-lg font-bold">{orgSessions.length}</div><div className="text-[10px] text-muted-foreground/60">Sessions</div></Card>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Card>
                        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Connected Harnesses</div>
                        <div className="space-y-1.5">
                          {harnesses.map((h: any) => (
                            <div key={h.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                              <img src={LOGO_MAP[h.id] || ''} alt="" className="w-5 h-5 rounded object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-medium truncate">{h.name}</div>
                                {harnessWalletMap[h.id] && <div className="text-[8px] font-mono text-muted-foreground/40">{truncate(harnessWalletMap[h.id], 8)}</div>}
                              </div>
                              <StatusDot status={h.status === 'connected' ? 'online' : 'warning'} />
                            </div>
                          ))}
                          {harnesses.length === 0 && <div className="text-[10px] text-muted-foreground/40">No harnesses detected</div>}
                        </div>
                      </Card>

                      <Card>
                        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Model Runtimes</div>
                        <div className="space-y-1.5">
                          {orgRuntimes.map((rt: any) => (
                            <div key={rt.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                              <Server className="w-4 h-4 text-muted-foreground/40" />
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-medium truncate">{rt.name}</div>
                                <div className="text-[8px] text-muted-foreground/40">{rt.model_name || 'Custom'}</div>
                              </div>
                              <StatusDot status={rt.status === 'active' ? 'online' : 'error'} />
                            </div>
                          ))}
                          {orgRuntimes.length === 0 && <div className="text-[10px] text-muted-foreground/40">No runtimes registered</div>}
                        </div>
                      </Card>
                    </div>
                  </div>
                )}

                {/* Agents Tab */}
                {activeTab === 'agents' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium">Agent Harnesses</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {harnesses.map((h: any) => {
                        const walletAddr = harnessWalletMap[h.id];
                        const wallet = walletAddr ? wallets.find((w: any) => w.wallet_address === walletAddr) : null;
                        return (
                          <Card key={h.id} className="p-4">
                            <div className="flex items-center gap-3 mb-3">
                              <img src={LOGO_MAP[h.id] || ''} alt="" className="w-8 h-8 rounded object-contain bg-secondary/50 p-1"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium">{h.name}</div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <StatusDot status={h.status === 'connected' ? 'online' : 'warning'} />
                                  <span className="text-[9px] text-muted-foreground/60">{h.status}</span>
                                </div>
                              </div>
                            </div>

                            {wallet ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-muted-foreground/60">Wallet</span>
                                  <a href={explorerAddress(wallet.wallet_address)} target="_blank" rel="noopener noreferrer"
                                    className="font-mono text-blue-400 hover:underline flex items-center gap-1">
                                    {truncate(wallet.wallet_address, 8)} <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-muted-foreground/60">Owner</span>
                                  <span className="font-mono">{truncate(wallet.owner_address, 8)}</span>
                                </div>
                                {agentKey && (
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-muted-foreground/60">Agent Key</span>
                                    <span className="font-mono text-success/80">{truncate(agentKey.address, 8)}</span>
                                  </div>
                                )}
                                <div className="flex gap-1.5 mt-2 pt-2 border-t border-border">
                                  <Button variant="ghost" size="sm" onClick={() => { setSessionKey(wallet.owner_address); setShowCreateSession(true); }}>
                                    <KeyRound className="w-3 h-3 mr-1" /> Session
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => { setCredWallet(wallet.wallet_address); setShowIssueCred(true); }}>
                                    <CreditCard className="w-3 h-3 mr-1" /> Credential
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button size="sm" onClick={() => setupAgent(h)} disabled={creating || !isConnected}
                                icon={creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                                className="w-full mt-2">
                                {creating ? 'Deploying...' : isConnected ? 'Deploy Wallet' : 'Connect Wallet'}
                              </Button>
                            )}
                          </Card>
                        );
                      })}
                      {harnesses.length === 0 && (
                        <Card className="py-10 text-center col-span-2">
                          <Cpu className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                          <p className="text-xs text-muted-foreground/50">No AI harnesses detected. Install Claude Code, OpenCode, or MimoCode.</p>
                        </Card>
                      )}
                    </div>
                  </div>
                )}

                {/* Runtimes Tab */}
                {activeTab === 'runtimes' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium">Model Runtimes ({orgRuntimes.length})</h3>
                      <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />}
                        onClick={() => setShowAddRuntime(true)}>
                        Register Runtime
                      </Button>
                    </div>

                    <p className="text-[10px] text-muted-foreground/60">
                      Register your organization's self-hosted model endpoints. These are servers your company runs
                      with custom or fine-tuned models, separate from third-party AI harnesses.
                    </p>

                    {orgRuntimes.length === 0 ? (
                      <Card className="py-10 text-center">
                        <Server className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                        <p className="text-xs text-muted-foreground/50">No runtimes registered yet. Add your company's model endpoints.</p>
                      </Card>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {orgRuntimes.map((rt: any) => (
                          <Card key={rt.id} className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-secondary/50 flex items-center justify-center">
                                  <Server className="w-4 h-4 text-muted-foreground/60" />
                                </div>
                                <div>
                                  <div className="text-xs font-medium">{rt.name}</div>
                                  <div className="text-[9px] text-muted-foreground/60 mt-0.5">{rt.model_name || 'Custom Model'}</div>
                                </div>
                              </div>
                              <StatusDot status={rt.status === 'active' ? 'online' : rt.status === 'unhealthy' ? 'warning' : 'error'} />
                            </div>

                            <div className="space-y-1.5 mb-3">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-muted-foreground/60">Endpoint</span>
                                <span className="font-mono text-muted-foreground truncate max-w-[200px]">{rt.endpoint}</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-muted-foreground/60">Status</span>
                                <Badge variant={rt.status === 'active' ? 'success' : rt.status === 'unhealthy' ? 'warning' : 'danger'}>
                                  {rt.status}
                                </Badge>
                              </div>
                              {rt.last_health_check && (
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-muted-foreground/60">Last Check</span>
                                  <span className="text-muted-foreground">{new Date(rt.last_health_check * 1000).toLocaleString()}</span>
                                </div>
                              )}
                            </div>

                            <div className="flex gap-1.5 pt-2 border-t border-border">
                              <Button variant="ghost" size="sm" onClick={() => checkRuntimeHealth(rt)}>
                                <Globe className="w-3 h-3 mr-1" /> Health Check
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deleteRuntime(rt.id)}>
                                <Trash2 className="w-3 h-3 mr-1 text-destructive/60" /> Remove
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Credentials Tab */}
                {activeTab === 'credentials' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium">Issued Credentials ({orgCredentials.length})</h3>
                      <Button size="sm" icon={<CreditCard className="w-3.5 h-3.5" />}
                        onClick={() => setShowIssueCred(true)} disabled={orgWallets.length === 0}>
                        Issue Credential
                      </Button>
                    </div>

                    {orgWallets.length === 0 && (
                      <Alert variant="warning">Deploy a wallet first in the Agents tab before issuing credentials.</Alert>
                    )}

                    {orgCredentials.length === 0 ? (
                      <Card className="py-10 text-center">
                        <CreditCard className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                        <p className="text-xs text-muted-foreground/50">No credentials issued under {selectedOrg.name} yet.</p>
                      </Card>
                    ) : (
                      <Card>
                        <Table columns={[
                          { key: 'agent', header: 'Agent', render: (c: any) => <span className="font-mono text-xs">#{c.agentId || c.agent_id}</span> },
                          { key: 'wallet', header: 'Wallet', render: (c: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(c.walletAddress || c.wallet_address || '', 8)}</span> },
                          { key: 'budget', header: 'Budget', render: (c: any) => <span className="text-xs">{c.budgetEth || c.budget_limit || '—'} ETH</span> },
                          { key: 'status', header: 'Status', render: (c: any) => <Badge variant={c.revoked ? 'danger' : 'success'}>{c.revoked ? 'Revoked' : 'Active'}</Badge> },
                          { key: 'expiry', header: 'Expires', render: (c: any) => <span className="text-xs text-muted-foreground">{c.expiry ? new Date(c.expiry * 1000).toLocaleDateString() : '—'}</span> },
                        ]} data={orgCredentials} emptyMessage="No credentials" />
                      </Card>
                    )}
                  </div>
                )}

                {/* Sessions Tab */}
                {activeTab === 'sessions' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium">Sessions ({orgSessions.length})</h3>
                      <Button size="sm" icon={<KeyRound className="w-3.5 h-3.5" />}
                        onClick={() => setShowCreateSession(true)} disabled={orgWallets.length === 0}>
                        Create Session
                      </Button>
                    </div>

                    {orgSessions.length === 0 ? (
                      <Card className="py-10 text-center">
                        <KeyRound className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                        <p className="text-xs text-muted-foreground/50">No sessions created yet.</p>
                      </Card>
                    ) : (
                      <Card>
                        <Table columns={[
                          { key: 'session', header: 'Session ID', render: (s: any) => <span className="font-mono text-xs">{truncate(s.session_id, 12)}</span> },
                          { key: 'wallet', header: 'Wallet', render: (s: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(s.wallet_address, 8)}</span> },
                          { key: 'spend', header: 'Daily Spend', render: (s: any) => <span className="text-xs">{s.daily_spend_limit || '—'} ETH</span> },
                          { key: 'txLimit', header: 'Daily Tx', render: (s: any) => <span className="text-xs">{s.daily_tx_limit || '—'}</span> },
                          { key: 'status', header: 'Status', render: (s: any) => <Badge variant={s.revoked ? 'danger' : 'success'}>{s.revoked ? 'Revoked' : 'Active'}</Badge> },
                          { key: 'expiry', header: 'Expires', render: (s: any) => <span className="text-xs text-muted-foreground">{s.expiry ? new Date(s.expiry * 1000).toLocaleDateString() : '—'}</span> },
                        ]} data={orgSessions} emptyMessage="No sessions" />
                      </Card>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
