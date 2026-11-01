/**
 * Event indexer tests (item 17): chunk size at/under the public-RPC 200-block
 * cap, a split-retry that actually works, and checkpoints that NEVER advance
 * past a failed range. All RPC interaction goes through a mock provider —
 * no live RPC is touched (and none is claimed).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { ethers } from "ethers";

const providerHolder = vi.hoisted(() => ({ current: null as any }));

vi.mock("../src/core/provider", () => ({
  getProvider: () => providerHolder.current,
  getSigner: () => {
    throw new Error("no signer in indexer tests");
  },
}));

import { queryLogsWithSplitRetry, runIndexer } from "../src/core/event-indexer";
import { getAbiByName } from "../src/contracts";
import { loadConfig, ensureDirectories } from "../src/core/config";
import { getDatabase, runExecute, runSingle, closeDatabase } from "../src/core/database";

const FACTORY = () => loadConfig().contracts.agentWalletFactory;

function limitError(cap: number): any {
  const e: any = new Error(`eth_getLogs is limited to a ${cap} range`);
  e.code = -32614;
  return e;
}

function setCheckpoint(contractName: string, lastBlock: number): void {
  runExecute(
    `INSERT INTO indexer_checkpoints (contract_name, last_block, processed_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(contract_name) DO UPDATE SET last_block = ?, processed_at = unixepoch()`,
    contractName, lastBlock, lastBlock
  );
}

function getCheckpoint(contractName: string): number | undefined {
  return runSingle<{ last_block: number }>(
    "SELECT last_block FROM indexer_checkpoints WHERE contract_name = ?",
    contractName
  )?.last_block;
}

describe("30. Event indexer", () => {
  beforeAll(() => {
    ensureDirectories();
    getDatabase();
  });

  beforeEach(() => {
    runExecute("DELETE FROM indexed_events");
    runExecute("DELETE FROM indexer_checkpoints");
  });

  afterAll(() => {
    closeDatabase();
  });

  describe("queryLogsWithSplitRetry", () => {
    it("splits a range a stricter RPC rejects until every sub-range succeeds", async () => {
      const seenSizes: number[] = [];
      let failedCalls = 0;
      providerHolder.current = {
        getLogs: async ({ fromBlock, toBlock }: any) => {
          const size = toBlock - fromBlock + 1;
          if (size > 100) {
            failedCalls++;
            throw limitError(100);
          }
          seenSizes.push(size);
          return [];
        },
        getBlock: async () => ({ timestamp: 1700000000 }),
      };

      const logs = await queryLogsWithSplitRetry(providerHolder.current, "0xabc", ["0xtopic"], 0, 299);

      expect(logs).toEqual([]);
      expect(failedCalls).toBeGreaterThan(0);
      expect(Math.max(...seenSizes)).toBeLessThanOrEqual(100);
    });

    it("splits down to a single block, then throws (never pretends success)", async () => {
      const seenSizes: number[] = [];
      providerHolder.current = {
        getLogs: async ({ fromBlock, toBlock }: any) => {
          seenSizes.push(toBlock - fromBlock + 1);
          if (fromBlock <= 50 && 50 <= toBlock) throw limitError(200);
          return [];
        },
        getBlock: async () => ({ timestamp: 1700000000 }),
      };

      await expect(
        queryLogsWithSplitRetry(providerHolder.current, "0xabc", ["0xtopic"], 0, 99)
      ).rejects.toThrow();
      expect(seenSizes).toContain(1);
    });

    it("does not split non-range errors", async () => {
      let calls = 0;
      providerHolder.current = {
        getLogs: async () => {
          calls++;
          throw new Error("connection refused");
        },
        getBlock: async () => ({ timestamp: 1700000000 }),
      };

      await expect(
        queryLogsWithSplitRetry(providerHolder.current, "0xabc", ["0xtopic"], 0, 99)
      ).rejects.toThrow("connection refused");
      expect(calls).toBe(1);
    });
  });

  describe("runIndexer checkpoints", () => {
    it("keeps progress before a gap, never advances past it, and retries it on the next run", async () => {
      // Blocks are near the GENESIS floor (43,500,000) so runIndexer's
      // floor logic does not skip the test range.
      const POISON = 43500650;
      const HEAD = 43500800;
      providerHolder.current = {
        getBlockNumber: async () => HEAD,
        getLogs: async ({ address, fromBlock, toBlock }: any) => {
          void address;
          const size = toBlock - fromBlock + 1;
          if (size > 100) throw limitError(100);
          if (fromBlock <= POISON && POISON <= toBlock) throw new Error("poison block always fails");
          return [];
        },
        getBlock: async () => ({ timestamp: 1700000000 }),
      };

      setCheckpoint("AgentWalletFactory", 43500399);

      const first = await runIndexer();
      // Chunk 1 [400-599] succeeds (split from 200 to 100s); chunk 2
      // [600-799] contains the poison block and fails even at size 1.
      expect(first.errors.length).toBeGreaterThan(0);
      expect(first.errors.join(" ")).toContain("AgentWalletFactory");
      expect(getCheckpoint("AgentWalletFactory")).toBe(43500599);

      const second = await runIndexer();
      // The failed range is retried, not skipped: it errors again and the
      // checkpoint still does not move past the gap.
      expect(second.errors.length).toBeGreaterThan(0);
      expect(getCheckpoint("AgentWalletFactory")).toBe(43500599);
    });

    it("stores events and counts events stored (not blocks scanned)", async () => {
      const BLOCK = 43500405;
      const HEAD = 43500410;
      const iface = new ethers.Interface(getAbiByName("AgentWalletFactory"));
      const fragment = iface.getEvent("WalletCreated");
      const encoded = iface.encodeEventLog(fragment, [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        "0x" + "33".repeat(32),
        "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
      ]);
      const log = {
        blockNumber: BLOCK,
        transactionHash: "0x" + "ab".repeat(32),
        index: 0,
        topics: encoded.topics,
        data: encoded.data,
      };

      providerHolder.current = {
        getBlockNumber: async () => HEAD,
        getLogs: async ({ address, fromBlock, toBlock }: any) => {
          if (address === FACTORY() && fromBlock <= BLOCK && BLOCK <= toBlock) return [log];
          return [];
        },
        getBlock: async () => ({ timestamp: 1700000000 }),
      };

      setCheckpoint("AgentWalletFactory", 43500399);
      const result = await runIndexer();

      expect(result.errors).toEqual([]);
      expect(result.indexed).toBeGreaterThanOrEqual(1);
      const row = runSingle<{ event_name: string }>(
        "SELECT event_name FROM indexed_events WHERE tx_hash = ?",
        log.transactionHash
      );
      expect(row?.event_name).toBe("WalletCreated");
      expect(getCheckpoint("AgentWalletFactory")).toBe(HEAD);
    });
  });
});
