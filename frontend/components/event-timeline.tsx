'use client';

import { Event } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { CheckCircle2, Clock3, Lock, Wallet2 } from 'lucide-react';

interface EventTimelineProps {
  events: Event[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const getEventIcon = (type: Event['type']) => {
    switch (type) {
      case 'credential_issued':
      case 'credential_revoked':
        return <Lock className="h-4 w-4" />;
      case 'session_created':
      case 'session_expired':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'wallet_added':
        return <Wallet2 className="h-4 w-4" />;
      case 'transaction_signed':
        return <Clock3 className="h-4 w-4" />;
      default:
        return <CheckCircle2 className="h-4 w-4" />;
    }
  };

  const getEventColor = (type: Event['type']) => {
    switch (type) {
      case 'credential_issued':
        return 'bg-blue-500/10 text-blue-400';
      case 'session_created':
        return 'bg-green-500/10 text-green-400';
      case 'wallet_added':
        return 'bg-cyan-500/10 text-cyan-400';
      case 'transaction_signed':
        return 'bg-purple-500/10 text-purple-400';
      case 'credential_revoked':
      case 'session_expired':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-gray-500/10 text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      {events.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No events yet</p>
        </div>
      ) : (
        events.map((event, index) => (
          <div key={event.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`rounded-full p-2 ${getEventColor(event.type)}`}>
                {getEventIcon(event.type)}
              </div>
              {index < events.length - 1 && (
                <div className="mt-2 h-8 w-0.5 bg-border" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-foreground">{event.description}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDate(event.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
