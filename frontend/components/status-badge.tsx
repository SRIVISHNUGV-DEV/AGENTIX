interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'pending' | 'expired' | 'revoked' | 'completed' | 'failed' | 'locked';
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  
  const statusConfig = {
    active: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Active' },
    inactive: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Inactive' },
    pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Pending' },
    expired: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Expired' },
    revoked: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Revoked' },
    completed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Completed' },
    failed: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failed' },
    locked: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Locked' },
  };

  const config = statusConfig[status];

  return (
    <span className={`${sizeClass} ${config.bg} ${config.text} rounded font-medium`}>
      {config.label}
    </span>
  );
}
