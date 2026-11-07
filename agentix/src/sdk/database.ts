import fs from 'node:fs';
import path from 'node:path';
import { IndexedEvent, WalletInfo, IdentityInfo, OrganizationInfo, CredentialAnchorInfo, PendingTransaction } from './types';

interface DbSchema {
  wallets: Record<string, WalletInfo>;
  identities: Record<string, IdentityInfo>;
  organizations: Record<string, OrganizationInfo>;
  anchors: Record<string, CredentialAnchorInfo>;
  events: IndexedEvent[];
  pendingTxs: PendingTransaction[];
}

export class Database {
  private data: DbSchema;
  private readonly filePath: string;
  private dirty = false;

  /**
   * Opens (or creates) the local JSON cache and starts the 5s auto-flush timer.
   * The DB is a local cache only — chain state is authoritative; a stale or deleted file is rebuilt from chain reads.
   * @param dbPath - JSON file path; defaults to <cwd>/.agentix/db.json.
   * Maps to: internal — AgentIX constructor.
   * Side effects: reads the file if present; starts a repeating 5s interval that keeps the process alive until flushed/stopped.
   */
  constructor(dbPath?: string) {
    this.filePath = dbPath || path.join(process.cwd(), '.agentix', 'db.json');
    this.data = this._load();
    setInterval(() => this._flush(), 5000);
  }

  /**
   * Loads the JSON cache from disk, or starts empty when the file is missing or corrupt.
   * A corrupt file is silently treated as empty, so a damaged cache loses local history (chain state is unaffected).
   * @returns The parsed schema, or a fresh empty schema on any read/parse failure.
   * Maps to: internal — Database constructor.
   * Side effects: disk read.
   */
  private _load(): DbSchema {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { wallets: {}, identities: {}, organizations: {}, anchors: {}, events: [], pendingTxs: [] };
    }
  }

  /**
   * Writes the in-memory cache to disk when it has changed since the last flush.
   * No-op when nothing is dirty; write failures are swallowed so a full disk never crashes the caller.
   * Maps to: internal — Database flush and the 5s auto-flush timer.
   * Side effects: disk write (creates the directory if needed).
   */
  private _flush() {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch { /* swallow */ }
  }

  /**
   * Forces an immediate write of pending changes to disk.
   * Call before process exit when the latest saves must survive (the timer only flushes every 5s).
   * Maps to: internal — callers shutting down the SDK.
   * Side effects: disk write when dirty.
   */
  flush() { this._flush(); }

  /**
   * Upserts a wallet record in the local cache, keyed by lowercase address.
   * Cache-only: it records what the SDK has seen, it does not create anything on-chain.
   * Maps to: internal — WalletModule.create and getInfo.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  saveWallet(info: WalletInfo) {
    this.data.wallets[info.address.toLowerCase()] = info;
    this.dirty = true;
  }
  /**
   * Returns the cached wallet record for an address, or undefined when never seen.
   * A miss means "not cached", not "does not exist on-chain" — fall back to WalletModule.getInfo for chain truth.
   * @returns The cached WalletInfo, or undefined on a cache miss.
   * Maps to: internal — WalletModule callers reading cached wallet state.
   */
  getWallet(address: string): WalletInfo | undefined {
    return this.data.wallets[address.toLowerCase()];
  }
  /**
   * Returns every cached wallet record.
   * @returns All cached wallets; an empty array when the cache has none.
   * Maps to: internal — CLI 'agentix wallet' list paths.
   */
  getAllWallets(): WalletInfo[] { return Object.values(this.data.wallets); }

  /**
   * Upserts an identity record in the local cache, keyed by lowercase wallet address.
   * Cache-only; the on-chain identity is created by the AgentIdentity contract.
   * Maps to: internal — IdentityModule.get.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  saveIdentity(info: IdentityInfo) {
    this.data.identities[info.wallet.toLowerCase()] = info;
    this.dirty = true;
  }
  /**
   * Returns the cached identity for a wallet, or undefined when never seen.
   * A miss means "not cached" — use IdentityModule.getByWallet for chain truth.
   * @returns The cached IdentityInfo, or undefined on a cache miss.
   * Maps to: internal — IdentityModule callers reading cached identity state.
   */
  getIdentity(wallet: string): IdentityInfo | undefined {
    return this.data.identities[wallet.toLowerCase()];
  }

  /**
   * Upserts an organization record in the local cache, keyed by organization id.
   * Cache-only; registration happens on-chain via OrganizationRegistry.
   * Maps to: internal — OrganizationModule.get and OwnerModule.createOrganization.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  saveOrganization(info: OrganizationInfo) {
    this.data.organizations[info.organizationId] = info;
    this.dirty = true;
  }
  /**
   * Returns the cached organization record, or undefined when never seen.
   * A miss means "not cached" — use OrganizationModule.get for chain truth.
   * @returns The cached OrganizationInfo, or undefined on a cache miss.
   * Maps to: internal — OrganizationModule callers reading cached org state.
   */
  getOrganization(id: string): OrganizationInfo | undefined {
    return this.data.organizations[id];
  }

  /**
   * Upserts a credential-anchor record in the local cache, keyed by organization id.
   * Cache-only; the anchor is the on-chain OrganizationCredentialAnchor contract.
   * Maps to: internal — OrganizationModule.getAnchorInfo.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  saveAnchor(info: CredentialAnchorInfo) {
    this.data.anchors[info.organizationId] = info;
    this.dirty = true;
  }

  /**
   * Appends indexed events to the local cache, trimming to the newest 5,000 once it passes 10,000.
   * The trim is lossy by design: old events are dropped from the cache (they remain on-chain and re-indexable).
   * Maps to: event SessionCreated and every other indexed contract event.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  saveEvents(events: IndexedEvent[]) {
    this.data.events.push(...events);
    if (this.data.events.length > 10000) {
      this.data.events = this.data.events.slice(-5000);
    }
    this.dirty = true;
  }
  /**
   * Returns cached events, newest-first capped at the last 100, optionally filtered by name and block.
   * This reads the cache only — it never queries the chain, so events indexed before the last trim or never indexed are absent.
   * @returns At most 100 matching events; an empty array when nothing matches.
   * Maps to: internal — callers listing local event history.
   */
  getEvents(filter?: { name?: string; fromBlock?: number }): IndexedEvent[] {
    let result = this.data.events;
    if (filter?.name) result = result.filter(e => e.eventName === filter.name);
    const fb = filter?.fromBlock;
    if (fb) result = result.filter(e => e.blockNumber >= fb);
    return result.slice(-100);
  }

  /**
   * Records a just-submitted transaction as pending in the local cache.
   * Lets the SDK report in-flight transactions before they mine.
   * Maps to: internal — TransactionManager.send.
   * Side effects: marks the cache dirty (flushed within 5s).
   */
  savePendingTx(tx: PendingTransaction) {
    this.data.pendingTxs.push(tx);
    this.dirty = true;
  }
  /**
   * Moves a tracked pending transaction to confirmed or failed.
   * Silently does nothing when the hash was never recorded (e.g. a restart dropped it).
   * Maps to: internal — TransactionManager.send and wait.
   * Side effects: marks the cache dirty when a record was updated.
   */
  updatePendingTx(hash: string, status: PendingTransaction['status']) {
    const tx = this.data.pendingTxs.find(t => t.hash === hash);
    if (tx) { tx.status = status; this.dirty = true; }
  }
}
