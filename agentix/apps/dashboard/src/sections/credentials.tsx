'use client';

import { useState, useEffect } from 'react';
import {
  CreditCard, RefreshCw, Shield, ShieldOff, Plus, Eye, EyeOff, Copy, Check,
  Wallet, AlertTriangle, DollarSign, Loader2, Circle, ChevronRight, ExternalLink
} from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Table, Dialog, Input, Select, Alert, StatusDot, Skeleton, Progress } from '@/components/ui';
import { fetchJSON, postJSON, truncate, explorerAddress } from '@/lib/api';
import { useWalletCtx } from '@/lib/web3modal-provider';
import {
  sendAndWaitForWalletCreation, getAccount, sendUpdateRoot, sendEntryPointDeposit, sendCreateLightweightSession,
  sendCreateStandardSession,
} from '@/lib/tx-sender';

type FlowStep = 'wallet' | 'credential' | 'root' | 'session' | 'fund';
const FLOW_STEPS: { id: FlowStep; label: string }[] = [
  { id: 'wallet', label: 'Create Wallet' }, { id: 'credential', label: 'Issue Credential' },
  { id: 'root', label: 'Update Root' }, { id: 'session', label: 'Create Session' }, { id: 'fund', label: 'Fund Wallet' },
];

export function CredentialsPage() {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [nextAgentId, setNextAgentId] = useState(1);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [oracle, setOracle] = useState<any>(null);
  const { address, isConnected } = useWalletCtx();

  const [form, setForm] = useState({ selectedOrg: '', budgetEth: '0.1', expiryDuration: '30', expiryUnit: 'days' as 'days' | 'months', depositEth: '0.01' });

  const [flowState, setFlowState] = useState({ currentStep: null as FlowStep | null, completed: new Set<FlowStep>(), walletAddress: '', credentialSecret: '', credentialId: '', activeRoot: '', error: '' });

  const fetchOracle = async () => {
    setPriceLoading(true); setPriceError(null);
    try { const data = await fetchJSON<any>('/api/credentials/oracle'); setOracle(data); if (data.ethPrice) setEthPrice(data.ethPrice); }
    catch (e: any) { setPriceError(e?.message || 'Failed to fetch'); }
    setPriceLoading(false);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [credData, orgData, agentData] = await Promise.all([
        fetchJSON<any>('/api/credentials'), fetchJSON<any>('/api/credentials/orgs'), fetchJSON<any>('/api/credentials/next-agent-id'),
      ]);
      setCredentials(credData.value || credData || []);
      setOrgs(orgData.value || orgData || []);
      setNextAgentId(agentData.agentId || 1);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    fetchOracle();
    const interval = setInterval(fetchOracle, 30000); // Poll price every 30s
    return () => clearInterval(interval);
  }, []);

  const completeFlowStep = (step: FlowStep) => {
    setFlowState(prev => { const completed = new Set(prev.completed); completed.add(step); return { ...prev, completed }; });
  };

  const resetFlow = () => setFlowState({ currentStep: null, completed: new Set(), walletAddress: '', credentialSecret: '', credentialId: '', activeRoot: '', error: '' });

  const handleStartFlow = async () => {
    if (!isConnected) { alert('Connect your wallet first'); return; }
    const budget = parseFloat(form.budgetEth);
    if (!form.budgetEth || isNaN(budget) || budget <= 0) { alert('Set a valid budget limit'); return; }
    if (!form.expiryDuration || parseInt(form.expiryDuration) <= 0) { alert('Set a valid expiry'); return; }
    if (!form.selectedOrg) { alert('Select an organization'); return; }

    resetFlow();
    setIssuing(true);
    setFlowState(prev => ({ ...prev, currentStep: 'wallet' }));

    try {
      const ownerAddress = await getAccount();
      setFlowState(prev => ({ ...prev, currentStep: 'wallet', error: '' }));
      const walletResult = await sendAndWaitForWalletCreation(ownerAddress);
      completeFlowStep('wallet');

      setFlowState(prev => ({ ...prev, currentStep: 'credential', walletAddress: walletResult.walletAddress, error: '' }));
      const orgId = form.selectedOrg;
      const credResult = await postJSON<any>('/api/credentials', { orgId, budgetLimit: form.budgetEth, expiryDuration: parseInt(form.expiryDuration), expiryUnit: form.expiryUnit, walletAddress: walletResult.walletAddress, ownerAddress });
      if (!credResult.success) throw new Error(credResult.error || 'Credential issuance failed');
      completeFlowStep('credential');

      setFlowState(prev => ({ ...prev, currentStep: 'root', credentialSecret: credResult.secret, credentialId: credResult.credentialId, activeRoot: credResult.activeRoot, error: '' }));
      const rootResult = await sendUpdateRoot(credResult.activeRoot);
      if (rootResult.success) completeFlowStep('root');
      else { setFlowState(prev => ({ ...prev, error: `Root update failed: ${rootResult.error}` })); completeFlowStep('root'); }

      // Org-issued credentials default to a ZK (standard) session: the proof
      // authorizes on-chain, the org policy stays private, and no owner signature
      // is spent per action. Lightweight (owner-signed) is the fallback only if
      // proof generation/verification can't complete — it's the right default for
      // standalone/owner-operated wallets, not for org-credentialed agents.
      setFlowState(prev => ({ ...prev, currentStep: 'session', error: '' }));
      try {
        await sendCreateStandardSession(
          walletResult.walletAddress,
          orgId,
          credResult.agentId,
          undefined, // let the runtime mint a dedicated per-session key
          { maxValue: undefined },
        );
        completeFlowStep('session');
      } catch (zkErr: any) {
        // Fallback: owner-signed lightweight session so issuance still yields a
        // usable session, with a clear note that the private ZK path was skipped.
        try {
          await sendCreateLightweightSession(walletResult.walletAddress, ownerAddress, { expiryDays: parseInt(form.expiryDuration), dailySpendLimitEth: form.budgetEth });
          completeFlowStep('session');
          setFlowState(prev => ({ ...prev, error: `ZK session unavailable (${zkErr.message}); fell back to a lightweight owner-signed session.` }));
        } catch (e: any) {
          setFlowState(prev => ({ ...prev, error: `Session failed: ${e.message}` }));
        }
      }

      setFlowState(prev => ({ ...prev, currentStep: 'fund', error: '' }));
      try { await sendEntryPointDeposit(walletResult.walletAddress, form.depositEth); completeFlowStep('fund'); }
      catch (e: any) { setFlowState(prev => ({ ...prev, error: `Gas deposit failed: ${e.message}` })); }

      setRevealSecret(credResult.secret);
      fetchData(); fetchOracle();
    } catch (e: any) {
      setFlowState(prev => ({ ...prev, error: e.code === 4001 ? 'Transaction rejected' : e.message }));
    }
    setIssuing(false);
  };

  const copySecret = (secret: string) => { navigator.clipboard.writeText(secret); setCopied(secret); setTimeout(() => setCopied(null), 2000); };

  // ZK session creation state (privacy USP path — proof authorizes, no owner signature)
  const [zkSessionBusy, setZkSessionBusy] = useState<number | null>(null);
  const [zkSessionMsg, setZkSessionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const createZkSession = async (cred: any) => {
    if (!isConnected) { alert('Connect your wallet first'); return; }
    if (!cred.walletAddress) { setZkSessionMsg({ type: 'error', text: 'Credential has no bound wallet' }); return; }
    setZkSessionBusy(cred.agentId);
    setZkSessionMsg(null);
    try {
      const result = await sendCreateStandardSession(
        cred.walletAddress,
        cred.organizationId,
        cred.agentId,
        undefined, // runtime mints a dedicated per-session key the agent signs with
        { maxValue: undefined },
      );
      const keyNote = result.sessionKeyAddress
        ? ` Session key ${String(result.sessionKeyAddress).slice(0, 10)}… (agent signs autonomously).`
        : '';
      setZkSessionMsg({
        type: 'success',
        text: `ZK session opened — proof verified on-chain, no owner signature used.${keyNote} Nullifier ${String(result.nullifier).slice(0, 14)}…`,
      });
      fetchData();
    } catch (e: any) {
      const msg = e.code === 4001 || e.message?.includes('rejected')
        ? 'Transaction rejected'
        : (e.message || 'Failed to open ZK session');
      setZkSessionMsg({ type: 'error', text: msg });
    }
    setZkSessionBusy(null);
  };

  const budgetUsd = ethPrice !== null && ethPrice > 0 && form.budgetEth ? (parseFloat(form.budgetEth) * ethPrice).toFixed(2) : null;

  const columns = [
    { key: 'id', header: 'Agent', render: (c: any) => <div><span className="font-mono text-xs">#{c.agentId}</span><div className="text-[10px] text-muted-foreground/60">{c.organizationId === '0' ? 'Standalone' : truncate(c.organizationId, 8)}</div></div> },
    { key: 'commitment', header: 'Commitment', render: (c: any) => <span className="font-mono text-xs text-muted-foreground">{truncate(c.commitment, 10)}</span> },
    { key: 'wallet', header: 'Wallet', render: (c: any) => (
      <a href={explorerAddress(c.walletAddress)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
        {truncate(c.walletAddress, 8)} <ExternalLink className="w-3 h-3 opacity-40" />
      </a>
    ) },
    { key: 'budget', header: 'Budget', render: (c: any) => <span className="text-xs">{c.budgetEth || '—'} ETH</span> },
    { key: 'status', header: 'Status', render: (c: any) => <Badge variant={c.revoked ? 'danger' : 'success'}>{c.revoked ? 'Revoked' : 'Active'}</Badge> },
    { key: 'zk', header: '', className: 'text-right', render: (c: any) => c.revoked ? null : (
      <Button
        variant="ghost"
        size="sm"
        icon={zkSessionBusy === c.agentId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
        disabled={zkSessionBusy !== null || !c.walletAddress}
        onClick={() => createZkSession(c)}
        title="Open a session authorized purely by a zero-knowledge credential proof — no owner signature, org policy stays private on-chain"
      >
        {zkSessionBusy === c.agentId ? 'Proving…' : 'ZK Session'}
      </Button>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Credentials" description="Issue agent credentials — wallet, commitment, session, and gas in one flow"
        action={<div className="flex gap-2"><Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => { fetchData(); fetchOracle(); }} /><Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { setShowForm(!showForm); resetFlow(); }}>{showForm ? 'Close' : 'Issue Credential'}</Button></div>}
      />

      {/* Oracle Status */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="py-2.5">
          <div className="text-[10px] text-muted-foreground/60 tracking-wider uppercase mb-1">Active Root</div>
          <div className="font-mono text-[11px] text-success/80">{oracle ? truncate(oracle.activeRoot, 14) : '—'}</div>
        </Card>
        <Card className="py-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground/60 tracking-wider uppercase">ETH/USD</span>
            {priceLoading && <span className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-pulse" />}
          </div>
          <div className="font-mono text-[11px]">
            {priceLoading ? (
              <span className="text-muted-foreground/40">Loading...</span>
            ) : oracle?.ethPrice && oracle.ethPrice > 0 ? (
              <span>${oracle.ethPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            ) : (
              <span className="text-warning/60">Fetching...</span>
            )}
          </div>
        </Card>
        <Card className="py-2.5">
          <div className="text-[10px] text-muted-foreground/60 tracking-wider uppercase mb-1">Chain</div>
          <div className="font-mono text-[11px]">{oracle?.chainId || '—'} {oracle?.paused ? '(Paused)' : ''}</div>
        </Card>
      </div>

      {/* Credential Issuance Wizard */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} title="Issue New Credential">
        <div className="space-y-4">
          {/* Active step indicator */}
          {issuing && (
            <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary/50">
              {FLOW_STEPS.map((step, i) => {
                const done = flowState.completed.has(step.id);
                const active = flowState.currentStep === step.id;
                return (
                  <div key={step.id} className="flex items-center gap-1">
                    <div className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] tracking-wider uppercase transition-all ${
                      active ? 'bg-foreground/10 text-foreground' : done ? 'text-success' : 'text-muted-foreground/40'
                    }`}>
                      {done ? <Check className="w-2.5 h-2.5" /> : active ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Circle className="w-2.5 h-2.5" />}
                      {step.label}
                    </div>
                    {i < FLOW_STEPS.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/10" />}
                  </div>
                );
              })}
            </div>
          )}

          {flowState.error && <Alert variant="error">{flowState.error}</Alert>}
          {flowState.completed.size === FLOW_STEPS.length && !issuing && <Alert variant="success">All steps complete — agent is ready</Alert>}

          {!issuing && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Agent ID" value={`${nextAgentId} (auto)`} disabled />
                <Input label="Version" value="1 (default)" disabled />
              </div>

              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Organization</div>
                <Select value={form.selectedOrg} onChange={e => setForm({ ...form, selectedOrg: e.target.value })}>
                  <option value="">Select organization...</option>
                  {orgs.map((org: any) => <option key={org.id} value={org.id}>{org.name}</option>)}
                </Select>
                <div className="text-[10px] text-muted-foreground/60 mt-1.5">Credentials require an organization. Standalone wallets use lightweight sessions directly.</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Input label="Budget (ETH)" type="number" value={form.budgetEth} onChange={e => setForm({ ...form, budgetEth: e.target.value })} min="0" step="0.01" />
                  {budgetUsd && <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60"><DollarSign className="w-3 h-3" /> ~${budgetUsd} USD</div>}
                </div>
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Expiry</div>
                  <div className="flex gap-2">
                    <input type="number" value={form.expiryDuration} onChange={e => setForm({ ...form, expiryDuration: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="1" />
                    <select value={form.expiryUnit} onChange={e => setForm({ ...form, expiryUnit: e.target.value as any })}
                      className="px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="days">Days</option><option value="months">Months</option>
                    </select>
                  </div>
                </div>
              </div>

              <Input label="Gas Deposit (ETH)" type="number" value={form.depositEth} onChange={e => setForm({ ...form, depositEth: e.target.value })} min="0" step="0.001" />
              <div className="text-[10px] text-muted-foreground/60">Deposited to ERC-4337 EntryPoint for gas sponsorship</div>

              <Alert variant="info" className="text-[10px] leading-relaxed">
                <Wallet className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Flow: Create AgentWallet → Issue credential → Update Merkle root → Open ZK session (proof authorizes; falls back to owner-signed only if proving fails) → Deposit gas. Each on-chain step requires your wallet signature.
              </Alert>
            </>
          )}

          <div className="flex gap-2 pt-2">
            {flowState.completed.size === FLOW_STEPS.length && !issuing ? (
              <Button onClick={() => { setShowForm(false); resetFlow(); }}>Done</Button>
            ) : (
              <Button onClick={handleStartFlow} disabled={issuing} icon={issuing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
                {issuing ? `Creating ${flowState.currentStep}...` : 'Start Flow'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setShowForm(false); resetFlow(); }} disabled={issuing}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Secret Reveal Banner */}
      {revealSecret && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-xs font-medium mb-1">Agent Secret Key Generated</div>
            <div className="text-[10px] text-muted-foreground/80 mb-2">Save this now — it will not be shown again. Used for ZK proof generation.</div>
            <div className="flex items-center gap-2 bg-background/50 rounded px-3 py-2">
              <code className="text-[10px] font-mono break-all flex-1">{revealSecret}</code>
              <button onClick={() => copySecret(revealSecret)} className="text-muted-foreground/40 hover:text-foreground transition-colors">
                {copied === revealSecret ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <button onClick={() => setRevealSecret(null)} className="text-muted-foreground/40 hover:text-foreground text-[10px] tracking-wider uppercase flex-shrink-0">Dismiss</button>
        </Alert>
      )}

      {/* ZK Session result banner */}
      {zkSessionMsg && (
        <Alert variant={zkSessionMsg.type === 'success' ? 'success' : 'error'} className="mb-4">
          <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs">{zkSessionMsg.text}</div>
          <button onClick={() => setZkSessionMsg(null)} className="text-muted-foreground/40 hover:text-foreground text-[10px] tracking-wider uppercase flex-shrink-0">Dismiss</button>
        </Alert>
      )}

      {/* Credential List */}
      {loading ? <Skeleton className="h-48" /> : credentials.length === 0 ? (
        <EmptyState icon={<CreditCard className="w-8 h-8" />} title="No Credentials" description="Issue a credential to create an agent with a Poseidon(7) commitment in the Merkle tree."
          action={<Button size="sm" onClick={() => setShowForm(true)} icon={<Plus className="w-3.5 h-3.5" />}>Issue Credential</Button>} />
      ) : (
        <Card><Table columns={columns} data={credentials} emptyMessage="No credentials found" /></Card>
      )}
    </div>
  );
}
