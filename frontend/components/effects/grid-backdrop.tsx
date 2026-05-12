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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(255,255,255,0.12),transparent_18%),radial-gradient(circle_at_85%_22%,rgba(255,255,255,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:52px_52px]" />
      <div className="absolute inset-x-[-20%] top-[-14rem] h-[30rem] rounded-full border border-white/10 opacity-40 blur-3xl" />
      <div className="absolute right-[-10rem] top-24 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.08),transparent_62%)] blur-3xl" />
      <div className="absolute bottom-[-16rem] left-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.06),transparent_65%)] blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </div>
  )
}
