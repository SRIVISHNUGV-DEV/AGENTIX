import { cn } from '@/lib/utils'

interface GridBackdropProps {
  className?: string
}

export function GridBackdrop({ className }: GridBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(106,227,255,0.18),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(255,186,106,0.14),transparent_28%),radial-gradient(circle_at_50%_80%,rgba(114,255,184,0.12),transparent_28%)]" />
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute inset-x-0 top-[-20%] h-[28rem] rounded-full bg-[radial-gradient(circle,rgba(20,167,191,0.2),transparent_65%)] blur-3xl" />
      <div className="absolute bottom-[-12rem] right-[-8rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(255,177,107,0.16),transparent_65%)] blur-3xl" />
    </div>
  )
}
