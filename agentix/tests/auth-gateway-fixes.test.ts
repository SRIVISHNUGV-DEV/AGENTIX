/**
 * auth-gateway-fixes.test.ts — regression tests for the runtime auth fixes
 * (R-1, R-2, R-3, R-6, R-9, R-10 helpers, R-12 assessment, local token).
 *
 * Design: every test below stops at a gate that needs no chain — the point
 * is to prove the gate fires, not to execute anything. Gateway tests use
 * early-return paths (owner-only / authority / missing wallet / policy
 * denial) that never reach compilation or signing. Policy tests use the
 * local test DB. No test touches a live network or a real key.
 */
import { describe, it, expect } from "vitest";
import { ethers } from "ethers";

const W = (n: string) => `0x${n.padStart(40, "0")}`;

describe("R-1: normalise before gating", () => {
  it("maps aliases and case variants to canonical actions", async () => {
    const { normalizeAction } = await import("../packages/compiler/pipeline/stage-1-intent-parser");
    expect(normalizeAction("new_capability")).toBe("capability_register");
    expect(normalizeAction("New_Capability")).toBe("capability_register");
    expect(normalizeAction("WALLET_CREATE")).toBe("wallet_create");
    expect(normalizeAction("deploy_wallet")).toBe("wallet_create");
    expect(normalizeAction("new_org")).toBe("organization_register");
    expect(normalizeAction("send")).toBe("wallet_execute");
    expect(normalizeAction("wallet_execute")).toBe("wallet_execute");
  });

  it("owner-only actions require approval under alias and case spellings", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    const variants: Array<[string, Record<string, unknown>]> = [
      ["capability_register", { capabilityId: `0x${"ab".repeat(32)}`, action: "x", expiresAt: 9999999999 }],
      ["new_capability", { capabilityId: `0x${"ab".repeat(32)}`, action: "x", expiresAt: 9999999999 }],
      ["CAPABILITY_REGISTER", { capabilityId: `0x${"ab".repeat(32)}`, action: "x", expiresAt: 9999999999 }],
      ["New_Capability", { capabilityId: `0x${"ab".repeat(32)}`, action: "x", expiresAt: 9999999999 }],
      ["wallet_create", { ownerAddress: W("1") }],
      ["deploy_wallet", { ownerAddress: W("1") }],
      ["WALLET_CREATE", { ownerAddress: W("1") }],
      ["organization_register", { organizationId: `0x${"cd".repeat(32)}`, name: "o", ownerAddress: W("2") }],
      ["new_org", { organizationId: `0x${"cd".repeat(32)}`, name: "o", ownerAddress: W("2") }],
      ["wallet_transfer_ownership", { walletAddress: W("3"), newOwner: W("4") }],
      ["organization_deactivate", { organizationId: `0x${"cd".repeat(32)}` }],
    ];
    for (const [action, params] of variants) {
      const r = await gateway.executeIntent(action, params, "mcp");
      expect(r.success).toBe(false);
      expect(r.requiresApproval).toBe(true);
    }
  });

  it("free actions still pass under a case variant", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    const r = await gateway.executeIntent("WALLET_INFO", {}, "mcp");
    expect(r.success).toBe(true);
  });
});

describe("R-2: fail closed on missing wallet scope", () => {
  it("a state-changing action with no walletAddress is denied, not policy-skipped", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    const r = await gateway.executeIntent("wallet_execute", { target: W("5"), value: "0", data: "0x" }, "mcp");
    expect(r.success).toBe(false);
    expect(r.requiresApproval).toBeFalsy();
    expect(r.errors?.join(" ")).toContain("walletAddress");
  });

  it("a caller-supplied context walletAddress is ignored for policy scope", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    // Even with a context carrying a wallet, params without walletAddress deny.
    const r = await gateway.executeIntent(
      "wallet_execute",
      { target: W("5"), value: "0", data: "0x" },
      "rest",
      { walletAddress: W("6") } as any
    );
    expect(r.success).toBe(false);
    expect(r.errors?.join(" ")).toContain("walletAddress");
  });

  it("authority writes (delegation/credential roots) require approval, never auto-execute", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    const d = await gateway.executeIntent("delegation_create", {
      delegator: W("7"), scopeHash: `0x${"11".repeat(32)}`, root: `0x${"22".repeat(32)}`, expiresAt: 9999999999,
    }, "mcp");
    expect(d.success).toBe(false);
    expect(d.requiresApproval).toBe(true);
    const c = await gateway.executeIntent("credential_issue", { root: `0x${"33".repeat(32)}` }, "mcp");
    expect(c.success).toBe(false);
    expect(c.requiresApproval).toBe(true);
    const c2 = await gateway.executeIntent("new_credential", { root: `0x${"33".repeat(32)}` }, "mcp");
    expect(c2.success).toBe(false);
    expect(c2.requiresApproval).toBe(true);
  });
});

