import { loadConfig, saveConfig, AGENTIX_HOME, AgentixConfig } from "../core/config";
import { logger } from "../core/logger";

export interface ConfigResult {
  success: boolean;
  key?: string;
  value?: any;
  config?: Partial<AgentixConfig>;
  error?: string;
}

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

export function resetConfig(): ConfigResult {
  try {
    saveConfig({} as any);
    logger.info("config", "Configuration reset to defaults");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function showConfig(): ConfigResult {
  try {
    const config = loadConfig();
    return { success: true, config };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
