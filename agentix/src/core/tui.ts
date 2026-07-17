/**
 * Zero-dependency terminal UI toolkit for the AgentIX setup wizard.
 *
 * Everything here is raw ANSI so it survives esbuild bundling with no runtime
 * deps. Provides: truecolor gradients, rounded boxes, spinners, step lists,
 * progress bars, and a small readline-based prompt layer. All output respects
 * NO_COLOR and non-TTY environments (degrades to plain text).
 */
import * as readline from "readline";

const isTTY = process.stdout.isTTY === true;
const noColor = !!process.env.NO_COLOR || !isTTY;

// ── Color primitives ──────────────────────────────────────────────────
export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
};

function rgb(r: number, g: number, b: number): string {
  return noColor ? "" : `\x1b[38;2;${r};${g};${b}m`;
}
function bgRgb(r: number, g: number, b: number): string {
  return noColor ? "" : `\x1b[48;2;${r};${g};${b}m`;
}
function code(c: string): string {
  return noColor ? "" : c;
}

export const c = {
  reset: code(ansi.reset),
  bold: code(ansi.bold),
  dim: code(ansi.dim),
  italic: code(ansi.italic),
  underline: code(ansi.underline),
  // AgentIX palette (indigo → violet → cyan accents)
  indigo: rgb(99, 102, 241),
  violet: rgb(139, 92, 246),
  cyan: rgb(34, 211, 238),
  green: rgb(34, 197, 94),
  red: rgb(239, 68, 68),
  amber: rgb(245, 158, 11),
  gray: rgb(148, 163, 184),
  white: rgb(241, 245, 249),
};

export function paint(text: string, color: string): string {
  return noColor ? text : `${color}${text}${ansi.reset}`;
}

/** Linear truecolor gradient across the characters of `text`. */
export function gradient(text: string, from: [number, number, number], to: [number, number, number]): string {
  if (noColor) return text;
  const chars = [...text];
  const n = Math.max(chars.length - 1, 1);
  return chars
    .map((ch, i) => {
      const t = i / n;
      const r = Math.round(from[0] + (to[0] - from[0]) * t);
      const g = Math.round(from[1] + (to[1] - from[1]) * t);
      const b = Math.round(from[2] + (to[2] - from[2]) * t);
      return `${rgb(r, g, b)}${ch}`;
    })
    .join("") + ansi.reset;
}

// ── Layout helpers ────────────────────────────────────────────────────
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
export const visibleLen = (s: string) => [...stripAnsi(s)].length;

export interface BoxOpts {
  title?: string;
  color?: string;
  padding?: number;
  width?: number;
}

/** Draw a rounded box around multi-line content. */
export function box(content: string, opts: BoxOpts = {}): string {
  const color = opts.color ?? c.violet;
  const pad = opts.padding ?? 1;
  const lines = content.split("\n");
  const maxContent = Math.max(...lines.map(visibleLen), opts.title ? visibleLen(opts.title) + 2 : 0);
  const inner = (opts.width ?? maxContent + pad * 2);
  const top = opts.title
    ? `╭─ ${paint(opts.title, c.bold + color)} ${"─".repeat(Math.max(inner - visibleLen(opts.title) - 3, 0))}╮`
    : `╭${"─".repeat(inner)}╮`;
  const bottom = `╰${"─".repeat(inner)}╯`;
  const body = lines.map((ln) => {
    const padLeft = " ".repeat(pad);
    const padRight = " ".repeat(Math.max(inner - visibleLen(ln) - pad, 0));
    return `${paint("│", color)}${padLeft}${ln}${padRight}${paint("│", color)}`;
  });
  return [paint(top, color), ...body, paint(bottom, color)].join("\n");
}

