/**
 * compat-propose-accept.test.ts — regression tests for the compat work
 * against the NEW (C-5 timelock / C-1 allowlist) contracts.
 *
 * Everything below is offline: ABI encoding, gateway gates, compiler
 * mappings, and pre-flight helpers. No test touches a live network or a
 * real key. The accept-before-timelock revert is CONTRACT behavior and
 * is covered by the contracts suite (RootTimelock.test.ts, 12/12) —
 * it is deliberately NOT re-claimed here.
 */
import { describe, it, expect } from "vitest";
import { ethers } from "ethers";

const W = (n: string) => `0x${n.padStart(40, "0")}`;
const ROOT = `0x${"11".repeat(32)}`;
const LEAF = `0x${"22".repeat(32)}`;
const SESSION_ID = `0x${"33".repeat(32)}`;

function ifaceOf(abi: any): ethers.Interface {
  return new ethers.Interface(abi);
}

describe("regenerated runtime ABIs match the new contracts", () => {
  // NOTE: ethers 6.17 Interface.getFunction returns null (does not throw)
  // for a missing function, so absence is asserted via toBeNull().
  it("CredentialRegistry has propose/accept/cancel + pending getters, no update*", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const iface = ifaceOf(getAbiByName("CredentialRegistry"));
    for (const fn of [
      "proposeActiveRoot",
      "acceptActiveRoot",
      "cancelActiveRoot",
      "proposeRevokedSecretRoot",
      "acceptRevokedSecretRoot",
      "cancelRevokedSecretRoot",
      "pendingActiveRoot",
      "pendingRevokedSecretRoot",
    ]) {
      expect(iface.getFunction(fn), `${fn} present`).not.toBeNull();
    }
    expect(iface.getFunction("updateActiveRoot")).toBeNull();
    expect(iface.getFunction("updateRevokedSecretRoot")).toBeNull();
  });

  it("DelegationManager has propose/accept/cancel + 2-arg isRevoked, no updateDelegationRoot", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const iface = ifaceOf(getAbiByName("DelegationManager"));
    for (const fn of [
      "proposeDelegationRoot",
      "acceptDelegationRoot",
      "cancelDelegationRoot",
      "pendingDelegationRoots",
    ]) {
      expect(iface.getFunction(fn), `${fn} present`).not.toBeNull();
    }
    const isRevoked = iface.getFunction("isRevoked");
    expect(isRevoked.inputs.length).toBe(2);
    expect(isRevoked.inputs[0].type).toBe("address");
    expect(isRevoked.inputs[1].type).toBe("bytes32");
    expect(iface.getFunction("updateDelegationRoot")).toBeNull();
  });

  it("OrganizationCredentialAnchor has propose/accept/cancel trios, no update*", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const iface = ifaceOf(getAbiByName("OrganizationCredentialAnchor"));
    for (const fn of [
      "proposeRoot",
      "acceptRoot",
      "cancelRoot",
      "proposeRevokedRoot",
      "acceptRevokedRoot",
      "cancelRevokedRoot",
      "pendingRoot",
      "pendingRevokedRoot",
    ]) {
      expect(iface.getFunction(fn), `${fn} present`).not.toBeNull();
    }
    expect(iface.getFunction("updateRoot")).toBeNull();
    expect(iface.getFunction("updateRevokedRoot")).toBeNull();
  });

  it("SessionManager + ISessionManager validators are 5-arg; set/getSessionTargets live on SessionManager", async () => {
    const { getAbiByName } = await import("../src/contracts");
    for (const name of ["SessionManager", "ISessionManager"]) {
      const iface = ifaceOf(getAbiByName(name));
      for (const fn of ["validateSession", "validateLightweightSession"]) {
        const f = iface.getFunction(fn);
        expect(f).not.toBeNull();
        expect(f.inputs.length, `${name}.${fn} arity`).toBe(5);
        expect(f.inputs.map((i: any) => i.type)).toEqual([
          "bytes32",
          "address",
          "uint256",
          "address",
          "bytes",
        ]);
      }
    }
    // set/getSessionTargets are SessionManager-only: ISessionManager
    // declares just the validators (verified against its ABI).
    const sm = ifaceOf(getAbiByName("SessionManager"));
    expect(sm.getFunction("setSessionTargets")).not.toBeNull();
    expect(sm.getFunction("getSessionTargets")).not.toBeNull();
    const ism = ifaceOf(getAbiByName("ISessionManager"));
    expect(ism.getFunction("setSessionTargets")).toBeNull();
    expect(ism.getFunction("getSessionTargets")).toBeNull();
  });
});

