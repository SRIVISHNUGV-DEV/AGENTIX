interface SignalStripProps {
  items: string[]
}

export function SignalStrip({ items }: SignalStripProps) {
  return (
    <div className="overflow-hidden rounded-full border border-white/10 bg-white/[0.03] px-2 py-2">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-white/10 bg-background px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/58"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
