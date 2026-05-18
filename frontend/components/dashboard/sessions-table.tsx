'use client'

import { Session } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { getTxExplorerUrl } from '@/lib/explorer'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface SessionsTableProps {
  sessions: Session[]
}

export function SessionsTable({ sessions }: SessionsTableProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs font-semibold">Session ID</TableHead>
            <TableHead className="text-xs font-semibold">Agent</TableHead>
            <TableHead className="text-xs font-semibold">Status</TableHead>
            <TableHead className="text-xs font-semibold">Created</TableHead>
            <TableHead className="text-xs font-semibold">Expires</TableHead>
            <TableHead className="text-xs font-semibold">TX Hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map(session => (
            <TableRow key={session.id} className="border-border hover:bg-muted/30">
              <TableCell>
                <code className="text-xs font-mono text-muted-foreground">
                  {truncateAddress(session.id, 6)}
                </code>
              </TableCell>
              <TableCell className="text-sm text-foreground">{session.agentId}</TableCell>
              <TableCell>
                <StatusBadge status={session.status} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(session.createdAt)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(session.expiresAt)}
              </TableCell>
              <TableCell>
                <a
                  href={getTxExplorerUrl(session.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-muted-foreground underline decoration-white/20 underline-offset-4 hover:text-foreground"
                >
                  {truncateAddress(session.txHash)}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