// ── Symbols ───────────────────────────────────────────────────────────
export const sym = {
  tick: paint("✔", c.green),
  cross: paint("✘", c.red),
  warn: paint("⚠", c.amber),
  info: paint("ℹ", c.cyan),
  dot: paint("•", c.gray),
  arrow: paint("→", c.violet),
  pointer: paint("❯", c.cyan),
  skip: paint("⏭", c.amber),
  bullet: paint("◆", c.violet),
};

// ── Spinner ───────────────────────────────────────────────────────────
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private text: string;
  constructor(text: string) {
    this.text = text;
  }
  start(): this {
    if (!isTTY) {
      process.stdout.write(`  ${sym.dot} ${this.text}\n`);
      return this;
    }
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.timer = setInterval(() => {
      const f = paint(SPINNER_FRAMES[this.frame], c.cyan);
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`  ${f} ${this.text}`);
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
    }, 80);
    return this;
  }
  update(text: string): void {
    this.text = text;
  }
  private stop(symbol: string, text?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write("\x1b[?25h"); // show cursor
    }
    process.stdout.write(`  ${symbol} ${text ?? this.text}\n`);
  }
  succeed(text?: string): void { this.stop(sym.tick, text); }
  fail(text?: string): void { this.stop(sym.cross, text); }
  warn(text?: string): void { this.stop(sym.warn, text); }
  info(text?: string): void { this.stop(sym.info, text); }
}

// ── Progress bar ──────────────────────────────────────────────────────
export function progressBar(current: number, total: number, width = 28): string {
  const ratio = total === 0 ? 0 : Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + paint("░".repeat(width - filled), c.gray);
  const pct = `${Math.round(ratio * 100)}%`.padStart(4);
  return `${gradient(bar.slice(0, filled), [99, 102, 241], [34, 211, 238])}${paint("░".repeat(width - filled), c.gray)} ${paint(pct, c.cyan)}`;
}

// ── Prompt layer (readline, no deps) ──────────────────────────────────
function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Free-text prompt with optional default. */
export async function prompt(message: string, def?: string): Promise<string> {
  const defHint = def ? paint(` (${def})`, c.dim) : "";
  const answer = await ask(`  ${sym.pointer} ${paint(message, c.bold)}${defHint} `);
  return answer.trim() || def || "";
}

/** Yes/no confirm, defaults to yes. */
export async function confirm(message: string, def = true): Promise<boolean> {
  const hint = def ? paint("(Y/n)", c.dim) : paint("(y/N)", c.dim);
  const answer = (await ask(`  ${sym.pointer} ${paint(message, c.bold)} ${hint} `)).trim().toLowerCase();
  if (!answer) return def;
  return answer === "y" || answer === "yes";
}

/** Single-choice selection from a list. Returns the chosen index. */
export async function select(message: string, choices: { label: string; hint?: string }[]): Promise<number> {
  console.log(`\n  ${sym.pointer} ${paint(message, c.bold)}`);
  choices.forEach((ch, i) => {
    const num = paint(`${i + 1}`, c.cyan);
    const hint = ch.hint ? paint(`  ${ch.hint}`, c.dim) : "";
    console.log(`    ${num}. ${ch.label}${hint}`);
  });
  while (true) {
    const answer = (await ask(`  ${sym.pointer} ${paint(`Enter choice (1-${choices.length})`, c.gray)} `)).trim();
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= choices.length) return n - 1;
    console.log(`    ${sym.warn} ${paint("Invalid choice, try again.", c.amber)}`);
  }
}

/** Print the AgentIX gradient banner. */
export function banner(subtitle: string): void {
  const logo = [
    "  █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗  ██╗",
    " ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║╚██╗██╔╝",
    " ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║ ╚███╔╝ ",
    " ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║ ██╔██╗ ",
    " ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║██╔╝ ██╗",
    " ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═╝",
  ];
  console.log();
  for (const line of logo) {
    console.log(gradient(line, [99, 102, 241], [34, 211, 238]));
  }
  console.log(`  ${paint(subtitle, c.gray)}\n`);
}

export { isTTY, noColor };
