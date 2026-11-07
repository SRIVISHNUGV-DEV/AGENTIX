import { loadConfig, saveConfig, AGENTIX_HOME, AgentixConfig } from "../core/config";
import { logger } from "../core/logger";

export interface ConfigResult {
  success: boolean;
  key?: string;
  value?: any;
  config?: Partial<AgentixConfig>;
  error?: string;
}

/**
 * One config value by dotted path, or the whole config when no key is given.
 * Read path for everything the runtime needs (RPC URL, chain id, contract
 * addresses); unknown paths return value:undefined with success:true, not an error.
 * @param key - Dot path such as "database.path"; omit for the full config object.
 * @returns ConfigResult with `value` (single key) or `config` (whole config); success:false only if the config file cannot be loaded.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_config_get (key) / agentix_config_show (whole config).
 * Side effects: reads (and may create defaults for) the local config file.
 */
export function getConfig(key?: string): ConfigResult {
  try {
    const config = loadConfig();

    if (key) {
      const parts = key.split(".");
      let value: any = config;
      for (const part of parts) {
        value = value?.[part];
      }
      return { success: true, key, value };
    }

    return { success: true, config };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Set one dotted-path config value and persist it to disk.
 * String values from the CLI are coerced — "123" becomes a number, "true"/"false"
 * become booleans — and missing intermediate objects are created, so a typo'd
 * path silently adds a new key instead of failing.
 * @param key - Dot path such as "rpcUrl" or "database.path"; must be non-empty.
 * @param value - Raw string; numeric/boolean coercion applies (see above), anything else stays a string.
 * @returns ConfigResult with the coerced stored value; success:false if load or save fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_config_set (dashboard-only) / CLI 'agentix config set'.
 * Side effects: rewrites agentix.config.json.
 * Security: writes RPC URLs and contract addresses the runtime trusts — a wrong value breaks or redirects all on-chain calls.
 */
export function setConfig(key: string, value: string): ConfigResult {
  try {
    const config = loadConfig();
    const parts = key.split(".");

    let target: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]]) target[parts[i]] = {};
      target = target[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (!isNaN(Number(value))) {
      target[lastKey] = Number(value);
    } else if (value === "true" || value === "false") {
      target[lastKey] = value === "true";
    } else {
      target[lastKey] = value;
    }

    saveConfig(config);

    logger.info("config", `Set ${key} = ${value}`);

    return { success: true, key, value: target[lastKey] };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Wipe the local config back to defaults.
 * Recovery path for a config so broken the runtime cannot start; every custom
 * value (RPC URL, contract addresses) is lost and must be re-entered.
 * @returns ConfigResult with success:true; success:false if the save fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: internal — config management (no contract or MCP counterpart).
 * Side effects: DESTRUCTIVE — overwrites agentix.config.json with an empty object (defaults re-applied on next load).
 */
export function resetConfig(): ConfigResult {
  try {
    saveConfig({} as any);
    logger.info("config", "Configuration reset to defaults");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * The whole loaded config object.
 * Same data as getConfig() with no key; use it for display and debugging rather
 * than for reading single values.
 * @returns ConfigResult with `config`; success:false only if the config file cannot be loaded.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_config_show.
 * Side effects: reads (and may create defaults for) the local config file.
 */
export function showConfig(): ConfigResult {
  try {
    const config = loadConfig();
    return { success: true, config };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
