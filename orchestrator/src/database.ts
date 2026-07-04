import fs from 'node:fs';
import path from 'node:path';
import { IndexedEvent, WalletInfo, IdentityInfo, OrganizationInfo, CredentialAnchorInfo, PendingTransaction } from './types.js';

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

  constructor(dbPath?: string) {
    this.filePath = dbPath || path.join(process.cwd(), '.agentix', 'db.json');
    this.data = this._load();
    setInterval(() => this._flush(), 5000);
  }

  private _load(): DbSchema {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { wallets: {}, identities: {}, organizations: {}, anchors: {}, events: [], pendingTxs: [] };
    }
  }

  private _flush() {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch { /* swallow */ }
  }

  flush() { this._flush(); }

  saveWallet(info: WalletInfo) {
    this.data.wallets[info.address.toLowerCase()] = info;
    this.dirty = true;
  }
  getWallet(address: string): WalletInfo | undefined {
    return this.data.wallets[address.toLowerCase()];
  }
  getAllWallets(): WalletInfo[] { return Object.values(this.data.wallets); }

  saveIdentity(info: IdentityInfo) {
    this.data.identities[info.wallet.toLowerCase()] = info;
    this.dirty = true;
  }
  getIdentity(wallet: string): IdentityInfo | undefined {
    return this.data.identities[wallet.toLowerCase()];
  }

  saveOrganization(info: OrganizationInfo) {
    this.data.organizations[info.organizationId] = info;
    this.dirty = true;
  }
  getOrganization(id: string): OrganizationInfo | undefined {
    return this.data.organizations[id];
  }

  saveAnchor(info: CredentialAnchorInfo) {
    this.data.anchors[info.organizationId] = info;
    this.dirty = true;
  }

  saveEvents(events: IndexedEvent[]) {
    this.data.events.push(...events);
    if (this.data.events.length > 10000) {
      this.data.events = this.data.events.slice(-5000);
    }
    this.dirty = true;
  }
  getEvents(filter?: { name?: string; fromBlock?: number }): IndexedEvent[] {
    let result = this.data.events;
    if (filter?.name) result = result.filter(e => e.eventName === filter.name);
    const fb = filter?.fromBlock;
    if (fb) result = result.filter(e => e.blockNumber >= fb);
    return result.slice(-100);
  }

  savePendingTx(tx: PendingTransaction) {
    this.data.pendingTxs.push(tx);
    this.dirty = true;
  }
  updatePendingTx(hash: string, status: PendingTransaction['status']) {
    const tx = this.data.pendingTxs.find(t => t.hash === hash);
    if (tx) { tx.status = status; this.dirty = true; }
  }
}
