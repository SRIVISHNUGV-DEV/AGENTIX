import { loadConfig } from "./config";

const IMPL_KEYS: Record<string, string> = {
  credentialRegistry: "credentialRegistry",
  CredentialRegistry: "credentialRegistry",
  sessionManager: "sessionManager",
  SessionManager: "sessionManager",
  agentWalletFactory: "agentWalletFactory",
  AgentWalletFactory: "agentWalletFactory",
  capabilityRegistry: "capabilityRegistry",
  CapabilityRegistry: "capabilityRegistry",
  delegationManager: "delegationManager",
  DelegationManager: "delegationManager",
  organizationRegistry: "organizationRegistry",
  OrganizationRegistry: "organizationRegistry",
  organizationCredentialAnchor: "organizationCredentialAnchor",
  OrganizationCredentialAnchor: "organizationCredentialAnchor",
  agentIdentity: "agentIdentity",
  AgentIdentity: "agentIdentity",
};

export class ProxyGuard {
  private implAddresses: Set<string>;
  private proxyAddresses: Map<string, string>;

  /**
   * Snapshot the configured proxy and implementation addresses into lookup sets.
   * Built once per process via getProxyGuard; a config change after construction is NOT picked up.
   * @returns A guard whose sets are keyed by lowercase address.
   * @throws Throws if loadConfig fails (missing config is fatal at startup).
   * Maps to: internal — getProxyGuard singleton (used by every contract-call path).
   */
  constructor() {
    const config = loadConfig();
    this.implAddresses = new Set(
      Object.values(config.implementations).map((a) => a.toLowerCase())
    );
    this.proxyAddresses = new Map();
    for (const [key, proxy] of Object.entries(config.contracts)) {
      if (key !== "agentWalletImplementation" && key !== "groth16Verifier") {
        this.proxyAddresses.set(proxy.toLowerCase(), key);
      }
    }
  }

  /**
   * Check whether an address is a known implementation contract.
   * The core safety predicate: implementation addresses must never receive transactions.
   * @param address — any hex address; comparison is case-insensitive.
   * @returns True when the address is a configured implementation, false otherwise (unknown addresses are not implementations).
   * @throws Never throws.
   * Maps to: internal — validate / warnIfImplementation (the block decision).
   * Security: a false negative (unlisted implementation) is not caught here — config must list every implementation.
   */
  isImplementation(address: string): boolean {
    return this.implAddresses.has(address.toLowerCase());
  }

  /**
   * Check whether an address is a known deployed proxy.
   * The positive counterpart of isImplementation; unknown addresses return false either way.
   * @param address — any hex address; comparison is case-insensitive.
   * @returns True when the address is a configured proxy (groth16Verifier and agentWalletImplementation excluded).
   * @throws Never throws.
   * Maps to: internal — callers that need an explicit proxy-membership test.
   */
  isProxy(address: string): boolean {
    return this.proxyAddresses.has(address.toLowerCase());
  }

