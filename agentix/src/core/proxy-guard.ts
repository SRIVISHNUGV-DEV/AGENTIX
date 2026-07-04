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

  isImplementation(address: string): boolean {
    return this.implAddresses.has(address.toLowerCase());
  }

  isProxy(address: string): boolean {
    return this.proxyAddresses.has(address.toLowerCase());
  }

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

  getImplementationAddress(contractType: string): string {
    const config = loadConfig();
    const addr = config.implementations[contractType];
    if (!addr) throw new Error(`No implementation address found for: ${contractType}`);
    return addr;
  }

  listAllProxies(): Record<string, string> {
    const config = loadConfig();
    const proxies: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.contracts)) {
      if (key !== "agentWalletImplementation") {
        proxies[key] = value;
      }
    }
    return proxies;
  }

  warnIfImplementation(address: string): void {
    if (this.isImplementation(address)) {
      console.error(`\x1b[31mCRITICAL WARNING: ${address} is an IMPLEMENTATION contract address.\x1b[0m`);
      console.error(`\x1b[31mNEVER send transactions to implementation contracts.\x1b[0m`);
      console.error(`\x1b[31mAlways use the PROXY address for this contract.\x1b[0m\n`);
    }
  }
}

let _guard: ProxyGuard | null = null;

export function getProxyGuard(): ProxyGuard {
  if (!_guard) _guard = new ProxyGuard();
  return _guard;
}
