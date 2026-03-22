'use client'

import { cn } from '@/lib/utils'

interface SplitRevealProps {
  text: string
  className?: string
  delayStepMs?: number
}

export function SplitReveal({
  text,
  className,
  delayStepMs = 28,
}: SplitRevealProps) {
  return (
    <span className={cn('inline-block', className)} aria-label={text}>
      {text.split(' ').map((word, wordIndex) => (
        <span key={`${word}-${wordIndex}`} className="mr-[0.32em] inline-block whitespace-nowrap">
          {word.split('').map((char, charIndex) => {
            const delay = (wordIndex * 5 + charIndex) * delayStepMs
            return (
              <span
                key={`${word}-${char}-${charIndex}`}
                className="split-char inline-block"
                style={{ animationDelay: `${delay}ms` }}
              >
                {char}
              </span>
            )
          })}
        </span>
      ))}
    </span>
  )
}
