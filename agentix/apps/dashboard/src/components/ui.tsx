import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Sparkline } from './kpi-sparkline';

// ── Button ───────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
}

/**
 * Themed button with variant/size/loading states (loading swaps the icon for a spinner and disables the button).
 * @param variant - primary | secondary | ghost | danger (default primary).
 * @param size - sm | md | lg (default md).
 * @param icon - Optional leading icon node (hidden while loading).
 * @param loading - When true, shows a Spinner and disables the button (also when `disabled` is set).
 * @returns The <button> with the ref forwarded; all other ButtonHTMLAttributes pass through.
 * Maps to: internal — every dashboard section's actions.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, children, className = '', disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-foreground text-background hover:opacity-90',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-accent border border-border',
      ghost: 'text-muted-foreground hover:text-foreground hover:bg-accent',
      danger: 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20',
    };
    const sizes = {
      sm: 'px-2.5 py-1.5 text-[11px] gap-1.5',
      md: 'px-3.5 py-2 text-xs gap-2',
      lg: 'px-5 py-2.5 text-sm gap-2',
    };
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// ── Badge ────────────────────────────────────────

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
}

/**
 * Small status/label badge.
 * @param variant - default | success | warning | danger | info (default 'default').
 * @param size - sm | md (default sm).
 * @returns The badge span wrapping `children`.
 * Maps to: internal — status columns and counts across the sections.
 */
export function Badge({ variant = 'default', size = 'sm', children, className = '' }: BadgeProps) {
  const colors = {
    default: 'bg-secondary text-muted-foreground',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };
  const sizes = { sm: 'px-2 py-0.5 text-[10px]', md: 'px-2.5 py-1 text-xs' };
  return (
    <span className={`inline-flex items-center font-medium rounded-md tracking-wide ${colors[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}

// ── StatCard ──────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  /** Direction of the trend — colors the trend text and shows an arrow. */
  trendDir?: 'up' | 'down' | 'neutral';
  /** When true, renders a shimmer placeholder instead of the value. */
  loading?: boolean;
  /** Daily series for the sparkline (right side, replaces the icon when set). */
  sparkline?: number[];
  /** Whether the sparkline's direction reads as good (colors the end dot). */
  sparkGood?: boolean;
}

/**
 * KPI card: label, large value, optional trend arrow/text, and either a sparkline (when 2+ points) or the icon.
 * @param value - Displayed value (string or number).
 * @param trendDir - 'up' (green ↑) | 'down' (red ↓) | 'neutral' (muted, no arrow); the arrow is decorative — the trend text carries the meaning.
 * @param loading - When true, renders a shimmer placeholder instead of the value/trend.
 * @param sparkline - Daily series; replaces the icon when it has 2+ points. `sparkGood` colors its end dot.
 * @returns The stat card; while loading only the label and skeleton show.
 * Maps to: component Sparkline; used by OverviewPage, AnalyticsPage, X402Page.
 */
export function StatCard({ label, value, icon, trend, trendDir = 'neutral', loading, sparkline, sparkGood = true }: StatCardProps) {
  const trendColor =
    trendDir === 'up' ? 'text-success' : trendDir === 'down' ? 'text-destructive' : 'text-muted-foreground/50';
  const trendArrow = trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '';
  return (
    <div className="glass card-interactive p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-[0.15em] font-medium">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-16 mt-2" />
          ) : (
            <p className="text-2xl font-light mt-1.5 tabular">{value}</p>
          )}
          {trend && !loading && (
            <p className={`text-[10px] mt-1 flex items-center gap-1 ${trendColor}`}>
              {trendArrow && <span className="font-medium">{trendArrow}</span>}
              {trend}
            </p>
          )}
        </div>
        {sparkline && sparkline.length >= 2 && !loading ? (
          <Sparkline values={sparkline} good={sparkGood} />
        ) : (
          <div className="text-muted-foreground/25 bg-secondary/40 rounded-lg p-2">{icon}</div>
        )}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

/**
 * Glass content card; becomes a clickable card when `hover` or `onClick` is set.
 * @returns The card div wrapping `children`.
 * Maps to: internal — section layouts throughout the dashboard.
 */
export function Card({ children, className = '', hover, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass p-4 ${hover ? 'cursor-pointer transition-all duration-150 hover:bg-[hsl(var(--card-hover))]' : ''} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Card header row: title + optional description on the left, optional action node on the right.
 * @returns The header div.
 * Maps to: internal — Card content in the sections.
 */
export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ── PageHeader ──────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Page header: large title + optional description, with an optional action group on the right, above a divider.
 * @returns The header div.
 * Maps to: internal — every section page.
 */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6 pb-5 border-b border-border">
      <div>
        <h1 className="text-xl font-medium">{title}</h1>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────

/**
 * Shimmer placeholder block used while data loads.
 * @returns A div with the skeleton-shimmer style; size comes from `className`.
 * Maps to: internal — loading states in StatCard and the sections.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-md ${className}`} />;
}

// ── Empty State ──────────────────────────────────

/**
 * Centered empty state: icon, title, optional description, and optional action.
 * @returns The empty-state div.
 * Maps to: internal — empty lists across the sections.
 */
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-muted-foreground/30 mb-4">{icon}</div>
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground/60 mt-1.5 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Dialog ───────────────────────────────────────

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Modal dialog with a backdrop (clicking it closes) and a title bar with an X button.
 * @param open - When false, renders null (children are not mounted).
 * @param onClose - Called on backdrop click or X.
 * @returns The dialog overlay, or null when closed. Note: no focus trap and no Escape handling — callers must not rely on keyboard dismissal.
 * Maps to: internal — create/issue dialogs in the sections.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-[hsl(var(--overlay))]" />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Toast ────────────────────────────────────────

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}

