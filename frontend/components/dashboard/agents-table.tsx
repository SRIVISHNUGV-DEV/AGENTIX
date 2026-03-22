'use client'

import { Agent } from '@/lib/types'
import { StatusBadge } from '@/components/common/status-badge'
import { truncateAddress, formatDate } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

interface AgentsTableProps {
  agents: Agent[]
}

export function AgentsTable({ agents }: AgentsTableProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-background">
      <Table>
        <TableHeader>
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
              Agent
            </TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
              Status
            </TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
              Public Key
            </TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
              Created
            </TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/45">
              Action
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id} className="border-white/10 hover:bg-white/[0.03]">
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{agent.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {agent.credentials.length} credentials · {agent.wallets.length} wallets
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={agent.status} />
              </TableCell>
              <TableCell>
                <code className="text-xs font-mono text-muted-foreground">
                  {truncateAddress(agent.publicKey)}
                </code>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(agent.createdAt)}
              </TableCell>
              <TableCell>
                <Link href={`/agents/${agent.id}`}>
                  <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0 hover:bg-white/8">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
