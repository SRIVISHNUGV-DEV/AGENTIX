interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'pending' | 'expired' | 'revoked' | 'completed' | 'failed' | 'locked' | 'session_created' | 'session_expired' | 'credential_issued' | 'credential_revoked' | 'wallet_added' | 'transaction_signed' | 'unknown';
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  
  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Active' },
    inactive: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Inactive' },
    pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Pending' },
    expired: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Expired' },
    revoked: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Revoked' },
    completed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Completed' },
    failed: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failed' },
    locked: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Locked' },
    session_created: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Session Created' },
    session_expired: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Session Expired' },
    credential_issued: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Credential Issued' },
    credential_revoked: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Credential Revoked' },
    wallet_added: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Wallet Added' },
    transaction_signed: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', label: 'Transaction Signed' },
    unknown: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Unknown' },
  };

  const config = statusConfig[status] ?? statusConfig.unknown;

  return (
    <span className={`${sizeClass} ${config.bg} ${config.text} rounded font-medium`}>
      {config.label}
    </span>
  );
}
