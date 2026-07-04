import { describe, it, expect } from "vitest";
import { EventBus } from "../packages/core/eventbus";
import type { AgentixEvent } from "../packages/shared/types";

describe("14. Event Bus Tests", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("creates an event bus instance", () => {
    expect(bus).toBeDefined();
  });

  it("emits and receives events", async () => {
    let received: AgentixEvent | null = null;
    bus.on("OrganizationRequested", (e) => { received = e; });

    const event: AgentixEvent = { type: "OrganizationRequested", data: { name: "Test Org", requestId: "r1", timestamp: Date.now() } };
    await bus.emit(event);

    expect(received).toBeDefined();
    expect(received!.type).toBe("OrganizationRequested");
  });

  it("wildcard handler receives all events", async () => {
    const received: AgentixEvent[] = [];
    bus.onAny((e) => received.push(e));

    await bus.emit({ type: "OrganizationRequested", data: { name: "A", requestId: "r1", timestamp: Date.now() } });
    await bus.emit({ type: "CredentialIssued", data: { credentialId: "c1", organizationId: "o1", agentId: "a1", timestamp: Date.now() } });
    await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x123", ownerAddress: "0x456", timestamp: Date.now() } });

    expect(received.length).toBe(3);
  });

  it("unsubscribes handler", async () => {
    let count = 0;
    const unsub = bus.on("OrganizationRequested", () => { count++; });

    await bus.emit({ type: "OrganizationRequested", data: { name: "A", requestId: "r1", timestamp: Date.now() } });
    expect(count).toBe(1);

    unsub();
    await bus.emit({ type: "OrganizationRequested", data: { name: "B", requestId: "r2", timestamp: Date.now() } });
    expect(count).toBe(1);
  });

  it("stores event history", async () => {
    await bus.emit({ type: "CredentialIssued", data: { credentialId: "c1", organizationId: "o1", agentId: "a1", timestamp: Date.now() } });
    await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x123", ownerAddress: "0x456", timestamp: Date.now() } });

    const history = bus.getHistory();
    expect(history.length).toBe(2);
  });

  it("respects history limit", async () => {
    for (let i = 0; i < 10; i++) {
      await bus.emit({ type: "CredentialIssued", data: { credentialId: `c${i}`, organizationId: "o1", agentId: "a1", timestamp: Date.now() } });
    }
    const history = bus.getHistory(5);
    expect(history.length).toBe(5);
  });

  it("filters history by type", async () => {
    await bus.emit({ type: "OrganizationRequested", data: { name: "A", requestId: "r1", timestamp: Date.now() } });
    await bus.emit({ type: "CredentialIssued", data: { credentialId: "c1", organizationId: "o1", agentId: "a1", timestamp: Date.now() } });
    await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x123", ownerAddress: "0x456", timestamp: Date.now() } });
    await bus.emit({ type: "CredentialIssued", data: { credentialId: "c2", organizationId: "o1", agentId: "a1", timestamp: Date.now() } });

    const credEvents = bus.getHistoryByType("CredentialIssued");
    expect(credEvents.length).toBe(2);
  });

  it("clears history", async () => {
    await bus.emit({ type: "SessionCreated", data: { sessionId: "s1", walletAddress: "0x123", timestamp: Date.now() } });
    expect(bus.getHistory().length).toBe(1);

    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  it("handles errors in handlers without crashing", async () => {
    bus.on("OrganizationRequested", () => { throw new Error("Handler error"); });

    await expect(
      bus.emit({ type: "OrganizationRequested", data: { name: "A", requestId: "r1", timestamp: Date.now() } })
    ).resolves.not.toThrow();
  });

  it("emits all 19 event types without error", async () => {
    const eventTypes = [
      "OrganizationRequested", "OrganizationApproved", "OrganizationCreated",
      "OrganizationDeactivated", "CredentialIssued", "CredentialRevoked",
      "RootUpdated", "RevocationRootUpdated", "WalletCreated", "SessionCreated",
      "SessionRevoked", "ActionExecuted", "ReplayBlocked", "ProofGenerated",
      "BackupCreated", "BackupRestored", "TreeCorruptionDetected", "HealthCheckRun",
      "SessionPruned",
    ] as const;

    for (const type of eventTypes) {
      await bus.emit({ type, data: { timestamp: Date.now(), test: true } });
    }

    expect(bus.getHistory().length).toBe(eventTypes.length);
  });
});
