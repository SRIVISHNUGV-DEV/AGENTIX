'use client';

import { Agent, Event } from '@/lib/types';
import { StatusBadge } from '@/components/status-badge';
import { CredentialCard } from '@/components/credential-card';
import { WalletCard } from '@/components/wallet-card';
import { EventTimeline } from '@/components/event-timeline';
import { formatDate } from '@/lib/utils';
import { Bot, CalendarIcon, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AgentDetailProps {
  agent: Agent;
  events: Event[];
}

export function AgentDetail({ agent, events }: AgentDetailProps) {
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-card p-8">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-accent/10 p-4 text-accent">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground">{agent.name}</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">{agent.description}</p>
            </div>
          </div>
          <StatusBadge status={agent.status} />
        </div>

        <div className="mt-6 grid gap-6 border-t border-border pt-6 md:grid-cols-3">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              Created
            </p>
            <p className="font-semibold text-foreground">{formatDate(agent.createdAt)}</p>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Last Active
            </p>
            <p className="font-semibold text-foreground">{formatDate(agent.lastActive)}</p>
          </div>
          <div>
            <p className="mb-2 text-sm text-muted-foreground">Total Sessions</p>
            <p className="font-semibold text-foreground">{agent.sessions.length}</p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Credentials</h2>
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
            Credential Issued
          </Button>
        </div>
        {agent.credentials.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">No credentials configured yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agent.credentials.map((credential) => (
              <CredentialCard key={credential.id} credential={credential} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Wallets</h2>
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
            Wallet Ready
          </Button>
        </div>
        {agent.wallets.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">No wallets configured yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agent.wallets.map((wallet) => (
              <WalletCard key={wallet.id} wallet={wallet} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-8">
        <h2 className="mb-6 text-2xl font-bold text-foreground">Activity Timeline</h2>
        <EventTimeline events={events} />
      </div>
    </div>
  );
}
