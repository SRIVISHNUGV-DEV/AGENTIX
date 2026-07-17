'use client';

import { useState, useEffect } from 'react';
import { Bot, RefreshCw, Wallet, User, CreditCard, KeyRound, Shield, Plus, Loader2, ExternalLink, Cpu, Check, Copy, ArrowRight, Sparkles } from 'lucide-react';
import { PageHeader, EmptyState, Badge, Button, Card, Dialog, Input, Alert, StatusDot, Skeleton } from '@/components/ui';
import { fetchJSON, postJSON, truncate, explorerAddress } from '@/lib/api';
import { sendAndWaitForWalletCreation, getAccount, sendCreateLightweightSession, bundleAgentExecute } from '@/lib/tx-sender';
import { useWalletCtx } from '@/lib/web3modal-provider';
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

export function AgentsPage() {
  const { address, isConnected, openModal } = useWalletCtx();
  const [harnesses, setHarnesses] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHarness, setSelectedHarness] = useState<any>(null);
  const [activeWallet, setActiveWallet] = useState<any>(null);
  const [identity, setIdentity] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showIssueCred, setShowIssueCred] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState<string | null>(null);
  const [agentKey, setAgentKeyState] = useState<{ address: string; privateKey: string } | null>(() => getAgentKey());
  const [showBundlerExec, setShowBundlerExec] = useState(false);
  const [execTarget, setExecTarget] = useState('');
  const [execValue, setExecValue] = useState('0');
  const [execData, setExecData] = useState('0x');
  const [executing, setExecuting] = useState(false);
  const [sessionSpendLimit, setSessionSpendLimit] = useState('0.1');
  const [sessionTxLimit, setSessionTxLimit] = useState('10');
  const [sessionExpiryDays, setSessionExpiryDays] = useState('30');
  const [sessionKey, setSessionKey] = useState('');
  const [sessionTargets, setSessionTargets] = useState('');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [h, w, s, c, o] = await Promise.allSettled([
        fetchJSON<any>('/api/onboarding/harnesses'),
        fetchJSON<any>('/api/wallets'),
        fetchJSON<any>('/api/sessions/all'),
        fetchJSON<any>('/api/credentials'),
        fetchJSON<any>('/api/credentials/orgs'),
      ]);
      if (h.status === 'fulfilled') {
        const list = h.value?.harnesses || [];
        setHarnesses(list.filter((x: any) => x.detect?.found).map((x: any) => ({ ...x.detect.harness, adapter: x.adapter })));
      }
      if (w.status === 'fulfilled') {
        const rawWallets = w.value.value || w.value || [];
        // Normalize API camelCase keys to snake_case used by JSX
        const walletList = rawWallets.map((w: any) => ({
          ...w,
          wallet_address: w.walletAddress || w.wallet_address,
          owner_address: w.ownerAddress || w.owner_address,
          harness_id: w.harnessId || w.harness_id,
        }));
        setWallets(walletList);
        // Rebuild harnessWalletMap from server data (source of truth)
        const mapFromServer: Record<string, string> = {};
        for (const wl of walletList) {
          if (wl.harness_id && wl.wallet_address) {
            mapFromServer[wl.harness_id] = wl.wallet_address;
          }
        }
        // Server is source of truth — drop stale localStorage entries
        setHarnessWalletMap(mapFromServer);
      }
      if (s.status === 'fulfilled') setSessions(s.value.value || s.value || []);
      if (c.status === 'fulfilled') setCredentials(c.value.value || c.value || []);
      if (o.status === 'fulfilled') setOrgs(o.value.value || o.value || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Track harness-specific wallets: harnessId → walletAddress (persisted in localStorage)
  const [harnessWalletMap, setHarnessWalletMap] = useState<Record<string, string>>(() => getHarnessWallets());

  // Auto-sync to localStorage on change
  useEffect(() => {
    saveHarnessWallets(harnessWalletMap);
  }, [harnessWalletMap]);

  // When a harness is selected, load its saved wallet or show create prompt
  useEffect(() => {
    if (!selectedHarness) { setActiveWallet(null); setIdentity(null); return; }
    const savedWalletAddr = harnessWalletMap[selectedHarness.id];
    if (savedWalletAddr) {
      const wallet = wallets.find((w: any) => w.wallet_address === savedWalletAddr);
      if (wallet) {
        setActiveWallet(wallet);
        fetchIdentity(wallet.wallet_address);
        return;
      }
    }
    // No wallet for this harness yet — clear selection and await create/link
    setActiveWallet(null);
    setIdentity(null);
  }, [selectedHarness, harnessWalletMap, wallets]);

  const fetchIdentity = async (walletAddr: string) => {
    try {
      const id = await fetchJSON<any>(`/api/identity/${walletAddr}`);
      setIdentity(id);
    } catch { setIdentity(null); }
  };

  // Generate a session keypair client-side for the agent
  const generateAgentKey = async () => {
    try {
      const { ethers } = await import('ethers');
      const wallet = ethers.Wallet.createRandom();
      const key = { address: wallet.address, privateKey: wallet.privateKey };
      setAgentKeyState(key);
      setAgentKey(key);
      setShowSecretKey(wallet.privateKey);
      return key;
    } catch {
      return { address: address || '', privateKey: '' };
    }
  };

  // Execute a transaction via the local bundler using the agent's session key
  const handleAgentExecute = async () => {
    if (!activeWallet || !agentKey || !showBundlerExec) return;
    setExecuting(true); setError(null);
    try {
      const sessionList = sessions.filter((s: any) => (s.walletAddress || s.wallet_address) === activeWallet.wallet_address && !s.revoked);
      if (sessionList.length === 0) { setError('No active session. Create one first.'); setExecuting(false); return; }
      const result = await bundleAgentExecute(
        activeWallet.wallet_address, execTarget, execValue || '0',
        execData || '0x', sessionList[0].sessionId || sessionList[0].session_id, agentKey.privateKey
      );
      if (result.success) setSuccess(`Agent executed! Tx: ${result.txHash?.slice(0, 20)}...`);
      else setError(result.error || 'Execution failed');
    } catch (e: any) { setError(e.message); }
    setExecuting(false);
  };

  // Create wallet + identity + generate agent key for the selected harness
  const setupAgent = async () => {
    if (!isConnected || !selectedHarness) { openModal(); return; }
    // Prevent duplicate: check if this harness already has a wallet
    if (harnessWalletMap[selectedHarness.id]) {
      setError(`${selectedHarness.name} already has a wallet at ${truncate(harnessWalletMap[selectedHarness.id], 8)}`);
      return;
    }
    setCreating(true); setError(null);
    try {
      const owner = await getAccount();
      // Generate agent's own keypair (client-side, no server sees private key)
      const agent = await generateAgentKey();
      if (!agent.address) throw new Error('Failed to generate agent key');

      // Create the wallet on-chain (pass harnessId to enforce 1:1 constraint)
      const result = await sendAndWaitForWalletCreation(owner, selectedHarness.id);
      // Save wallet for this harness (state + localStorage)
      setHarnessWalletMap(prev => ({ ...prev, [selectedHarness.id]: result.walletAddress }));
      await fetchAll();
      setActiveWallet({ wallet_address: result.walletAddress, owner_address: owner });
      await fetchIdentity(result.walletAddress);
      setSuccess(`${selectedHarness.name} wallet created at ${truncate(result.walletAddress, 8)}`);
    } catch (e: any) {
      if (e.code !== 4001) setError(e.message || 'Setup failed');
    }
    setCreating(false);
  };

  // Create a lightweight session with user-provided parameters
  const handleCreateSession = async () => {
    if (!isConnected || !activeWallet) return;
    setShowCreateSession(false);
    setError(null); setSuccess(null);
    try {
      const owner = await getAccount();
      const key = sessionKey || owner;
      const allowedTargets = sessionTargets
        ? sessionTargets.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];
      await sendCreateLightweightSession(activeWallet.wallet_address, owner, {
        sessionKey: key,
        dailySpendLimitEth: sessionSpendLimit || '0.1',
        dailyTxLimit: parseInt(sessionTxLimit) || 10,
        expiryDays: parseInt(sessionExpiryDays) || 30,
        allowedTargets,
      });
      setSuccess('Lightweight session created — owner can execute on behalf of the agent');
      fetchAll();
    } catch (e: any) { setError(e.message || 'Session creation failed'); }
  };

  // Issue credential under an org
  const [credOrgId, setCredOrgId] = useState('');
  const handleIssueCred = async () => {
    if (!isConnected || !activeWallet || !credOrgId) return;
    setError(null); setSuccess(null);
    try {
      const owner = await getAccount();
      const result = await postJSON<any>('/api/credentials', {
        orgId: credOrgId, budgetLimit: '0.1', expiryDuration: 30, expiryUnit: 'days',
        walletAddress: activeWallet.wallet_address, ownerAddress: owner,
      });
      if (result.success) {
        setShowIssueCred(false);
        setSuccess(`Credential issued! Agent #${result.agentId}`);
        setShowSecretKey(result.secret);
        fetchAll();
      } else { setError(result.error || 'Failed'); }
    } catch (e: any) { setError(e.message); }
  };

  // Link an existing unlinked wallet to the selected harness
  const linkWallet = async (walletAddress: string) => {
    if (!selectedHarness) return;
    try {
      const result = await postJSON<any>('/api/wallets/link', {
        walletAddress,
        harnessId: selectedHarness.id,
      });
      if (result.success) {
        setHarnessWalletMap(prev => ({ ...prev, [selectedHarness.id]: walletAddress }));
        setSuccess(`Wallet linked to ${selectedHarness.name}`);
        fetchAll();
      } else {
        setError(result.error || 'Failed to link');
      }
    } catch (e: any) { setError(e.message); }
  };

  // Only wallets with NO harness binding belong to the connected owner
  const unlinkedWallets = wallets.filter((w: any) =>
    !w.harness_id && isConnected && address && w.owner_address?.toLowerCase() === address.toLowerCase()
  );

  return (
    <div>
      <PageHeader title="Agents" description="AI harness → wallet → identity → credentials → sessions"
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={fetchAll} />}
      />

      {error && <Alert variant="error" className="mb-4"><div className="flex-1">{error}</div><button onClick={() => setError(null)} className="flex-shrink-0">&times;</button></Alert>}
      {success && <Alert variant="success" className="mb-4"><div className="flex-1">{success}</div><button onClick={() => setSuccess(null)} className="flex-shrink-0">&times;</button></Alert>}

      {/* Agent secret key banner */}
      {showSecretKey && (
        <Alert variant="warning" className="mb-4">
          <div className="flex-1">
            <div className="text-xs font-medium mb-1">Agent Secret Key — Save this!</div>
            <div className="text-[10px] text-muted-foreground/80 mb-2">
              This key is generated client-side and never sent to any server. The agent uses it to sign transactions.
            </div>
            <div className="flex items-center gap-2 bg-background/50 rounded px-3 py-2">
              <code className="text-[10px] font-mono break-all flex-1">{showSecretKey}</code>
              <button onClick={() => { navigator.clipboard.writeText(showSecretKey); }} className="text-muted-foreground/40 hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <button onClick={() => setShowSecretKey(null)} className="text-[10px] text-muted-foreground/40 hover:text-foreground flex-shrink-0">Dismiss</button>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Harness Selection */}
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">AI Harnesses</h3>
          {loading ? <Skeleton className="h-48" /> : (
            <div className="space-y-2">
              {harnesses.map((h: any) => (
                <button key={h.id} onClick={() => setSelectedHarness(h)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    selectedHarness?.id === h.id
                      ? 'border-foreground/30 bg-foreground/5'
                      : 'border-border bg-card hover:border-foreground/20 hover:bg-accent'
                  }`}>
                  <div className="flex items-center gap-3">
                    <img src={LOGO_MAP[h.id] || ''} alt={h.name} className="w-7 h-7 rounded object-contain bg-secondary/50 p-1"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{h.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <StatusDot status={h.status === 'connected' ? 'online' : 'warning'} />
                        <span className="text-[9px] text-muted-foreground/60">{h.status}</span>
                      </div>
                      {harnessWalletMap[h.id] && (
                        <div className="text-[8px] font-mono text-muted-foreground/40 mt-0.5">{truncate(harnessWalletMap[h.id], 8)}</div>
                      )}
                    </div>
                    {selectedHarness?.id === h.id && <ArrowRight className="w-3.5 h-3.5 text-foreground/40 ml-auto" />}
                  </div>
                </button>
              ))}
              {harnesses.length === 0 && (
                <div className="text-xs text-muted-foreground/50 py-8 text-center">No harnesses detected. Install Claude Code, MimoCode, or OpenCode.</div>
              )}
            </div>
          )}
        </div>

        {/* Middle Column: Wallet + Identity */}
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
            {selectedHarness ? `${selectedHarness.name} Agent` : 'Agent Setup'}
          </h3>

          {!selectedHarness ? (
            <Card className="py-10 text-center">
              <Cpu className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground/50">Select an AI harness on the left to set up its agent wallet.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Create Wallet CTA */}
              {!activeWallet && (
                <Card className="border-foreground/10 bg-foreground/[0.02]">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-foreground/60 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-1">Deploy Agent Wallet</div>
                      <div className="text-[11px] text-muted-foreground/70 mb-3">
                        Create an ERC-4337 smart wallet for {selectedHarness.name}. An agent keypair is generated client-side — the private key never leaves your machine.
                      </div>
                      <Button onClick={setupAgent} disabled={creating || !isConnected}
                        icon={creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}>
                        {creating ? 'Deploying...' : isConnected ? 'Create Wallet & Identity' : 'Connect Wallet First'}
                      </Button>
                      {unlinkedWallets.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="text-[10px] text-muted-foreground/60 mb-2">Or link an existing wallet:</div>
                          {unlinkedWallets.map((w: any) => (
                            <button key={w.wallet_address} onClick={() => linkWallet(w.wallet_address)}
                              className="w-full text-left text-[10px] font-mono bg-secondary/50 hover:bg-secondary rounded px-2 py-1.5 mb-1 flex items-center justify-between">
                              <span>{truncate(w.wallet_address, 16)}</span>
                              <span className="text-muted-foreground/40">Link →</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* Wallet Info */}
              {activeWallet && (
                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Agent Wallet</div>
                    <Badge variant="success">Deployed</Badge>
                  </div>
                  <div className="font-mono text-xs break-all mb-2">{activeWallet.wallet_address}</div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground/60">Owner</span>
                    <span className="font-mono">{truncate(activeWallet.owner_address, 8)}</span>
                  </div>
                  {agentKey && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground/60">Agent Key</span>
                        <span className="font-mono text-success/80">{truncate(agentKey.address, 10)}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    <a href={explorerAddress(activeWallet.wallet_address)} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground/40 hover:text-foreground flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Explorer
                    </a>
                    <button onClick={() => fetchAll()} className="text-[10px] text-muted-foreground/40 hover:text-foreground">
                      Refresh
                    </button>
                  </div>
                </Card>
              )}

              {/* Identity */}
              {activeWallet && (
                <Card>
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">On-Chain Identity</div>
                  {identity === null && (
                    <div className="text-xs text-muted-foreground/50 py-3 text-center flex items-center justify-center gap-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...
                    </div>
                  )}
                  {identity?.identityId && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Identity ID</span><span className="font-mono">{identity.identityId}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Status</span><Badge variant={identity.active ? 'success' : 'danger'}>{identity.active ? 'Active' : 'Inactive'}</Badge></div>
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground/60">Wallet</span><span className="font-mono">{truncate(identity.wallet, 8)}</span></div>
                    </div>
                  )}
                  {identity && !identity.identityId && (
                    <div className="text-xs text-muted-foreground/50 py-3 text-center">No identity registered for this wallet yet.</div>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Actions (Sessions + Credentials) */}
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">Actions</h3>

          {!activeWallet ? (
            <Card className="py-10 text-center">
              <p className="text-xs text-muted-foreground/50">Create a wallet first to access agent actions.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Create Session */}
              <Card hover onClick={async () => {
                try { const owner = await getAccount(); setSessionKey(owner); } catch {}
                setShowCreateSession(true);
              }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center"><KeyRound className="w-4 h-4 text-muted-foreground" /></div>
                  <div>
                    <div className="text-xs font-medium">Create Lightweight Session</div>
                    <div className="text-[10px] text-muted-foreground/60">Authorize the agent to transact within daily limits</div>
                  </div>
                </div>
              </Card>

              {/* Execute via Bundler (agent key required) */}
              {agentKey && (
                <Card hover onClick={() => setShowBundlerExec(true)}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center"><Bot className="w-4 h-4 text-muted-foreground" /></div>
                    <div>
                      <div className="text-xs font-medium">Execute via Bundler</div>
                      <div className="text-[10px] text-muted-foreground/60">Agent signs with session key — bundler relays to EntryPoint</div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Issue Credential */}
              <Card hover onClick={() => setShowIssueCred(true)}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center"><CreditCard className="w-4 h-4 text-muted-foreground" /></div>
                  <div>
                    <div className="text-xs font-medium">Issue Credential</div>
                    <div className="text-[10px] text-muted-foreground/60">ZK credential under an organization</div>
                  </div>
                </div>
              </Card>

              {/* Sessions List */}
              {sessions.filter((s: any) => (s.walletAddress || s.wallet_address) === activeWallet.wallet_address).length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Active Sessions</div>
                  {sessions.filter((s: any) => (s.walletAddress || s.wallet_address) === activeWallet.wallet_address).map((s: any) => (
                    <Card key={s.sessionId || s.session_id} className="py-2.5 mb-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px]">{truncate(s.sessionId || s.session_id, 10)}</span>
                        <Badge variant={s.revoked ? 'danger' : 'success'}>{s.revoked ? 'Revoked' : 'Active'}</Badge>
                      </div>
                      <div className="flex gap-3 mt-1 text-[9px] text-muted-foreground/60">
                        <span>Spend: {s.dailySpendLimit || s.daily_spend_limit || '—'} ETH</span>
                        <span>Tx: {s.dailyTxLimit || s.daily_tx_limit || '—'}/day</span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Credentials List */}
              {credentials.filter((c: any) => c.walletAddress === activeWallet.wallet_address).length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Credentials</div>
                  {credentials.filter((c: any) => c.walletAddress === activeWallet.wallet_address).map((c: any) => (
                    <Card key={c.credentialId} className="py-2.5 mb-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px]">Agent #{c.agentId}</span>
                        <Badge variant={c.revoked ? 'danger' : 'success'}>{c.revoked ? 'Revoked' : 'Active'}</Badge>
                      </div>
                      <div className="text-[9px] text-muted-foreground/60 mt-1">
                        Org: {truncate(c.organizationId, 8)} — Budget: {c.budgetEth || '—'} ETH
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session Dialog */}
      <Dialog open={showCreateSession} onClose={() => setShowCreateSession(false)} title="Create Lightweight Session">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground/80">
            Creates a lightweight session for this agent. The owner signs to authorize session actions within the defined limits.
          </p>

          <Input
            label="Session Key Address"
            value={sessionKey}
            onChange={e => setSessionKey(e.target.value)}
            placeholder="Defaults to your connected wallet address"
          />
          <p className="text-[10px] text-muted-foreground/50 -mt-3">
            The address authorized to sign transactions for this session. Leave empty to use your connected wallet.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Daily Spend Limit (ETH)"
              value={sessionSpendLimit}
              onChange={e => setSessionSpendLimit(e.target.value)}
              placeholder="0.1"
              type="number"
            />
            <Input
              label="Daily Tx Limit"
              value={sessionTxLimit}
              onChange={e => setSessionTxLimit(e.target.value)}
              placeholder="10"
              type="number"
            />
          </div>

          <Input
            label="Expiry (days)"
            value={sessionExpiryDays}
            onChange={e => setSessionExpiryDays(e.target.value)}
            placeholder="30"
            type="number"
          />

          <Input
            label="Allowed Targets (optional)"
            value={sessionTargets}
            onChange={e => setSessionTargets(e.target.value)}
            placeholder="0xabc..., 0xdef... (comma-separated)"
          />
          <p className="text-[10px] text-muted-foreground/50 -mt-3">
            Restrict this session to specific contract addresses. Leave empty to allow any target. Max 32 addresses.
          </p>

          <p className="text-[10px] text-muted-foreground/60 bg-secondary/50 rounded p-2">
            The owner signs an EIP-191 message authorizing these exact parameters. The contract verifies the signature on-chain.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleCreateSession} icon={<KeyRound className="w-3.5 h-3.5" />}>Create &amp; Sign</Button>
            <Button variant="ghost" onClick={() => setShowCreateSession(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Bundler Execute Dialog */}
      <Dialog open={showBundlerExec} onClose={() => setShowBundlerExec(false)} title="Execute via Bundler">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground/80">
            The agent signs a transaction with its session key. The bundler relays it through the EntryPoint.
            Gas is paid from the wallet's EntryPoint deposit.
          </p>
          <Input label="Target Address" value={execTarget} onChange={e => setExecTarget(e.target.value)} placeholder="0x..." />
          <Input label="Value (wei)" type="number" value={execValue} onChange={e => setExecValue(e.target.value)} placeholder="0" />
          <Input label="Calldata (hex)" value={execData} onChange={e => setExecData(e.target.value)} placeholder="0x" />
          {agentKey && <div className="text-[10px] text-muted-foreground/60">Agent key: <span className="font-mono">{agentKey.address.slice(0, 10)}...</span></div>}
          <div className="flex gap-2">
            <Button onClick={handleAgentExecute} disabled={executing || !execTarget}
              icon={executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}>
              {executing ? 'Executing...' : 'Execute'}
            </Button>
            <Button variant="ghost" onClick={() => setShowBundlerExec(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Issue Credential Dialog */}
      <Dialog open={showIssueCred} onClose={() => setShowIssueCred(false)} title="Issue Credential">
        <div className="space-y-4">
          <select value={credOrgId} onChange={e => setCredOrgId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground">
            <option value="">Select organization...</option>
            {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground/60">Creates a Poseidon(7) ZK credential committed in the org's Merkle tree.</p>
          <div className="flex gap-2">
            <Button onClick={handleIssueCred} icon={<CreditCard className="w-3.5 h-3.5" />}>Issue</Button>
            <Button variant="ghost" onClick={() => setShowIssueCred(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