describe("R-9: fail-closed value parsing + naming", () => {
  it("parseValueToWei: integer = wei, decimal = ETH, garbage throws", async () => {
    const { parseValueToWei } = await import("../src/core/owner-policy");
    expect(parseValueToWei("100")).toBe(100n);
    expect(parseValueToWei("0.1")).toBe(10n ** 17n);
    expect(parseValueToWei("0x10")).toBe(16n);
    expect(parseValueToWei("")).toBe(0n);
    expect(parseValueToWei(undefined)).toBe(0n);
    expect(() => parseValueToWei("abc")).toThrow();
    expect(() => parseValueToWei("1.2.3")).toThrow();
  });

  it("checkPolicy denies on unparseable value and on empty allowlist", async () => {
    const { setOwnerPolicy, checkPolicy } = await import("../src/core/owner-policy");
    const wallet = W("100");
    await setOwnerPolicy({
      walletAddress: wallet,
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [],
      allowedActions: ["wallet_execute"],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
      signedBy: "0x0000000000000000000000000000000000000000",
      signature: "0x",
    });
    const bad = checkPolicy(wallet, "wallet_execute", { target: W("101"), value: "not-a-number" });
    expect(bad.allowed).toBe(false);
    expect(bad.category).toBe("exceeds_limit");

    const wallet2 = W("102");
    await setOwnerPolicy({
      walletAddress: wallet2,
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [],
      allowedActions: [],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
      signedBy: "0x0000000000000000000000000000000000000000",
      signature: "0x",
    });
    const empty = checkPolicy(wallet2, "wallet_execute", { target: W("101"), value: "0" });
    expect(empty.allowed).toBe(false);
  });

  it("default forbidden list now uses gateway names and fires", async () => {
    const { setOwnerPolicy, getOwnerPolicy, checkPolicy } = await import("../src/core/owner-policy");
    const wallet = W("103");
    await setOwnerPolicy({
      walletAddress: wallet,
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [],
      allowedActions: ["wallet_execute", "wallet_transfer_ownership", "wallet_withdraw"],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
      signedBy: "0x0000000000000000000000000000000000000000",
      signature: "0x",
    });
    const policy = getOwnerPolicy(wallet)!;
    expect(policy.forbiddenActions).toContain("wallet_transfer_ownership");
    expect(policy.forbiddenActions).toContain("wallet_withdraw");
    expect(checkPolicy(wallet, "wallet_transfer_ownership", { walletAddress: wallet, newOwner: W("104") }).allowed).toBe(false);
  });
});

