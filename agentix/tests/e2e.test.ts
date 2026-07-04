import assert from "assert";
import { EventBus } from "../packages/core/eventbus";
import { classifyRisk } from "../packages/shared/constants";
import { generateId, sha256, checksum, formatAddress, truncate, nowUnix, isExpired } from "../packages/shared/utils";

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => console.log(`  ✓ ${name}`)).catch((e) => console.error(`  ✗ ${name}: ${e.message}`));
    } else {
      console.log(`  ✓ ${name}`);
    }
  } catch (e: any) {
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log("\nAgentIX E2E Tests\n");

// ── EventBus ──────────────────────────────────────────────────────────
console.log("EventBus");
test("emits and receives events", async () => {
  const bus = new EventBus();
  let received = false;
  bus.on("WalletCreated", () => { received = true; });
  await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x123", ownerAddress: "0x456" } });
  assert(received, "Should receive event");
});

test("wildcard handler receives all events", async () => {
  const bus = new EventBus();
  let count = 0;
  bus.onAny(() => { count++; });
  await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x1", ownerAddress: "0x2" } });
  await bus.emit({ type: "SessionCreated", data: { sessionId: "s1", walletAddress: "0x1" } });
  assert(count === 2, `Expected 2, got ${count}`);
});

test("unsubscribes handler", async () => {
  const bus = new EventBus();
  let count = 0;
  const unsub = bus.on("WalletCreated", () => { count++; });
  await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x1", ownerAddress: "0x2" } });
  unsub();
  await bus.emit({ type: "WalletCreated", data: { walletAddress: "0x3", ownerAddress: "0x4" } });
  assert(count === 1, `Expected 1, got ${count}`);
});

test("stores history", async () => {
  const bus = new EventBus();
  await bus.emit({ type: "CredentialIssued", data: { credentialId: "c1", organizationId: "o1", agentId: 1 } });
  await bus.emit({ type: "CredentialRevoked", data: { organizationId: "o1", agentId: 1 } });
  assert(bus.getHistory().length === 2);
  assert(bus.getHistoryByType("CredentialIssued").length === 1);
});

// ── Risk Classification ───────────────────────────────────────────────
console.log("\nRisk Classification");
test("classifies read operations as LOW", () => {
  assert(classifyRisk("read") === "LOW");
  assert(classifyRisk("list") === "LOW");
  assert(classifyRisk("get") === "LOW");
  assert(classifyRisk("health") === "LOW");
});

test("classifies wallet creation as MEDIUM", () => {
  assert(classifyRisk("createWallet") === "MEDIUM");
  assert(classifyRisk("createSession") === "MEDIUM");
  assert(classifyRisk("generateProof") === "MEDIUM");
});

test("classifies credential operations as HIGH", () => {
  assert(classifyRisk("issueCredential") === "HIGH");
  assert(classifyRisk("revokeCredential") === "HIGH");
  assert(classifyRisk("executeTransaction") === "HIGH");
});

test("classifies authority operations as AUTHORITY", () => {
  assert(classifyRisk("createOrganization") === "AUTHORITY");
  assert(classifyRisk("deactivateOrganization") === "AUTHORITY");
});

// ── Utils ─────────────────────────────────────────────────────────────
console.log("\nUtils");
test("generates unique IDs", () => {
  const id1 = generateId();
  const id2 = generateId();
  assert(id1 !== id2, "IDs should be unique");
  assert(id1.length === 32, "ID should be 32 hex chars");
});

test("sha256 produces consistent hash", () => {
  const h1 = sha256("hello");
  const h2 = sha256("hello");
  assert(h1 === h2);
  assert(h1.length === 64);
});

test("checksum matches sha256", () => {
  assert(checksum("test") === sha256("test"));
});

test("formatAddress truncates correctly", () => {
  assert(formatAddress("0x1234567890abcdef1234567890abcdef12345678") === "0x1234...5678");
});

test("truncate limits string length", () => {
  assert(truncate("hello world", 8) === "hello...");
  assert(truncate("hi", 10) === "hi");
});

test("nowUnix returns current timestamp", () => {
  const now = nowUnix();
  assert(now > 1000000000);
  assert(now < 9999999999);
});

test("isExpired detects expired timestamps", () => {
  assert(isExpired(1) === true);
  assert(isExpired(9999999999) === false);
});

// ── Fund Tool ─────────────────────────────────────────────────────────
console.log("\nFund Tool");
import { getFundOptions, getNetworkInfo } from "../src/tools/fund";

test("getFundOptions returns providers for baseSepolia", () => {
  const result = getFundOptions({ network: "baseSepolia", amount: "10", currency: "USD", country: "US" });
  assert(result.network === "Base Sepolia", `Expected Base Sepolia, got ${result.network}`);
  assert(result.options.length > 0, "Should have providers");
  assert(result.options[0].provider.length > 0, "Provider should have name");
  assert(result.options[0].officialLink.includes("http"), "Should have official link");
});

test("getFundOptions filters by country", () => {
  const usResult = getFundOptions({ network: "baseSepolia", amount: "10", currency: "USD", country: "US" });
  const ngResult = getFundOptions({ network: "baseSepolia", amount: "10", currency: "USD", country: "NG" });
  assert(usResult.options.length >= ngResult.options.length, "US should have more providers than NG");
});

test("getFundOptions sorts by fee", () => {
  const result = getFundOptions({ network: "baseSepolia", amount: "100", currency: "USD" });
  if (result.options.length > 1) {
    const extractFee = (f: string) => parseFloat(f.match(/\$[\d.]+/)?.[0]?.replace("$", "") || "0");
    const fees = result.options.map((o) => extractFee(o.fees));
    for (let i = 1; i < fees.length; i++) {
      assert(fees[i - 1] <= fees[i], `Fee at index ${i - 1} (${fees[i - 1]}) should be <= fee at index ${i} (${fees[i]})`);
    }
  }
});

test("getNetworkInfo returns correct info", () => {
  const base = getNetworkInfo("baseSepolia");
  assert(base.testnet === true, "Base Sepolia should be testnet");
  assert(base.faucetUrl !== undefined, "Should have faucet URL");

  const mainnet = getNetworkInfo("base");
  assert(mainnet.testnet === false, "Base mainnet should not be testnet");
});

test("getFundOptions includes disclaimer", () => {
  const result = getFundOptions({ network: "baseSepolia", amount: "10" });
  assert(result.disclaimer.length > 0, "Should have disclaimer");
  assert(result.disclaimer.includes("recommendations"), "Disclaimer should mention recommendations");
});

// ── Harness Adapter ───────────────────────────────────────────────────
console.log("\nHarness Adapter");
import { getHarnessManager } from "../packages/core/harness-adapter";

test("getHarnessManager returns singleton", () => {
  const m1 = getHarnessManager();
  const m2 = getHarnessManager();
  assert(m1 === m2, "Should return same instance");
});

test("getAdapters returns all adapters", () => {
  const manager = getHarnessManager();
  const adapters = manager.getAdapters();
  assert(adapters.length >= 5, `Should have at least 5 adapters, got ${adapters.length}`);
  assert(adapters.find((a) => a.id === "claude-code"), "Should have claude-code adapter");
  assert(adapters.find((a) => a.id === "mimocode"), "Should have mimocode adapter");
  assert(adapters.find((a) => a.id === "opencode"), "Should have opencode adapter");
  assert(adapters.find((a) => a.id === "github-copilot"), "Should have github-copilot adapter");
  assert(adapters.find((a) => a.id === "hermes"), "Should have hermes adapter");
});

test("getAdapter returns correct adapter", () => {
  const manager = getHarnessManager();
  const adapter = manager.getAdapter("claude-code");
  assert(adapter !== undefined, "Should find claude-code adapter");
  assert(adapter!.name === "Claude Code", "Should have correct name");
});

test("getAdapter returns undefined for unknown", () => {
  const manager = getHarnessManager();
  const adapter = manager.getAdapter("unknown");
  assert(adapter === undefined, "Should return undefined for unknown adapter");
});

test("registerAdapter adds new adapter", () => {
  const manager = getHarnessManager();
  const countBefore = manager.getAdapters().length;
  const mockAdapter = { id: "test-adapter", name: "Test" } as any;
  manager.registerAdapter(mockAdapter);
  assert(manager.getAdapters().length === countBefore + 1, "Should add adapter");
  const found = manager.getAdapter("test-adapter");
  assert(found !== undefined, "Should find registered adapter");
});

test("scanAll returns results for all adapters", async () => {
  const manager = getHarnessManager();
  const scan = await manager.scanAll();
  assert(scan.harnesses.length >= 5, "Should scan all adapters");
  assert(typeof scan.totalDetected === "number", "Should have totalDetected");
  assert(typeof scan.totalConnected === "number", "Should have totalConnected");
  assert(scan.timestamp > 0, "Should have timestamp");
});

test("healthCheckAll returns results", async () => {
  const manager = getHarnessManager();
  const result = await manager.healthCheckAll();
  assert(result.results.length >= 5, "Should check all adapters");
  assert(typeof result.healthy === "number", "Should have healthy count");
  assert(typeof result.unhealthy === "number", "Should have unhealthy count");
});

// ── Wizard ────────────────────────────────────────────────────────────
console.log("\nWizard");

test("runFullDiagnostics returns diagnostic result", async () => {
  const { runFullDiagnostics } = await import("../src/tools/wizard");
  const result = await runFullDiagnostics();
  assert(result.sections.length > 0, "Should have sections");
  assert(typeof result.overall === "string", "Should have overall status");
  assert(typeof result.repairable === "number", "Should have repairable count");
  assert(result.summary.length > 0, "Should have summary");
  assert(result.timestamp > 0, "Should have timestamp");
});

test("diagnostic sections have correct structure", async () => {
  const { runFullDiagnostics } = await import("../src/tools/wizard");
  const result = await runFullDiagnostics();
  for (const section of result.sections) {
    assert(section.name.length > 0, "Section should have name");
    assert(["OK", "WARNING", "ERROR"].includes(section.status), "Section should have valid status");
    assert(section.items.length > 0, "Section should have items");
    for (const item of section.items) {
      assert(item.label.length > 0, "Item should have label");
      assert(["OK", "WARNING", "ERROR", "INFO"].includes(item.status), "Item should have valid status");
      assert(item.value.length > 0, "Item should have value");
    }
  }
});

test("initializeFullRuntime returns init result", async () => {
  const { initializeFullRuntime } = await import("../src/tools/wizard");
  const result = await initializeFullRuntime();
  assert(typeof result.success === "boolean", "Should have success");
  assert(result.steps.length > 0, "Should have steps");
  assert(result.databaseReady === true, "Should have database ready");
  assert(result.directoriesCreated === true, "Should have directories created");
});

test("init steps have correct structure", async () => {
  const { initializeFullRuntime } = await import("../src/tools/wizard");
  const result = await initializeFullRuntime();
  for (const step of result.steps) {
    assert(step.name.length > 0, "Step should have name");
    assert(["pending", "running", "done", "error", "skip"].includes(step.status), "Step should have valid status");
    assert(step.message.length > 0, "Step should have message");
  }
});

console.log("\nDone.\n");
