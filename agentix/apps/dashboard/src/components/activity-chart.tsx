'use client';

import { useEffect, useRef, useState } from 'react';
import { smoothPath, niceMax } from './kpi-sparkline';

// Activity area chart — the shell's RevenueChart pattern (21st.dev Dashboard
// Shell), simplified to a single series: hover crosshair + tooltip, no
// previous-period overlay, no range switcher. Data is real event volume.

export interface ActivityPoint {
  label: string;
  value: number;
}

const CHART_H = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 40 };

/**
 * Single-series activity area chart: event volume per day with a hover crosshair and tooltip.
 * Why it exists: the overview needs real event volume at a glance, without the previous-period overlay or range switcher of the shell's RevenueChart pattern.
 * @param points - One { label, value } per day, in display order.
 * @param title - Chart title, used in the svg aria-label.
 * @returns The SVG area chart with axis ticks and a hover tooltip; an empty-state message when the total is 0 (no fake data is drawn).
 * Maps to: component Sparkline / niceMax (kpi-sparkline); Maps to: internal — OverviewPage activity card.
 * Side effects: measures its container with ResizeObserver to size the chart.
 */
export function ActivityChart({ points, title }: { points: ActivityPoint[]; title: string }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = points.reduce((s, p) => s + p.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-xs text-muted-foreground/50">
        No events recorded in this window yet
      </div>
    );
  }

  const w = Math.max(width, 200);
  const innerW = w - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  /**
   * Maps a point index to its x pixel coordinate. Divides by max(points.length - 1, 1) so a single point does not divide by zero.
   * @returns The x coordinate in px.
   * Maps to: internal — ActivityChart.
   */
  const x = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * innerW;
  /**
   * Maps a value to its y pixel coordinate (0 at the bottom of the plot area, `max` at the top).
   * @returns The y coordinate in px.
   * Maps to: internal — ActivityChart.
   */
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  const line = smoothPath(pts);
  const area = `${line} L ${x(points.length - 1)} ${PAD.top + innerH} L ${x(0)} ${PAD.top + innerH} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  /**
   * Hover handler: converts the mouse x position to the nearest point index and shows its crosshair/tooltip.
   * @returns void; no-op when the plot ref has no bounding rect.
   * Maps to: internal — ActivityChart.
   * Side effects: sets hover state.
   */
  const onMove = (e: React.MouseEvent) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const idx = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  return (
    <div ref={plotRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg
        width={w}
        height={CHART_H}
        viewBox={`0 0 ${w} ${CHART_H}`}
        role="img"
        aria-label={`${title}: ${total} events over ${points.length} days, peaking at ${Math.max(...points.map((p) => p.value))} in a day`}
        className="block w-full"
      >
        <defs>
          <linearGradient id="activity-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="hsl(var(--foreground))" stopOpacity="0.12" />
            <stop offset="1" stopColor="hsl(var(--foreground))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">
              {t}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#activity-area)" />
        <path d={line} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <text
            key={p.label}
            x={x(i)}
            y={CHART_H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="hsl(var(--muted-foreground))"
          >
            {p.label}
          </text>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="4" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1.75" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-lg"
          style={{ left: `${(x(hover) / w) * 100}%`, top: 0 }}
        >
          <div className="text-[10px] text-muted-foreground">{points[hover].label}</div>
          <div className="text-xs font-medium tabular">
            {points[hover].value} event{points[hover].value === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}