describe("ABI encoding of the new flows", () => {
  it("encodes every propose/accept/cancel with the canonical selector", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const cases: Array<[string, string, unknown[]]> = [
      ["CredentialRegistry", "proposeActiveRoot", [ROOT]],
      ["CredentialRegistry", "acceptActiveRoot", []],
      ["CredentialRegistry", "cancelActiveRoot", []],
      ["CredentialRegistry", "proposeRevokedSecretRoot", [ROOT]],
      ["CredentialRegistry", "acceptRevokedSecretRoot", []],
      ["CredentialRegistry", "cancelRevokedSecretRoot", []],
      ["DelegationManager", "proposeDelegationRoot", [W("1"), ROOT, ROOT, 9999999999]],
      ["DelegationManager", "acceptDelegationRoot", [W("1"), ROOT]],
      ["DelegationManager", "cancelDelegationRoot", [W("1"), ROOT]],
      ["OrganizationCredentialAnchor", "proposeRoot", [ROOT]],
      ["OrganizationCredentialAnchor", "acceptRoot", []],
      ["OrganizationCredentialAnchor", "cancelRoot", []],
      ["OrganizationCredentialAnchor", "proposeRevokedRoot", [ROOT]],
      ["OrganizationCredentialAnchor", "acceptRevokedRoot", []],
      ["OrganizationCredentialAnchor", "cancelRevokedRoot", []],
      ["SessionManager", "setSessionTargets", [SESSION_ID, [W("2")]]],
      ["SessionManager", "getSessionTargets", [SESSION_ID]],
    ];
    for (const [contract, fn, args] of cases) {
      const iface = ifaceOf(getAbiByName(contract));
      const data = iface.encodeFunctionData(fn, args as any);
      expect(data.slice(0, 10), `${contract}.${fn} selector`).toBe(
        iface.getFunction(fn).selector
      );
    }
  });

  it("encodes 5-arg validate calls and rejects the old 3-arg shape", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const iface = ifaceOf(getAbiByName("SessionManager"));
    for (const fn of ["validateSession", "validateLightweightSession"]) {
      const data = iface.encodeFunctionData(fn, [SESSION_ID, W("1"), 0, W("2"), "0x"]);
      expect(data.slice(0, 10)).toBe(iface.getFunction(fn).selector);
      expect(() => iface.encodeFunctionData(fn, [SESSION_ID, W("1"), 0])).toThrow();
    }
  });

  it("encodes 2-arg isRevoked and rejects the old 1-arg shape", async () => {
    const { getAbiByName } = await import("../src/contracts");
    const iface = ifaceOf(getAbiByName("DelegationManager"));
    const data = iface.encodeFunctionData("isRevoked", [W("1"), LEAF]);
    expect(data.slice(0, 10)).toBe(iface.getFunction("isRevoked").selector);
    expect(() => iface.encodeFunctionData("isRevoked", [LEAF])).toThrow();
  });
});

describe("gateway gates the new authority actions (no chain)", () => {
  it("every propose/accept/cancel action returns requiresApproval, never executes", async () => {
    const { getCompilerGateway } = await import("../src/compiler-gateway");
    const gateway = getCompilerGateway();
    const actions = [
      "credential_issue",
      "credential_revoke",
      "credential_update_root",
      "credential_accept_root",
      "credential_accept_revoked_root",
      "credential_cancel_root",
      "credential_cancel_revoked_root",
      "delegation_create",
      "delegation_accept_root",
      "delegation_cancel_root",
      "anchor_accept_root",
      "anchor_accept_revoked_root",
      "anchor_cancel_root",
      "anchor_cancel_revoked_root",
    ];
    for (const action of actions) {
      const r = await gateway.executeIntent(action, {}, "mcp");
      expect(r.success, `${action} must not auto-execute`).toBe(false);
      expect(r.requiresApproval, `${action} requires approval`).toBe(true);
    }
  });
});

