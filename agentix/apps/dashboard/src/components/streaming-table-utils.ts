'use client';

import { useEffect, useRef, useState } from 'react';

// Small utilities backing the streaming table. Clean-room equivalents of the
// `motiq` helpers the 21st.dev Streaming Data Rows component ships with
// (rmahammad/streaming-data-rows) — same signatures, Agentix tokens.

export type StatusTone = 'success' | 'error' | 'warning' | 'active' | 'info' | 'neutral';

/**
 * Tracks the OS `prefers-reduced-motion: reduce` setting, live.
 * Why it exists: the streaming table must swap animations for instant updates when the user asks for reduced motion.
 * @returns true when reduced motion is preferred, false otherwise (false before mount / when matchMedia is unavailable).
 * Maps to: internal — StreamingTable and useAnimatedNumber (both suppress animation when this is true).
 * Side effects: subscribes to the media-query `change` event; unsubscribes on unmount.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

/**
 * Tweens a displayed number toward `value` with a cubic ease-out over `duration`, so live numbers morph instead of jumping.
 * @param value - The target number to display.
 * @param opts - `disabled` snaps instantly (used under reduced motion / pause); `duration` defaults to 320ms.
 * @returns The current (possibly mid-tween) display value; equals `value` immediately when disabled or unchanged.
 * Maps to: internal — MorphNumber (streaming-table).
 * Side effects: schedules/cancels requestAnimationFrame; cancels any pending frame on unmount.
 */
export function useAnimatedNumber(value: number, opts?: { disabled?: boolean; duration?: number }): number {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number | undefined>(undefined);
  const disabled = opts?.disabled ?? false;
  const duration = opts?.duration ?? 320;

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    if (disabled || from === value) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    rafRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [value, disabled, duration]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return display;
}

/**
 * Formats a number with en-US grouping (e.g. 1,234.5).
 * @param n - The number to format.
 * @param opts - `maximumFractionDigits`, defaults to 2.
 * @returns The formatted string.
 * Maps to: internal — MorphNumber and any numeric cell rendering.
 */
export function formatNumber(n: number, opts?: { maximumFractionDigits?: number }): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
  }).format(n);
}

/**
 * Turns a machine status string (camelCase / snake_case / kebab-case) into a readable label.
 * @param status - Raw status string; empty input returns "" (capitalized no-op).
 * @returns The humanized label with the first letter capitalized.
 * Maps to: internal — getStatusMeta.
 */
function humanize(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Maps a status string to a display label plus a tone, by keyword matching (error/fail/revok → error, pending/warn/expir → warning, active/running/live → active, success/paid/confirmed → success, info/queued/idle → info).
 * Why it exists: status strings arrive from many sources in many casings, and the table needs one consistent tone per status.
 * @param status - Raw status string; matched case-insensitively.
 * @returns `{ label, tone }`; unknown statuses fall back to tone 'neutral' with the humanized label.
 * Maps to: internal — StatusPill and statusVars.
 */
export function getStatusMeta(status: string): { label: string; tone: StatusTone } {
  const s = status.toLowerCase();
  if (/(error|fail|revok|refund|deactivat|denied|rejected)/.test(s)) return { label: humanize(status), tone: 'error' };
  if (/(pending|warn|expir|reindex|paused)/.test(s)) return { label: humanize(status), tone: 'warning' };
  if (/(active|running|indexing|live|used|online)/.test(s)) return { label: humanize(status), tone: 'active' };
  if (/(success|paid|confirmed|completed|created|registered|issued|linked|added|approved|initialized)/.test(s))
    return { label: humanize(status), tone: 'success' };
  if (/(info|note|queued|idle)/.test(s)) return { label: humanize(status), tone: 'info' };
  return { label: humanize(status), tone: 'neutral' };
}

/**
 * Returns soft background / text / border colors for a tone, derived from the Agentix theme tokens.
 * @param tone - StatusTone; success/error/warning map to their tokens, active/info to --info, anything else to --muted-foreground.
 * @returns `{ bg, color, border }` as hsl() strings (bg at 10% opacity, border at 25%).
 * Maps to: internal — StatusPill, ChangePulse, ActionButtons.
 */
export function statusVars(tone: StatusTone): { bg: string; color: string; border: string } {
  const token =
    tone === 'success'
      ? '--success'
      : tone === 'error'
        ? '--destructive'
        : tone === 'warning'
          ? '--warning'
          : tone === 'active' || tone === 'info'
            ? '--info'
            : '--muted-foreground';
  return {
    bg: `hsl(var(${token}) / 0.1)`,
    color: `hsl(var(${token}))`,
    border: `hsl(var(${token}) / 0.25)`,
  };
}