/**
 * Fixed bottom-right toast with a dismiss button.
 * @param type - success | error | info (default info); drives the border/background color.
 * @returns The toast div. It does not auto-dismiss — the owner must clear it (usually via onClose).
 * Maps to: internal — DashboardInner (which owns the toast state).
 */
export function Toast({ message, type = 'info', onClose }: ToastProps) {
  const colors = { success: 'border-success/30 bg-success/5 text-success', error: 'border-destructive/30 bg-destructive/5 text-destructive', info: 'border-border bg-card text-foreground' };
  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-up ${colors[type]}`}>
      <span className="text-xs">{message}</span>
      <button onClick={onClose} className="opacity-50 hover:opacity-100 text-xs">&times;</button>
    </div>
  );
}

// ── Alert ────────────────────────────────────────

/**
 * Inline alert strip (border + tinted background) for success/error/warning/info messages.
 * @param variant - Drives the color; default 'info'.
 * @returns The alert div wrapping `children`.
 * Maps to: internal — error/success banners in the sections.
 */
export function Alert({ variant = 'info', children, className = '' }: { variant?: 'success' | 'error' | 'warning' | 'info'; children: ReactNode; className?: string }) {
  const colors = { success: 'border-success/20 bg-success/5 text-success', error: 'border-destructive/20 bg-destructive/5 text-destructive', warning: 'border-warning/20 bg-warning/5 text-warning', info: 'border-border bg-card text-foreground' };
  return <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs ${colors[variant]} ${className}`}>{children}</div>;
}

// ── StatusDot ────────────────────────────────────

/**
 * Small status dot (pulsing when online).
 * @param status - online | warning | error | offline; the color comes from the `status-dot` CSS class.
 * @returns The dot span.
 * Maps to: internal — network/wallet status indicators in OverviewPage, Sidebar, DiagnosticsPage.
 */
export function StatusDot({ status }: { status: 'online' | 'warning' | 'error' | 'offline' }) {
  return <span className={`status-dot ${status} ${status === 'online' ? 'animate-pulse-dot' : ''}`} />;
}

// ── Table ────────────────────────────────────────

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
}

/**
 * Simple (non-streaming) data table with staggered row entrance and optional row clicks.
 * Prefer StreamingTable for live data; this one is for static lists.
 * @param columns - { key, header, render, className? } per column; `render` must be total for every row.
 * @param data - Rows to render; an empty array renders the empty message instead of a table.
 * @param onRowClick - When set, rows become clickable (pointer cursor + hover) and invoke it with the row.
 * @param emptyMessage - Shown when `data` is empty (default 'No data').
 * @returns The scrollable table, or the centered empty message when there are no rows.
 * Maps to: internal — list sections (Anomalies, Backups, Capabilities, Delegations, Identities, Sessions, Transactions, Wallets, Organizations, Credentials, X402).
 */
