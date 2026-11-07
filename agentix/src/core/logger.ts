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

  /**
   * Build the process-wide logger and create the log directory.
   * Reads AGENTIX_LOG_LEVEL (debug/info/warn/error) once; anything else keeps INFO.
   * @returns A Logger writing to stdout/stderr and to daily files under AGENTIX_HOME/logs.
   * @throws Never throws — a missing log dir is created; creation failure is swallowed by write().
   * Maps to: internal — module singleton `logger` used by every module.
   * Side effects: creates AGENTIX_HOME/logs on first construction.
   */
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

  /**
   * Raise or lower the minimum level this logger emits.
   * Call to enable verbose output for a debugging session; default is INFO.
   * @param level — new floor; messages below it are dropped silently.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — logger consumers that need runtime verbosity control.
   */
  setLevel(level: LogLevel) {
    this.level = level;
  }

  /**
   * Emit one log line to the console and append it to today's log file.
   * WARN+ goes to stderr, the rest to stdout; lines below the configured level are dropped.
   * @param component — short module tag shown in brackets, e.g. "provider".
   * @param data — optional payload, JSON-stringified inline; omit for plain messages.
   * @returns Nothing; file-append failures are swallowed so logging never crashes the caller.
   * @throws Never throws.
   * Maps to: internal — debug / info / warn / error (the only callers).
   * Side effects: console output and a daily log file write (disk I/O).
   */
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

  /**
   * Log a verbose diagnostic message (only when level is DEBUG).
   * For internals a reader needs while debugging; never for user-visible state.
   * @returns Nothing; dropped silently unless the level is DEBUG.
   * @throws Never throws.
   * Maps to: internal — write (LogLevel.DEBUG).
   */
  debug(component: string, message: string, data?: any) {
    this.write(LogLevel.DEBUG, component, message, data);
  }

  /**
   * Log a normal operational event (default level).
   * For state changes worth a timeline: startup, indexing progress, payments settled.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — write (LogLevel.INFO).
   */
  info(component: string, message: string, data?: any) {
    this.write(LogLevel.INFO, component, message, data);
  }

  /**
   * Log a recoverable problem (goes to stderr).
   * For degraded paths the caller survived: fallback RPCs, stale price cache, best-effort I/O.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — write (LogLevel.WARN).
   */
  warn(component: string, message: string, data?: any) {
    this.write(LogLevel.WARN, component, message, data);
  }

  /**
   * Log a failure (goes to stderr).
   * For errors the caller could not recover from; pair with the returned error, not instead of it.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — write (LogLevel.ERROR).
   */
  error(component: string, message: string, data?: any) {
    this.write(LogLevel.ERROR, component, message, data);
  }
}

export const logger = new Logger();
