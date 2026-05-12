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
        'flex flex-col gap-4 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl',
        'hover:border-white/20 transition-colors',
        'shadow-[0_24px_80px_rgba(0,0,0,0.16)]',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-[0.24em]">{label}</span>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white text-background">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-3xl font-semibold tracking-tight text-foreground">{value}</span>
        {trend && (
          <span className={cn(
            'rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold',
            trend.isPositive ? 'text-foreground' : 'text-foreground/50'
          )}>
            {trend.isPositive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
    </div>
  )
}
