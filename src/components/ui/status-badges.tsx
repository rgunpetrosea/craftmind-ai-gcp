import { Bot, Hand, PauseCircle } from 'lucide-react';
import type { EscalationReason, OrderPayload, SessionState } from '@/lib/types';
import { Badge, type BadgeTone } from './badge';

const STATE_LABEL: Record<SessionState, [string, BadgeTone]> = {
  IDLE: ['Idle', 'neutral'],
  REQUIREMENT_GATHERING: ['Gathering', 'blue'],
  PENDING_CRAFTER_APPROVAL: ['Pending approval', 'amber'],
  APPROVED: ['Approved', 'green'],
};

export const ESCALATION_LABEL: Record<EscalationReason, string> = {
  SESSION_LIMIT: 'AI turn budget used up',
  CLIENT_REQUEST: 'Client asked for a human',
  CONFUSION_RULE: 'Loop / unproductive chat',
  CRAFTER_OVERRIDE: 'Crafter override',
};

export function SessionStateBadge({ state }: { state: SessionState }) {
  const [label, tone] = STATE_LABEL[state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function AutomationBadge({ order }: { order: Pick<OrderPayload, 'automation_mode' | 'paused_until'> }) {
  if (order.automation_mode === 'FULL_MANUAL') {
    return (
      <Badge tone="red">
        <Hand className="h-3 w-3" /> Manual takeover
      </Badge>
    );
  }
  if (order.automation_mode === 'PARTIAL_PAUSE') {
    const until = order.paused_until ? new Date(order.paused_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return (
      <Badge tone="amber">
        <PauseCircle className="h-3 w-3" /> AI paused{until && ` until ${until}`}
      </Badge>
    );
  }
  return (
    <Badge tone="green">
      <Bot className="h-3 w-3" /> AI Co-Pilot
    </Badge>
  );
}
