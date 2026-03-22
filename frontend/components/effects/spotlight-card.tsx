'use client'

import { ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

interface SpotlightCardProps {
  children: ReactNode
  className?: string
}

export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const [position, setPosition] = useState({ x: '50%', y: '50%' })

  return (
    <div
      className={cn('spotlight-card group relative overflow-hidden rounded-[1.75rem]', className)}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPosition({
          x: `${event.clientX - rect.left}px`,
          y: `${event.clientY - rect.top}px`,
        })
      }}
      style={
        {
          '--spotlight-x': position.x,
          '--spotlight-y': position.y,
        } as React.CSSProperties
      }
    >
      <div className="spotlight-surface absolute inset-0" />
      <div className="spotlight-border absolute inset-px rounded-[calc(1.75rem-1px)]" />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}
