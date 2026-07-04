import { IndexerEvent } from '../types';
import fs from 'fs';
import path from 'path';

export class EventStore {
  constructor(private baseDir: string) {}

  append(event: IndexerEvent): void {
    const date = this._dateString(new Date(event.timestamp * 1000));
    const filePath = path.join(this.baseDir, `${date}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  appendBatch(events: IndexerEvent[]): void {
    if (events.length === 0) return;

    const groups: Map<string, string[]> = new Map();
    for (const event of events) {
      const date = this._dateString(new Date(event.timestamp * 1000));
      const line = JSON.stringify(event) + '\n';
      const existing = groups.get(date) || [];
      existing.push(line);
      groups.set(date, existing);
    }

    for (const [date, lines] of groups) {
      const filePath = path.join(this.baseDir, `${date}.jsonl`);
      fs.appendFileSync(filePath, lines.join(''), 'utf-8');
    }
  }

  query(filter?: {
    contractName?: string;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
    limit?: number;
  }): IndexerEvent[] {
    const results: IndexerEvent[] = [];
    const limit = filter?.limit || 1000;

    if (!fs.existsSync(this.baseDir)) return results;

    const files = fs.readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    for (const file of files) {
      if (results.length >= limit) break;

      const content = fs.readFileSync(path.join(this.baseDir, file), 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines.reverse()) {
        if (results.length >= limit) break;
        try {
          const event: IndexerEvent = JSON.parse(line);

          if (filter?.contractName && event.contractName !== filter.contractName) continue;
          if (filter?.eventName && event.eventName !== filter.eventName) continue;
          if (filter?.fromBlock && event.blockNumber < filter.fromBlock) continue;
          if (filter?.toBlock && event.blockNumber > filter.toBlock) continue;

          results.push(event);
        } catch {}
      }
    }

    return results;
  }

  queryInRange(fromBlock: number, toBlock: number, contractName?: string): IndexerEvent[] {
    return this.query({ fromBlock, toBlock, contractName, limit: 100000 });
  }

  getLatestBlock(): number {
    if (!fs.existsSync(this.baseDir)) return 0;

    const files = fs.readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    if (files.length === 0) return 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.baseDir, file), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      try {
        const lastEvent: IndexerEvent = JSON.parse(lines[lines.length - 1]);
        return lastEvent.blockNumber;
      } catch {
        continue;
      }
    }

    return 0;
  }

  count(): number {
    if (!fs.existsSync(this.baseDir)) return 0;
    let total = 0;
    const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.baseDir, file), 'utf-8');
      total += content.split('\n').filter(Boolean).length;
    }
    return total;
  }

  private _dateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
