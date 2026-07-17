import { existsSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { loadConfig, AGENTIX_HOME } from "./config";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "\x1b[90m",
  [LogLevel.INFO]: "\x1b[36m",
  [LogLevel.WARN]: "\x1b[33m",
  [LogLevel.ERROR]: "\x1b[31m",
};

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private logDir: string;

  constructor() {
    this.logDir = join(AGENTIX_HOME, "logs");
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });

    // Verbose/debug mode via env: AGENTIX_LOG_LEVEL=debug|info|warn|error.
    const envLevel = (process.env.AGENTIX_LOG_LEVEL || "").toLowerCase();
    const map: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };
    if (envLevel in map) this.level = map[envLevel];
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private write(level: LogLevel, component: string, message: string, data?: any) {
    if (level < this.level) return;

    const ts = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const color = LEVEL_COLORS[level];
    const prefix = `${color}[${ts}] [${label}] [${component}]\x1b[0m`;
    const line = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

    if (level >= LogLevel.WARN) {
      console.error(line);
    } else {
      console.log(line);
    }

    try {
      const logFile = join(this.logDir, `agentix-${new Date().toISOString().slice(0, 10)}.log`);
      appendFileSync(logFile, `${line}\n`);
    } catch {}
  }

  debug(component: string, message: string, data?: any) {
    this.write(LogLevel.DEBUG, component, message, data);
  }

  info(component: string, message: string, data?: any) {
    this.write(LogLevel.INFO, component, message, data);
  }

  warn(component: string, message: string, data?: any) {
    this.write(LogLevel.WARN, component, message, data);
  }

  error(component: string, message: string, data?: any) {
    this.write(LogLevel.ERROR, component, message, data);
  }
}

export const logger = new Logger();
