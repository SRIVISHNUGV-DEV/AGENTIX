'use client';

import { Agent } from '@/lib/types';
import { StatusBadge } from './status-badge';
import { ChevronRight, Bot } from 'lucide-react';
import Link from 'next/link';

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <div className="rounded-lg border border-border bg-card p-6 hover:border-accent/50 transition-colors cursor-pointer group">
        <div className="flex items-start justify-between mb-4">
          <div className="rounded-lg bg-accent/10 p-3 text-accent group-hover:bg-accent/20 transition-colors">
            <Bot className="h-6 w-6" />
          </div>
          <StatusBadge status={agent.status} />
        </div>
        
        <h3 className="text-lg font-semibold text-foreground mb-2">{agent.name}</h3>
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {agent.description}
        </p>
        
        <div className="flex items-center justify-between pt-4 border-t border-border text-sm">
          <div className="flex gap-4 text-muted-foreground">
            <span>{agent.credentials.length} credentials</span>
            <span>{agent.wallets.length} wallets</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
        </div>
      </div>
    </Link>
  );
}
