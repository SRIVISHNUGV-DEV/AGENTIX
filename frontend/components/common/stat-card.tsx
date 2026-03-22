'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
}

export function StatCard({ label, value, icon, trend, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border/30 bg-foreground/2 p-6',
        'hover:border-foreground/20 transition-colors',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">{label}</span>
        {icon && <div className="text-foreground/40">{icon}</div>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-3xl font-bold text-foreground">{value}</span>
        {trend && (
          <span className={cn(
            'text-xs font-semibold',
            trend.isPositive ? 'text-foreground' : 'text-foreground/50'
          )}>
            {trend.isPositive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
    </div>
  )
}
