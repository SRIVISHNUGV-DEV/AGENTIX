import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AgentManifest {
  name: string;
  version: string;
  description: string;
  identity: {
    identityId: number;
    walletAddress: string;
  };
  organization: {
    id: string;
    role: string;
  };
  capabilities: string[];
  permissions: {
    maxValuePerTx: string;
    maxDailyValue: string;
    allowedTargets: string[];
    allowedTimes?: { start: string; end: string; timezone: string };
  };
  sessions: {
    preferLightweight: boolean;
    maxSessions: number;
    defaultExpiryHours: number;
  };
  plugins: string[];
  runtime: {
    restartOnCrash: boolean;
    maxRetries: number;
    logLevel: string;
  };
}

const DEFAULT_MANIFEST: AgentManifest = {
  name: 'unnamed-agent',
  version: '1.0.0',
  description: '',
  identity: { identityId: 0, walletAddress: '' },
  organization: { id: '', role: 'member' },
  capabilities: [],
  permissions: {
    maxValuePerTx: '1000000000000000000',
    maxDailyValue: '10000000000000000000',
    allowedTargets: [],
  },
  sessions: {
    preferLightweight: true,
    maxSessions: 5,
    defaultExpiryHours: 24,
  },
  plugins: [],
  runtime: {
    restartOnCrash: true,
    maxRetries: 3,
    logLevel: 'info',
  },
};

function parseSimpleToml(content: string): Record<string, unknown> {
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

export function loadAgentManifest(agentName: string, baseDir?: string): AgentManifest {
  const dir = baseDir || path.join(os.homedir(), '.agentix', 'agents', agentName);
  const manifestPath = path.join(dir, 'agent.toml');

  if (!fs.existsSync(manifestPath)) {
    return { ...DEFAULT_MANIFEST, name: agentName };
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = parseSimpleToml(raw);

  const agent = parsed.agent as Record<string, unknown> || {};
  const identity = parsed.identity as Record<string, unknown> || {};
  const org = parsed.organization as Record<string, unknown> || {};
  const permissions = parsed.permissions as Record<string, unknown> || {};
  const sessions = parsed.sessions as Record<string, unknown> || {};
  const runtime = parsed.runtime as Record<string, unknown> || {};

  return {
    name: (agent.name as string) || agentName,
    version: (agent.version as string) || '1.0.0',
    description: (agent.description as string) || '',
    identity: {
      identityId: (identity.identity_id as number) || 0,
      walletAddress: (identity.wallet_address as string) || '',
    },
    organization: {
      id: (org.id as string) || '',
      role: (org.role as string) || 'member',
    },
    capabilities: (parsed.capabilities as Record<string, unknown>)?.required as string[] || [],
    permissions: {
      maxValuePerTx: (permissions.max_value_per_tx as string) || '1000000000000000000',
      maxDailyValue: (permissions.max_daily_value as string) || '10000000000000000000',
      allowedTargets: (permissions.allowed_targets as string[]) || [],
      allowedTimes: permissions.allowed_times
        ? {
            start: (permissions.allowed_times as Record<string, unknown>).start as string,
            end: (permissions.allowed_times as Record<string, unknown>).end as string,
            timezone: ((permissions.allowed_times as Record<string, unknown>).timezone as string) || 'UTC',
          }
        : undefined,
    },
    sessions: {
      preferLightweight: (sessions.prefer_lightweight as boolean) ?? true,
      maxSessions: (sessions.max_sessions as number) || 5,
      defaultExpiryHours: (sessions.default_expiry_hours as number) || 24,
    },
    plugins: (parsed.plugins as Record<string, unknown>)?.enabled as string[] || [],
    runtime: {
      restartOnCrash: (runtime.restart_on_crash as boolean) ?? true,
      maxRetries: (runtime.max_retries as number) || 3,
      logLevel: (runtime.log_level as string) || 'info',
    },
  };
}

export function saveAgentManifest(agentName: string, manifest: AgentManifest, baseDir?: string): void {
  const dir = baseDir || path.join(os.homedir(), '.agentix', 'agents', agentName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = [
    '[agent]',
    `name = "${manifest.name}"`,
    `version = "${manifest.version}"`,
    `description = "${manifest.description}"`,
    '',
    '[identity]',
    `identity_id = ${manifest.identity.identityId}`,
    `wallet_address = "${manifest.identity.walletAddress}"`,
    '',
    '[organization]',
    `id = "${manifest.organization.id}"`,
    `role = "${manifest.organization.role}"`,
    '',
    '[capabilities]',
    `required = [${manifest.capabilities.map((c) => `"${c}"`).join(', ')}]`,
    '',
    '[permissions]',
    `max_value_per_tx = "${manifest.permissions.maxValuePerTx}"`,
    `max_daily_value = "${manifest.permissions.maxDailyValue}"`,
    `allowed_targets = [${manifest.permissions.allowedTargets.map((t) => `"${t}"`).join(', ')}]`,
    ...(manifest.permissions.allowedTimes
      ? [`allowed_times = { start = "${manifest.permissions.allowedTimes.start}", end = "${manifest.permissions.allowedTimes.end}", timezone = "${manifest.permissions.allowedTimes.timezone}" }`]
      : []),
    '',
    '[sessions]',
    `prefer_lightweight = ${manifest.sessions.preferLightweight}`,
    `max_sessions = ${manifest.sessions.maxSessions}`,
    `default_expiry_hours = ${manifest.sessions.defaultExpiryHours}`,
    '',
    '[plugins]',
    `enabled = [${manifest.plugins.map((p) => `"${p}"`).join(', ')}]`,
    '',
    '[runtime]',
    `restart_on_crash = ${manifest.runtime.restartOnCrash}`,
    `max_retries = ${manifest.runtime.maxRetries}`,
    `log_level = "${manifest.runtime.logLevel}"`,
    '',
  ];

  fs.writeFileSync(path.join(dir, 'agent.toml'), lines.join('\n'), 'utf-8');
}

export function validateAgentManifest(manifest: AgentManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest.name || manifest.name === 'unnamed-agent') {
    errors.push('Agent name is required');
  }

  if (manifest.identity.identityId <= 0 && !manifest.identity.walletAddress) {
    errors.push('Either identity_id or wallet_address must be configured');
  }

  if (manifest.permissions.maxValuePerTx === '0') {
    errors.push('max_value_per_tx cannot be zero');
  }

  if (manifest.sessions.maxSessions < 1) {
    errors.push('max_sessions must be at least 1');
  }

  return { valid: errors.length === 0, errors };
}
