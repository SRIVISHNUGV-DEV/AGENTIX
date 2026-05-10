interface StackMetric {
  label: string
  value: string | number
  detail?: string
}

interface StackMetricsProps {
  items: StackMetric[]
}

export function StackMetrics({ items }: StackMetricsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="metric-tile">
          <div className="micro-label">{item.label}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{item.value}</div>
          {item.detail ? <div className="mt-2 text-sm text-foreground/55">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  )
}
