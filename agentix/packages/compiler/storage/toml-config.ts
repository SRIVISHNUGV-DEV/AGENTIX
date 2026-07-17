import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CompilerConfig } from '../types/compilation';

const DEFAULT_RISK_CONFIG = {
  approvalThreshold: 75,
  denyThreshold: 90,
  weights: {},
  behavioralEnabled: true,
  notionalEnabled: true,
  trustedAddresses: [] as string[],
  blockedAddresses: [] as string[],
};

const DEFAULT_CONFIG: CompilerConfig = {
  pluginDirs: [path.join(os.homedir(), '.agentix', 'compiler', 'plugins')],
  defaultChainId: 84532,
  simulationEnabled: true,
  naturalLanguageEnabled: false,
  riskThreshold: 75,
  cacheTtl: 300,
  maxPolicyRules: 50,
  risk: { ...DEFAULT_RISK_CONFIG },
};

const CONFIG_PATH = path.join(os.homedir(), '.agentix', 'compiler', 'compiler.toml');

function parseToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const section: Record<string, unknown> = {};
      result[sectionMatch[1]] = section;
      currentSection = section;
      continue;
    }
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      let value: unknown = rawValue.trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
      else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
      else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
        value = (value as string).slice(1, -1);
      }
      else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
        value = (value as string).slice(1, -1).split(',').map((s: string) => s.trim().replace(/^"|"$/g, ''));
      }
      currentSection[key] = value;
    }
  }
  return result;
}

export function loadCompilerConfig(): CompilerConfig {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parseToml(raw);
    const compiler = parsed.compiler as Record<string, unknown> | undefined;
    return {
      pluginDirs: (compiler?.plugin_dirs as string[]) || DEFAULT_CONFIG.pluginDirs,
      defaultChainId: (compiler?.default_chain_id as number) || DEFAULT_CONFIG.defaultChainId,
      simulationEnabled: (compiler?.simulation_enabled as boolean) ?? DEFAULT_CONFIG.simulationEnabled,
      naturalLanguageEnabled: (compiler?.natural_language_enabled as boolean) ?? DEFAULT_CONFIG.naturalLanguageEnabled,
    riskThreshold: (compiler?.risk_threshold as number) ?? DEFAULT_CONFIG.riskThreshold,
    cacheTtl: (compiler?.cache_ttl as number) ?? DEFAULT_CONFIG.cacheTtl,
    maxPolicyRules: (compiler?.max_policy_rules as number) ?? DEFAULT_CONFIG.maxPolicyRules,
    risk: parseRiskConfig(parsed.risk as Record<string, unknown> | undefined, compiler),
    };
  } catch {
    return { ...DEFAULT_CONFIG, risk: { ...DEFAULT_RISK_CONFIG } };
  }
}

function parseRiskConfig(
  risk: Record<string, unknown> | undefined,
  compiler: Record<string, unknown> | undefined
): CompilerConfig['risk'] {
  const weights: Record<string, number> = {};
  if (risk?.weights && typeof risk.weights === 'object') {
    for (const [k, v] of Object.entries(risk.weights as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n)) weights[k] = n;
    }
  }
  const toAddrList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s).toLowerCase()) : [];

  return {
    approvalThreshold:
      (risk?.approval_threshold as number) ??
      (compiler?.risk_threshold as number) ??
      DEFAULT_RISK_CONFIG.approvalThreshold,
    denyThreshold: (risk?.deny_threshold as number) ?? DEFAULT_RISK_CONFIG.denyThreshold,
    weights,
    behavioralEnabled: (risk?.behavioral_enabled as boolean) ?? DEFAULT_RISK_CONFIG.behavioralEnabled,
    notionalEnabled: (risk?.notional_enabled as boolean) ?? DEFAULT_RISK_CONFIG.notionalEnabled,
    trustedAddresses: toAddrList(risk?.trusted_addresses),
    blockedAddresses: toAddrList(risk?.blocked_addresses),
  };
}

export function saveCompilerConfig(config: CompilerConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const lines = [
    '[compiler]',
    `plugin_dirs = [${config.pluginDirs.map((d) => `"${d}"`).join(', ')}]`,
    `default_chain_id = ${config.defaultChainId}`,
    `simulation_enabled = ${config.simulationEnabled}`,
    `natural_language_enabled = ${config.naturalLanguageEnabled}`,
    `risk_threshold = ${config.riskThreshold}`,
    `cache_ttl = ${config.cacheTtl}`,
    `max_policy_rules = ${config.maxPolicyRules}`,
    '',
  ];
  fs.writeFileSync(CONFIG_PATH, lines.join('\n'), 'utf-8');
}