describe("compiler mappings for the new actions", () => {
  it("stage-6 resolver maps propose/accept actions to the right contract + function", async () => {
    const { ContractResolver } = await import(
      "../packages/compiler/pipeline/stage-6-contract-resolver"
    );
    const resolver = new ContractResolver();
    const addrs = {
      CredentialRegistry: W("9"),
      DelegationManager: W("8"),
      OrganizationCredentialAnchor: W("7"),
    };
    const cases: Array<[string, string, string, Record<string, unknown>?]> = [
      ["credential_issue", "CredentialRegistry", "proposeActiveRoot"],
      ["credential_revoke", "CredentialRegistry", "proposeRevokedSecretRoot"],
      ["credential_accept_root", "CredentialRegistry", "acceptActiveRoot"],
      ["credential_accept_revoked_root", "CredentialRegistry", "acceptRevokedSecretRoot"],
      ["credential_cancel_root", "CredentialRegistry", "cancelActiveRoot"],
      ["credential_cancel_revoked_root", "CredentialRegistry", "cancelRevokedSecretRoot"],
      ["delegation_create", "DelegationManager", "proposeDelegationRoot"],
      ["delegation_accept_root", "DelegationManager", "acceptDelegationRoot"],
      ["delegation_cancel_root", "DelegationManager", "cancelDelegationRoot"],
      ["anchor_accept_root", "OrganizationCredentialAnchor", "acceptRoot", { anchorAddress: W("6") }],
      ["anchor_cancel_revoked_root", "OrganizationCredentialAnchor", "cancelRevokedRoot", { anchorAddress: W("6") }],
    ];
    for (const [action, contract, fn, extra] of cases) {
      const res = resolver.resolve(
        { normalizedAction: action, params: extra ?? {} } as any,
        addrs
      );
      expect(res.errors, `${action} errors`).toEqual([]);
      expect(res.contracts[0].name, `${action} contract`).toBe(contract);
      expect(res.contracts[0].function, `${action} function`).toBe(fn);
    }
  });

  it("anchor actions resolve to the per-instance address from params", async () => {
    const { ContractResolver } = await import(
      "../packages/compiler/pipeline/stage-6-contract-resolver"
    );
    const resolver = new ContractResolver();
    const res = resolver.resolve(
      { normalizedAction: "anchor_accept_root", params: { anchorAddress: W("6") } } as any,
      { CredentialRegistry: W("9"), DelegationManager: W("8") }
    );
    expect(res.errors).toEqual([]);
    expect(res.contracts[0].address).toBe(W("6"));
  });

  it("encodeAction maps propose/accept actions to the new functions (offline)", async () => {
    // PRE-EXISTING CONFIG GAP (not a compat bug): the default config's
    // proxy addresses EQUAL its implementation addresses (the July 2026
    // deployment JSON records one address per contract), so the proxy
    // guard blocks every getProxyAddress-resolved encodeAction under
    // defaults. Until a real deployment's proxies land in user config,
    // encoding is tested with placeholder proxies that differ from the
    // implementation set. Removed after the test so later suites see
    // default config again.
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const home = process.env.AGENTIX_HOME!;
    const cfgDir = join(home, "config");
    mkdirSync(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "agentix.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        contracts: { credentialRegistry: W("c1"), delegationManager: W("d1") },
      })
    );
    try {
      const { encodeAction } = await import("../src/core/action-encoder");
      const { getAbiByName } = await import("../src/contracts");
      const cases: Array<[string, Record<string, unknown>, string, string]> = [
        ["credential_issue", { root: ROOT }, "CredentialRegistry", "proposeActiveRoot"],
        ["credential_revoke", { root: ROOT }, "CredentialRegistry", "proposeRevokedSecretRoot"],
        ["credential_accept_root", {}, "CredentialRegistry", "acceptActiveRoot"],
        ["credential_cancel_revoked_root", {}, "CredentialRegistry", "cancelRevokedSecretRoot"],
        [
          "delegation_create",
          { delegator: W("1"), scopeHash: ROOT, root: ROOT, expiresAt: 9999999999 },
          "DelegationManager",
          "proposeDelegationRoot",
        ],
        [
          "delegation_accept_root",
          { delegator: W("1"), scopeHash: ROOT },
          "DelegationManager",
          "acceptDelegationRoot",
        ],
        ["anchor_accept_root", { anchorAddress: W("6") }, "OrganizationCredentialAnchor", "acceptRoot"],
        ["anchor_cancel_root", { anchorAddress: W("6") }, "OrganizationCredentialAnchor", "cancelRoot"],
      ];
      for (const [action, params, contract, fn] of cases) {
        const enc = encodeAction(action, params);
        expect(enc.contractName, `${action} contract`).toBe(contract);
        expect(enc.functionName, `${action} function`).toBe(fn);
        const iface = ifaceOf(getAbiByName(contract));
        expect(enc.data.slice(0, 10), `${action} selector`).toBe(iface.getFunction(fn).selector);
      }
      // Anchor actions target the per-instance address, not a singleton proxy.
      const anchor = encodeAction("anchor_accept_root", { anchorAddress: W("6") });
      expect(anchor.to).toBe(W("6"));
      // Placeholder proxies resolve (they are the configured proxies now).
      expect(encodeAction("credential_issue", { root: ROOT }).to).toBe(W("c1"));
      expect(encodeAction("delegation_create", { delegator: W("1"), scopeHash: ROOT, root: ROOT, expiresAt: 9999999999 }).to).toBe(W("d1"));
    } finally {
      rmSync(cfgPath, { force: true });
    }
  });
});

