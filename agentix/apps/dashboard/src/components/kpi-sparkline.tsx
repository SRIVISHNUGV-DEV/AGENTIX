'use client';

import { useId } from 'react';

// Monotone cubic interpolation, so the curve never overshoots the data.
// Ported from the 21st.dev Dashboard Shell (isaiahbjork/app-dashboard-shell).
function smoothPath(pts: number[][]) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) {
    m.push(
      slope[i - 1] * slope[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) /
            ((2 * dx[i] + dx[i - 1]) / slope[i - 1] +
              (dx[i] + 2 * dx[i - 1]) / slope[i]),
    );
  }
  m.push(slope[n - 2]);
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C ${(x0 + h).toFixed(2)} ${(y0 + m[i] * h).toFixed(2)}, ${(x1 - h).toFixed(2)} ${(y1 - m[i + 1] * h).toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

/** Small area sparkline for KPI cards. `good` colors the end dot. */
export function Sparkline({ values, good }: { values: number[]; good: boolean }) {
  const w = 76;
  const h = 30;
  const gid = useId();
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - 4) + 2,
    h - 3 - ((v - min) / (max - min || 1)) * (h - 6),
  ]);
  const d = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="hidden shrink-0 overflow-visible sm:block"
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--foreground))" stopOpacity="0.1" />
          <stop offset="1" stopColor="hsl(var(--foreground))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${last[0]} ${h} L ${pts[0][0]} ${h} Z`} fill={`url(#${gid})`} />
      <path
        d={d}
        fill="none"
        stroke="hsl(var(--muted-foreground))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="2.75"
        fill={good ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
        stroke="hsl(var(--card))"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Round a max value up to a "nice" axis number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 × 10^n). */
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice =
    f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
  return nice * exp;
}

export { smoothPath };