  /**
   * Decide whether a transaction may target an address, and which proxy it should be.
   * The last line of defence before signing: blocks implementations outright and rejects a wrong proxy for a known contract type.
   * @param address — the target; any casing, compared lowercased.
   * @param contractType — when given, the address must equal that contract's configured proxy.
   * @returns { valid: true } when safe; otherwise { valid: false, error } with a human-readable reason — callers must throw on invalid.
   * @throws Never throws — failures are returned, not raised.
   * Maps to: internal — encodeAction / prepareContractWrite / prepareWalletWrite (pre-sign gate).
   * Security: this is an auth boundary for value transfer — never skip it or catch-and-ignore its verdict.
   */
  validate(address: string, contractType?: string): { valid: boolean; error?: string } {
    const lower = address.toLowerCase();

    if (this.implAddresses.has(lower)) {
      return {
        valid: false,
        error: `BLOCKED: Address ${address} is an IMPLEMENTATION contract. NEVER interact with implementations directly. Use the PROXY address instead.`,
      };
    }

    if (contractType && IMPL_KEYS[contractType]) {
      const config = loadConfig();
      const proxyKey = IMPL_KEYS[contractType];
      const expectedProxy = config.contracts[proxyKey as keyof typeof config.contracts];
      if (expectedProxy && lower !== expectedProxy.toLowerCase()) {
        return {
          valid: false,
          error: `WARNING: Address ${address} is not the expected proxy for ${contractType}. Expected: ${expectedProxy}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Resolve a contract type to its deployed proxy address from config.
   * Accepts camelCase or PascalCase keys; falls back to a case-insensitive scan of config.contracts.
   * @param contractType — e.g. "SessionManager" or "sessionManager"; unknown types throw.
   * @returns The proxy address exactly as configured.
   * @throws Throws when no proxy address is configured for the type.
   * Maps to: internal — encodeAction / prepareContractCall (target resolution).
   */
  getProxyAddress(contractType: string): string {
    const config = loadConfig();
    const key = IMPL_KEYS[contractType] || contractType;
    const addr = config.contracts[key as keyof typeof config.contracts];
    if (addr) return addr;
    const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
    const addr2 = config.contracts[lowerKey as keyof typeof config.contracts];
    if (addr2) return addr2;
    for (const [k, v] of Object.entries(config.contracts)) {
      if (k.toLowerCase() === key.toLowerCase()) return v;
    }
    throw new Error(`No proxy address found for contract type: ${contractType}`);
  }

  /**
   * Resolve a contract type to its implementation address from config.
   * Read-only lookup for diagnostics: the address it returns must never be a transaction target.
   * @param contractType — the key in config.implementations; unknown keys throw.
   * @returns The implementation address exactly as configured.
   * @throws Throws when no implementation is configured for the type.
   * Maps to: internal — diagnostics / ProxyGuard construction (never a send target).
   * Security: the returned address is for display only — sending to it bypasses the proxy and breaks upgrade safety.
   */
  getImplementationAddress(contractType: string): string {
    const config = loadConfig();
    const addr = config.implementations[contractType];
    if (!addr) throw new Error(`No implementation address found for: ${contractType}`);
    return addr;
  }

  /**
   * List every configured proxy address by contract key.
   * Excludes the agentWalletImplementation and groth16Verifier entries, which are not proxies.
   * @returns A fresh object mapping contract key to proxy address (empty when nothing is configured).
   * @throws Never throws.
   * Maps to: MCP tool agentix_contracts (list all proxy contract addresses).
   */
  listAllProxies(): Record<string, string> {
    const config = loadConfig();
    const proxies: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.contracts)) {
      if (key !== "agentWalletImplementation" && key !== "groth16Verifier") {
        proxies[key] = value;
      }
    }
    return proxies;
  }

  /**
   * Print a loud console warning when an address is a known implementation.
   * A diagnostic aid only — it does not block anything; validate() is the enforcement point.
   * @param address — any hex address; non-implementations print nothing.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — diagnostics paths that want a visible warning without failing.
   */
  warnIfImplementation(address: string): void {
    if (this.isImplementation(address)) {
      console.error(`\x1b[31mCRITICAL WARNING: ${address} is an IMPLEMENTATION contract address.\x1b[0m`);
      console.error(`\x1b[31mNEVER send transactions to implementation contracts.\x1b[0m`);
      console.error(`\x1b[31mAlways use the PROXY address for this contract.\x1b[0m\n`);
    }
  }
}

let _guard: ProxyGuard | null = null;

/**
 * Return the process-wide ProxyGuard singleton, building it on first use.
 * All proxy/implementation decisions must go through this one instance so the snapshot is consistent.
 * @returns The shared ProxyGuard (same object on every call).
 * @throws Throws on first call if loadConfig fails.
 * Maps to: internal — every contract-call path (encodeAction, prepareContractWrite, tx-builder).
 */
export function getProxyGuard(): ProxyGuard {
  if (!_guard) _guard = new ProxyGuard();
  return _guard;
}