describe("C-1: session allowlist threading", () => {
  it("encodeLightweightSession preserves allowedTargets in the inner calldata", async () => {
    const { encodeLightweightSession } = await import("../src/blockchain/adapter");
    const { getAbiByName } = await import("../src/contracts");
    const usdc = W("5");
    const enc = encodeLightweightSession({
      walletAddress: W("1"),
      sessionKey: W("2"),
      sessionId: SESSION_ID,
      dailyTxLimit: 100,
      expiryDays: 1,
      allowedTargets: [usdc],
    } as any);
    const walletIface = ifaceOf(getAbiByName("AgentWallet"));
    const decoded = walletIface.decodeFunctionData("execute", enc.data);
    const smIface = ifaceOf(getAbiByName("SessionManager"));
    const inner = smIface.decodeFunctionData("createLightweightSession", decoded[2]);
    expect([...inner[5]]).toEqual([usdc]);
  });

  it("encodeLightweightSession without allowedTargets encodes an empty allowlist", async () => {
    const { encodeLightweightSession } = await import("../src/blockchain/adapter");
    const { getAbiByName } = await import("../src/contracts");
    const enc = encodeLightweightSession({
      walletAddress: W("1"),
      sessionKey: W("2"),
      sessionId: SESSION_ID,
      dailyTxLimit: 100,
      expiryDays: 1,
    } as any);
    const walletIface = ifaceOf(getAbiByName("AgentWallet"));
    const decoded = walletIface.decodeFunctionData("execute", enc.data);
    const smIface = ifaceOf(getAbiByName("SessionManager"));
    const inner = smIface.decodeFunctionData("createLightweightSession", decoded[2]);
    expect([...inner[5]]).toEqual([]);
  });

  it("x402 allowlist helper: allowlisted (case-insensitive) passes, empty/other fails explicitly", async () => {
    const { checkTokenAllowlisted } = await import("../src/core/x402-client");
    const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    expect(checkTokenAllowlisted([usdc.toLowerCase()], usdc)).toBeNull();
    expect(checkTokenAllowlisted([usdc], usdc.toUpperCase())).toBeNull();
    const emptyErr = checkTokenAllowlisted([], usdc);
    expect(emptyErr).toMatch(/allowlist/i);
    expect(emptyErr).toMatch(/setSessionTargets/);
    const otherErr = checkTokenAllowlisted([W("4")], usdc);
    expect(otherErr).toMatch(/allowlist/i);
    expect(otherErr).toMatch(/setSessionTargets/);
  });
});

describe("5-arg validate: missing target fails explicitly, no chain", () => {
  it("tools/session validateSession without target returns the explicit error", async () => {
    const { validateSession } = await import("../src/tools/session");
    const r = await validateSession(SESSION_ID, W("1"), "0");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/target is required/i);
  });

  it("tools/quick quickValidateSession without target returns the explicit error", async () => {
    const { quickValidateSession } = await import("../src/tools/quick");
    const r = await quickValidateSession(SESSION_ID, W("1"), "0");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/target is required/i);
  });
});
