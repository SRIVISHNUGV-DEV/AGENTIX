import { cn } from '@/lib/utils'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Fingerprint,
  Loader2,
  Lock,
  RotateCcw,
  Shield,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react'

interface StatusBadgeProps {
  status:
    | 'active'
    | 'inactive'
    | 'pending'
    | 'expired'
    | 'revoked'
    | 'completed'
    | 'failed'
    | 'locked'
    | 'session_created'
    | 'session_expired'
    | 'credential_issued'
    | 'credential_revoked'
    | 'wallet_added'
    | 'transaction_signed'
    | 'zk_verified'
    | 'unknown'
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  className?: string
}

const statusConfig: Record<
  string,
  {
    bg: string
    text: string
    border: string
    label: string
    icon: React.ReactNode
    animate?: boolean
  }
> = {
  active: {
    bg: 'bg-emerald-500/[0.08]',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    label: 'Active',
    icon: <div className='mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400' />,
  },
  inactive: {
    bg: 'bg-white/[0.03]',
    text: 'text-foreground/50',
    border: 'border-white/10',
    label: 'Inactive',
    icon: <Circle className='mr-1.5 h-3 w-3 opacity-60' />,
  },
  pending: {
    bg: 'bg-amber-500/[0.08]',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    label: 'Pending',
    icon: <Clock className='mr-1.5 h-3 w-3' />,
  },
  expired: {
    bg: 'bg-red-500/[0.08]',
    text: 'text-red-400',
    border: 'border-red-500/20',
    label: 'Expired',
    icon: <XCircle className='mr-1.5 h-3 w-3' />,
  },
  revoked: {
    bg: 'bg-red-500/[0.08]',
    text: 'text-red-400',
    border: 'border-red-500/20',
    label: 'Revoked',
    icon: <Shield className='mr-1.5 h-3 w-3' />,
  },
  completed: {
    bg: 'bg-emerald-500/[0.08]',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    label: 'Completed',
    icon: <CheckCircle2 className='mr-1.5 h-3 w-3' />,
  },
  failed: {
    bg: 'bg-red-500/[0.08]',
    text: 'text-red-400',
    border: 'border-red-500/20',
    label: 'Failed',
    icon: <AlertCircle className='mr-1.5 h-3 w-3' />,
  },
  locked: {
    bg: 'bg-white/[0.03]',
    text: 'text-foreground/50',
    border: 'border-white/10',
    label: 'Locked',
    icon: <Lock className='mr-1.5 h-3 w-3 opacity-60' />,
  },
  session_created: {
    bg: 'bg-blue-500/[0.08]',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    label: 'Session Created',
    icon: <RotateCcw className='mr-1.5 h-3 w-3' />,
  },
  session_expired: {
    bg: 'bg-white/[0.03]',
    text: 'text-foreground/50',
    border: 'border-white/10',
    label: 'Session Expired',
    icon: <Clock className='mr-1.5 h-3 w-3 opacity-60' />,
  },
  credential_issued: {
    bg: 'bg-emerald-500/[0.08]',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    label: 'Credential Issued',
    icon: <Fingerprint className='mr-1.5 h-3 w-3' />,
  },
  credential_revoked: {
    bg: 'bg-red-500/[0.08]',
    text: 'text-red-400',
    border: 'border-red-500/20',
    label: 'Credential Revoked',
    icon: <Shield className='mr-1.5 h-3 w-3' />,
  },
  wallet_added: {
    bg: 'bg-purple-500/[0.08]',
    text: 'text-purple-400',
    border: 'border-purple-500/20',
    label: 'Wallet Added',
    icon: <Wallet className='mr-1.5 h-3 w-3' />,
  },
  transaction_signed: {
    bg: 'bg-cyan-500/[0.08]',
    text: 'text-cyan-400',
    border: 'border-cyan-500/20',
    label: 'Transaction Signed',
    icon: <CheckCircle2 className='mr-1.5 h-3 w-3' />,
  },
  zk_verified: {
    bg: 'bg-white/[0.08]',
    text: 'text-white',
    border: 'border-white/20',
    label: 'ZK Verified',
    icon: <ShieldCheck className='mr-1.5 h-3 w-3' />,
    animate: true,
  },
  unknown: {
    bg: 'bg-white/[0.03]',
    text: 'text-foreground/50',
    border: 'border-white/10',
    label: 'Unknown',
    icon: <AlertCircle className='mr-1.5 h-3 w-3 opacity-60' />,
  },
}

export function StatusBadge({
  status,
  size = 'md',
  showIcon = true,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.unknown

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium transition-all duration-150',
        sizeClasses[size],
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {showIcon && config.icon}
      {config.label}
    </span>
  )
}

// Specialized ZK verification badge with animation
export function ZKVerifiedBadge({
  size = 'md',
  className,
}: Omit<StatusBadgeProps, 'status'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-white/20 bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white transition-all duration-150',
        className
      )}
    >
      <ShieldCheck className='mr-1.5 h-3.5 w-3.5' />
      <span>ZK Verified</span>
      <span className='ml-1.5 flex h-1.5 w-1.5 items-center justify-center'>
        <span className='absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-white opacity-75' />
        <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-white' />
      </span>
    </span>
  )
}

// Loading state badge
export function LoadingBadge({
  label = 'Processing',
  size = 'md',
  className,
}: {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] font-medium text-foreground/70',
        sizeClasses[size],
        className
      )}
    >
      <Loader2 className='mr-1.5 h-3 w-3 animate-spin' />
      {label}
    </span>
  )
}

// Connection status badge
export function ConnectionStatusBadge({
  isConnected,
  isCorrectNetwork,
  networkName,
}: {
  isConnected: boolean
  isCorrectNetwork?: boolean
  networkName?: string
}) {
  if (!isConnected) {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground/50'>
        <div className='h-1.5 w-1.5 rounded-full bg-foreground/30' />
        Wallet disconnected
      </span>
    )
  }

  if (isCorrectNetwork === false) {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-1 text-xs text-amber-400'>
        <AlertCircle className='h-3 w-3' />
        Wrong network
      </span>
    )
  }

  return (
    <span className='inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-xs text-emerald-400'>
      <div className='h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse' />
      {networkName || 'Connected'}
    </span>
  )
}
