'use client';

import { useEffect, useRef, useState } from 'react';

// Small utilities backing the streaming table. Clean-room equivalents of the
// `motiq` helpers the 21st.dev Streaming Data Rows component ships with
// (rmahammad/streaming-data-rows) — same signatures, Agentix tokens.

export type StatusTone = 'success' | 'error' | 'warning' | 'active' | 'info' | 'neutral';

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

/** Tweens a number toward `value`; snaps instantly when `disabled`. */
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

export function formatNumber(n: number, opts?: { maximumFractionDigits?: number }): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
  }).format(n);
}

function humanize(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Map a status string to a tone + display label (color is never the only signal). */
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

/** Soft background / text / border colors for a tone, from the Agentix theme tokens. */
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
