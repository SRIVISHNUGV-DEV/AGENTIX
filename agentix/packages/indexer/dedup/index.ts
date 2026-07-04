export class Deduplicator {
  private seen: Set<string> = new Set();
  private maxSize: number;

  constructor(maxSize: number = 100000) {
    this.maxSize = maxSize;
  }

  isDuplicate(txHash: string, logIndex: number): boolean {
    return this.seen.has(this._key(txHash, logIndex));
  }

  mark(txHash: string, logIndex: number): void {
    const key = this._key(txHash, logIndex);
    if (this.seen.size >= this.maxSize) {
      this._evict();
    }
    this.seen.add(key);
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }

  private _key(txHash: string, logIndex: number): string {
    return `${txHash.toLowerCase()}_${logIndex}`;
  }

  private _evict(): void {
    const toRemove = Math.floor(this.maxSize * 0.2);
    let count = 0;
    for (const key of this.seen) {
      if (count >= toRemove) break;
      this.seen.delete(key);
      count++;
    }
  }
}
