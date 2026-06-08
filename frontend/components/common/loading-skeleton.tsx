export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-6 animate-pulse ${className}`}>
      <div className="h-4 w-24 bg-muted rounded mb-3" />
      <div className="h-8 w-16 bg-muted rounded mb-2" />
      <div className="h-3 w-32 bg-muted rounded" />
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3 border-b border-border">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-lg" />
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="h-4 w-96 bg-muted rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <div className="h-96 bg-muted rounded-lg" />
    </div>
  )
}
