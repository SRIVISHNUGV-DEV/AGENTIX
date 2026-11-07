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

/**
 * Build a truecolor foreground ANSI escape for one RGB colour.
 * Raw escape builder for the palette: callers use the prebuilt `c` colours, not this directly.
 * @param r — red 0–255; out-of-range values produce an invalid escape (callers must clamp).
 * @returns The escape sequence, or "" when colours are disabled (NO_COLOR or non-TTY).
 * @throws Never throws.
 * Maps to: internal — palette `c` (indigo/violet/cyan/green/red/amber/gray/white).
 */
function rgb(r: number, g: number, b: number): string {
  return noColor ? "" : `\x1b[38;2;${r};${g};${b}m`;
}
/**
 * Build a truecolor background ANSI escape for one RGB colour.
 * Kept for palette completeness; the current UI only uses foreground colours.
 * @param r — red 0–255; out-of-range values produce an invalid escape (callers must clamp).
 * @returns The escape sequence, or "" when colours are disabled (NO_COLOR or non-TTY).
 * @throws Never throws.
 * Maps to: internal — palette `c` (background variant, currently unused by the UI).
 */
function bgRgb(r: number, g: number, b: number): string {
  return noColor ? "" : `\x1b[48;2;${r};${g};${b}m`;
}
/**
 * Pass an ANSI code through unchanged, or swallow it when colours are disabled.
 * The single choke point that makes every `c.*` colour respect NO_COLOR/non-TTY.
 * @param c — a raw ANSI escape such as bold or underline.
 * @returns The code itself, or "" when colours are disabled.
 * @throws Never throws.
 * Maps to: internal — palette `c` (reset/bold/dim/italic/underline).
 */
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

/**
 * Wrap text in a colour and reset it afterwards, or return it plain when colours are off.
 * The basic colouriser for all CLI output; always resets so colours never leak into the next line.
 * @param color — a prebuilt escape from `c` (or "" for no colour).
 * @returns The coloured text, or the text unchanged when colours are disabled.
 * @throws Never throws.
 * Maps to: internal — box / banner / prompt layer (all coloured CLI output).
 */
export function paint(text: string, color: string): string {
  return noColor ? text : `${color}${text}${ansi.reset}`;
}

/**
 * Colour each character of text along a linear truecolor gradient.
 * Headline effect for the banner and progress bar; single characters get the `from` colour.
 * @param from — starting RGB triple; `to` — ending RGB triple.
 * @returns The gradient-coloured text with a trailing reset, or the text unchanged when colours are disabled.
 * @throws Never throws.
 * Maps to: internal — banner (logo) and progressBar (filled portion).
 */
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
/**
 * Strip SGR colour escapes from a string so its visible width can be measured.
 * Layout math must use visible length, not byte length — coloured text would otherwise misalign boxes.
 * @param s — any string, possibly containing ANSI escapes.
 * @returns The string with \x1b[...m sequences removed (other escapes are left alone).
 * @throws Never throws.
 * Maps to: internal — visibleLen (box width computation).
 */
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/**
 * Count the visible (printable) characters in a string, ignoring colour escapes.
 * Counts Unicode code points, so wide glyphs (box-drawing, emoji) count as one each.
 * @param s — any string, possibly coloured.
 * @returns The printable length; 0 for an empty or all-escape string.
 * @throws Never throws.
 * Maps to: internal — box (column widths and padding).
 */
export const visibleLen = (s: string) => [...stripAnsi(s)].length;

export interface BoxOpts {
  title?: string;
  color?: string;
  padding?: number;
  width?: number;
}

/**
 * Draw a rounded box around multi-line content, with an optional title.
 * The panel primitive for wizard output; width follows the longest visible line unless opts.width overrides it.
 * @param content — lines joined by \n; empty content still draws a box.
 * @param opts — title, colour (default violet), padding (default 1), and fixed width.
 * @returns The boxed string (no trailing newline).
 * @throws Never throws.
 * Maps to: internal — setup wizard panels (CLI init output).
 */
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
  /**
   * Create a spinner showing `text` while work runs.
   * Construction only stores the label; call start() to begin animating.
   * @param text — the label shown beside the spinner; update() can change it later.
   * @returns A stopped Spinner.
   * @throws Never throws.
   * Maps to: internal — setup wizard steps (one Spinner per step).
   */
  constructor(text: string) {
    this.text = text;
  }
  /**
   * Start animating the spinner (80ms frames) and hide the cursor.
   * On a non-TTY it prints the label once as a plain line instead of animating.
   * @returns This Spinner, for chaining (e.g. new Spinner(x).start()).
   * @throws Never throws.
   * Maps to: internal — setup wizard steps (start a step, stop it with succeed/fail).
   * Side effects: stdout writes and a repeating timer (terminal I/O); hides the cursor on TTY.
   */
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
  /**
   * Change the spinner's label while it is running.
   * For steps whose status changes mid-work; the next frame shows the new text.
   * @param text — the new label.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Spinner.start (label shown by the running animation).
   */
  update(text: string): void {
    this.text = text;
  }
  /**
   * Stop the animation, restore the cursor, and print the final line with a status symbol.
   * The single exit path for succeed/fail/warn/info: always clears the timer and the current line first.
   * @param symbol — the status glyph (tick/cross/warn/info from `sym`).
   * @param text — final label; defaults to the spinner's current text.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — succeed / fail / warn / info (the only callers).
   * Side effects: clears the interval, restores the cursor, writes the final line.
   */
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
  /**
   * Finish the spinner with a green tick.
   * Call when the step completed; the final line keeps the spinner's text unless overridden.
   * @param text — optional replacement for the final line.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Spinner.stop (success outcome).
   */
  succeed(text?: string): void { this.stop(sym.tick, text); }
  /**
   * Finish the spinner with a red cross.
   * Call when the step failed; pair with an error message so the failure is diagnosable.
   * @param text — optional replacement for the final line.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Spinner.stop (failure outcome).
   */
  fail(text?: string): void { this.stop(sym.cross, text); }
  /**
   * Finish the spinner with an amber warning triangle.
   * Call when the step completed with a caveat the user should notice.
   * @param text — optional replacement for the final line.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Spinner.stop (warning outcome).
   */
  warn(text?: string): void { this.stop(sym.warn, text); }
  /**
   * Finish the spinner with a cyan info mark.
   * Call when the step ended in an informational (neither success nor failure) state.
   * @param text — optional replacement for the final line.
   * @returns Nothing.
   * @throws Never throws.
   * Maps to: internal — Spinner.stop (info outcome).
   */
  info(text?: string): void { this.stop(sym.info, text); }
}