export function Table<T extends Record<string, any>>({ columns, data, onRowClick, emptyMessage }: TableProps<T>) {
  if (data.length === 0) {
    return <div className="text-xs text-muted-foreground/60 text-center py-8">{emptyMessage || 'No data'}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm">
          <tr>
            {columns.map(col => <th key={col.key} className={col.className}>{col.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((item, i) => (
            <tr
              key={item.id || i}
              onClick={() => onRowClick?.(item)}
              className={`animate-row-in transition-colors ${onRowClick ? 'cursor-pointer hover:bg-accent/50' : ''}`}
              style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
            >
              {columns.map(col => <td key={col.key} className={col.className}>{col.render(item)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────

interface TimelineItem {
  time: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  status?: 'success' | 'warning' | 'error' | 'info';
}

/**
 * Vertical timeline: time + title + optional description per item, with a status-colored dot and a connecting line.
 * @param items - Timeline items in display order; an empty array renders an empty div.
 * @returns The timeline div.
 * Maps to: internal — OverviewPage recent events.
 */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-0">
      {items.map((item, i) => (
        <div key={i} className="flex gap-3 pb-4 relative">
          <div className="flex flex-col items-center">
            <div className={`w-2 h-2 rounded-full mt-1.5 ${item.status === 'success' ? 'bg-success' : item.status === 'error' ? 'bg-destructive' : item.status === 'warning' ? 'bg-warning' : 'bg-muted-foreground/30'}`} />
            {i < items.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50 font-mono">{item.time}</span>
              <span className="text-xs font-medium truncate">{item.title}</span>
            </div>
            {item.description && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Progress ─────────────────────────────────────

/**
 * Thin progress bar.
 * @param value - Percent; clamped to 0–100 (out-of-range values render as the nearest edge, not an error).
 * @returns The bar div with the fill width set from `value`.
 * Maps to: internal — CredentialsPage (flow progress display).
 */
export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-secondary overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-foreground/30 transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ── Spinner ──────────────────────────────────────

/**
 * Small spinning loading indicator (0.6s rotation).
 * @param size - Width/height in px (default 14).
 * @returns The SVG spinner.
 * Maps to: internal — Button (loading state).
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className="animate-spin" style={{ animationDuration: '0.6s' }}>
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
      <path d="M7 1a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Input ────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/**
 * Labeled text input (label above the field when given).
 * @param label - Optional uppercase label rendered above the input.
 * @returns The labeled input; all other InputHTMLAttributes pass through to the <input>.
 * Maps to: internal — forms in the sections (sessions, credentials, settings, x402 policy).
 */
export function Input({ label, className = '', ...props }: InputProps) {
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{label}</label>}
      <input className={`w-full px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-colors ${className}`} {...props} />
    </div>
  );
}

// ── Select ───────────────────────────────────────

/**
 * Labeled select dropdown (label above the field when given).
 * @param label - Optional uppercase label rendered above the select.
 * @returns The labeled select; all other SelectHTMLAttributes pass through.
 * Maps to: internal — filter/form selects in the sections (Events, Credentials, Developer docs use the native select directly in places).
 */
export function Select({ label, children, className = '', ...props }: { label?: string; children: ReactNode; className?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div>
      {label && <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{label}</label>}
      <select className={`w-full px-3 py-2 rounded-lg bg-secondary border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${className}`} {...props}>
        {children}
      </select>
    </div>
  );
}

// ── Code Block ───────────────────────────────────

/**
 * Preformatted code block with wrapping and break-all for long tokens.
 * @param children - The code text to display.
 * @returns The <pre> block.
 * Maps to: internal — DeveloperPage SDK playground.
 */
export function CodeBlock({ children, className = '' }: { children: string; className?: string }) {
  return (
    <pre className={`p-3 rounded-lg bg-secondary text-xs text-muted-foreground font-mono overflow-x-auto whitespace-pre-wrap break-all ${className}`}>
      {children}
    </pre>
  );
}

// ── LoadingRows ──────────────────────────────────

/**
 * Stack of skeleton rows for loading lists.
 * @param count - Number of skeleton rows (default 3).
 * @returns The stacked Skeleton rows.
 * Maps to: internal — loading states in the sections.
 */
export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