describe("R-6: token moves are visible to policy", () => {
  const usdc = W("200");
  const other = W("201");
  const wallet = W("202");

  it("decodes ERC-20 transfer/approve/transferFrom selectors", async () => {
    const { decodeTokenMove } = await import("../src/core/owner-policy");
    const iface = new ethers.Interface([
      "function transfer(address to, uint256 amount) returns (bool)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    ]);
    const t = decodeTokenMove(usdc, iface.encodeFunctionData("transfer", [W("203"), 12345]));
    expect(t?.kind).toBe("erc20_transfer");
    expect(t?.amount).toBe(12345n);
    expect(t?.to.toLowerCase()).toBe(W("203").toLowerCase());
    const a = decodeTokenMove(usdc, iface.encodeFunctionData("approve", [W("203"), 999]));
    expect(a?.kind).toBe("erc20_approve");
    expect(decodeTokenMove(usdc, "0x12345678")).toBeNull();
    expect(decodeTokenMove(usdc, "0x")).toBeNull();
  });

  it("token transfer to an allowlisted token passes; to another token is denied", async () => {
    const { setOwnerPolicy, checkPolicy } = await import("../src/core/owner-policy");
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    await setOwnerPolicy({
      walletAddress: wallet,
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [usdc],
      allowedActions: ["erc20.transfer", "wallet_execute"],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
      signedBy: "0x0000000000000000000000000000000000000000",
      signature: "0x",
    });
    const ok = checkPolicy(wallet, "wallet_execute", {
      target: usdc, value: "0",
      data: iface.encodeFunctionData("transfer", [W("203"), "1000000"]),
    });
    expect(ok.allowed).toBe(true);
    const denied = checkPolicy(wallet, "wallet_execute", {
      target: other, value: "0",
      data: iface.encodeFunctionData("transfer", [W("203"), "1000000"]),
    });
    expect(denied.allowed).toBe(false);
    expect(denied.category).toBe("forbidden_target");
  });

  it("a wallet_execute-only allowlist does NOT authorise token transfers", async () => {
    const { setOwnerPolicy, checkPolicy } = await import("../src/core/owner-policy");
    const wallet2 = W("204");
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    await setOwnerPolicy({
      walletAddress: wallet2,
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [],
      allowedActions: ["wallet_execute"],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
      signedBy: "0x0000000000000000000000000000000000000000",
      signature: "0x",
    });
    const denied = checkPolicy(wallet2, "wallet_execute", {
      target: usdc, value: "0",
      data: iface.encodeFunctionData("transfer", [W("203"), "1000000"]),
    });
    expect(denied.allowed).toBe(false);
    // …but a plain (non-token) execute still passes under the same policy.
    const plain = checkPolicy(wallet2, "wallet_execute", { target: W("205"), value: "0", data: "0x" });
    expect(plain.allowed).toBe(true);
  });
});

describe("R-3: policy-set signatures are verified, not stored theater", () => {
  it("valid signature verifies; tampered payload, wrong signer, and '0x' fail", async () => {
    const { buildPolicySignaturePayload, verifyPolicySignature } = await import("../src/core/owner-policy");
    const owner = ethers.Wallet.createRandom();
    const policy = {
      walletAddress: W("300"),
      dailyLimit: "1000000000000000000",
      perTxLimit: "1000000000000000000",
      allowedTargets: [W("301")],
      allowedActions: ["wallet_execute"],
      forbiddenActions: [],
      sessionExpiry: 86400,
      autoCreateSessions: false,
    };
    const sig = await owner.signMessage(buildPolicySignaturePayload(policy));
    expect(verifyPolicySignature(policy, sig, owner.address)).toBe(true);
    expect(verifyPolicySignature({ ...policy, dailyLimit: "1" }, sig, owner.address)).toBe(false);
    expect(verifyPolicySignature(policy, sig, W("302"))).toBe(false);
    expect(verifyPolicySignature(policy, "0x", owner.address)).toBe(false);
    expect(verifyPolicySignature(policy, "", owner.address)).toBe(false);
  });

  it("payload is order-independent for array fields", async () => {
    const { buildPolicySignaturePayload } = await import("../src/core/owner-policy");
    const base = {
      walletAddress: W("300"),
      dailyLimit: "1",
      perTxLimit: "1",
      allowedTargets: [W("301"), W("302")],
      allowedActions: ["b_action", "a_action"],
      forbiddenActions: [],
      sessionExpiry: 1,
      autoCreateSessions: true,
    };
    const swapped = { ...base, allowedTargets: [W("302"), W("301")], allowedActions: ["a_action", "b_action"] };
    expect(buildPolicySignaturePayload(base)).toBe(buildPolicySignaturePayload(swapped));
  });
});

describe("R-10 helper: owner attestation verification", () => {
  it("verifies a plan-approval attestation by the registered owner only", async () => {
    const { runExecute } = await import("../src/core/database");
    const { verifyOwnerSignature } = await import("../src/runtime/bundler-risk-gate");
    const owner = ethers.Wallet.createRandom();
    const wallet = W("400");
    runExecute("INSERT OR REPLACE INTO wallets (wallet_address, owner_address) VALUES (?, ?)", wallet, owner.address);
    const msg = ethers.toUtf8Bytes("agentix-plan-approve:plan_123");
    const sig = await owner.signMessage(msg);
    expect(verifyOwnerSignature(wallet, msg, sig)).toBe(true);
    const stranger = ethers.Wallet.createRandom();
    const bad = await stranger.signMessage(msg);
    expect(verifyOwnerSignature(wallet, msg, bad)).toBe(false);
    expect(verifyOwnerSignature(W("401"), msg, sig)).toBe(false);
  });
});

describe("R-12: voucher assessment never executes", () => {
  it("assessVoucherPayment denies a no-policy wallet without touching a chain", async () => {
    const { assessVoucherPayment } = await import("../src/core/x402-voucher");
    const r = await assessVoucherPayment({
      wallet: W("500"),
      payTo: W("501"),
      amount: "1000000",
      nonce: `0x${"55".repeat(32)}`,
      expiry: Math.floor(Date.now() / 1000) + 300,
      resource: "https://example.com/api",
      sessionKey: W("502"),
      signature: "0x",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason.toLowerCase()).toContain("policy");
  });
});

describe("R-5: local token", () => {
  it("issues a per-run token and verifies it timing-safely", async () => {
    const { ensureLocalToken, verifyLocalToken, readLocalToken } = await import("../src/core/local-token");
    const token = ensureLocalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyLocalToken(token)).toBe(true);
    // Single-char mutation must fail. Flip (don't hard-code "0"): the token
    // is random hex, so appending "0" equals the token whenever it already
    // ends in "0" (1/16 of runs) and the test flakes.
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyLocalToken(flipped)).toBe(false);
    expect(verifyLocalToken("")).toBe(false);
    expect(verifyLocalToken(undefined)).toBe(false);
    expect(readLocalToken()).toBe(token);
    // A fresh token invalidates the previous one.
    const token2 = ensureLocalToken();
    expect(token2).not.toBe(token);
    expect(verifyLocalToken(token)).toBe(false);
    expect(verifyLocalToken(token2)).toBe(true);
  });
});