// ── Progress bar ──────────────────────────────────────────────────────
/**
 * Render a gradient progress bar with a percentage for one line of output.
 * Pure string builder: callers re-print it to animate; it never writes to stdout itself.
 * @param current — completed units; clamped to `total` (over-completion shows 100%).
 * @param total — total units; 0 renders an empty 0% bar instead of dividing by zero.
 * @returns The bar string (gradient fill + grey remainder + percentage).
 * @throws Never throws.
 * Maps to: internal — setup wizard progress display.
 */
export function progressBar(current: number, total: number, width = 28): string {
  const ratio = total === 0 ? 0 : Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + paint("░".repeat(width - filled), c.gray);
  const pct = `${Math.round(ratio * 100)}%`.padStart(4);
  return `${gradient(bar.slice(0, filled), [99, 102, 241], [34, 211, 238])}${paint("░".repeat(width - filled), c.gray)} ${paint(pct, c.cyan)}`;
}

// ── Prompt layer (readline, no deps) ──────────────────────────────────
/**
 * Ask one free-text question on stdin and resolve with the raw answer.
 * Opens and closes its own readline interface per call; the prompt layer (prompt/confirm/select) is built on this.
 * @param question — the full prompt text, already formatted (pointer + bold message).
 * @returns The answer exactly as typed (untrimmed — callers trim).
 * @throws Never throws on input; a closed stdin resolves with whatever was read (possibly "").
 * Maps to: internal — prompt / confirm / select (the only callers).
 * Side effects: reads one line from stdin (terminal I/O).
 */
function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt for free text, returning the default when the answer is empty.
 * The wizard's text-input primitive; the default is shown dimmed in parentheses.
 * @param message — the question; `def` — the value used for an empty answer ("" when omitted).
 * @returns The trimmed answer, or the default, or "" when both are empty.
 * @throws Never throws on input; stdin errors propagate from ask().
 * Maps to: internal — setup wizard (CLI init prompts).
 * Side effects: reads one line from stdin.
 */
export async function prompt(message: string, def?: string): Promise<string> {
  const defHint = def ? paint(` (${def})`, c.dim) : "";
  const answer = await ask(`  ${sym.pointer} ${paint(message, c.bold)}${defHint} `);
  return answer.trim() || def || "";
}

/**
 * Ask a yes/no question, defaulting to yes unless told otherwise.
 * Empty input returns the default; only "y"/"yes" count as yes, everything else as no.
 * @param message — the question; `def` — the answer for empty input (default true).
 * @returns True for yes, false for no (or empty input when def is false).
 * @throws Never throws on input; stdin errors propagate from ask().
 * Maps to: internal — setup wizard (CLI init confirmations).
 * Side effects: reads one line from stdin.
 */
export async function confirm(message: string, def = true): Promise<boolean> {
  const hint = def ? paint("(Y/n)", c.dim) : paint("(y/N)", c.dim);
  const answer = (await ask(`  ${sym.pointer} ${paint(message, c.bold)} ${hint} `)).trim().toLowerCase();
  if (!answer) return def;
  return answer === "y" || answer === "yes";
}

/**
 * Offer a numbered single-choice list and return the chosen index.
 * Loops until the user enters a valid number, so it never returns an out-of-range choice.
 * @param choices — the options; an empty list loops forever asking (callers must pass at least one).
 * @returns The 0-based index of the chosen option.
 * @throws Never throws on input; stdin errors propagate from ask().
 * Maps to: internal — setup wizard (CLI init selections, e.g. RPC provider).
 * Side effects: prints the list and reads lines from stdin until valid.
 */
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

/**
 * Print the gradient AgentIX ASCII banner with a subtitle underneath.
 * The first thing the CLI prints; pure presentation, no state.
 * @param subtitle — one line shown grey beneath the logo.
 * @returns Nothing.
 * @throws Never throws.
 * Maps to: internal — CLI entry (startup banner).
 * Side effects: stdout writes.
 */
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
