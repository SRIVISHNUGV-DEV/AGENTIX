import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value, icon, change, trend }: StatCardProps) {
  const trendColor = {
    up: 'text-green-400',
    down: 'text-red-400',
    neutral: 'text-gray-400',
  }[trend || 'neutral'];

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
          {change && (
            <p className={`mt-2 text-sm font-medium ${trendColor}`}>{change}</p>
          )}
        </div>
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
