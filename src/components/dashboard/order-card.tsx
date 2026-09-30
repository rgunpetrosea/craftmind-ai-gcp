import { MessageSquareWarning } from 'lucide-react';
import { AutomationBadge, SessionStateBadge } from '@/components/ui/status-badges';
import type { OrderPayload } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatIDR } from '@/lib/utils/format';

export interface OrderRow {
  order: OrderPayload;
  message_count: number;
  awaiting_review_count: number;
  last_message: { sender: string; text: string; created_at: string } | null;
}

const CATEGORY_LABEL: Record<OrderPayload['craft_category'], string> = {
  bespoke_bag: 'Bag',
  bespoke_wallet: 'Wallet',
  bespoke_shoes: 'Shoes',
};

export function OrderCard({ row, selected, onSelect }: { row: OrderRow; selected: boolean; onSelect: () => void }) {
  const { order } = row;
  const quote = order.pattern_and_bom.suggested_quotation_idr;
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl bg-white p-3 text-left ring-1 transition hover:ring-leather-400',
        selected ? 'ring-2 ring-leather-600' : 'ring-stone-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">{order.client_info.client_name_wa}</p>
          <p className="truncate text-[11px] text-stone-500">
            {CATEGORY_LABEL[order.craft_category]} · {order.specifications.silhouette || 'spec in progress'}
          </p>
        </div>
        {quote > 0 && <p className="shrink-0 text-xs font-semibold text-leather-700">{formatIDR(quote)}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SessionStateBadge state={order.session_state} />
        <AutomationBadge order={order} />
        {row.awaiting_review_count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
            <MessageSquareWarning className="h-3 w-3" /> {row.awaiting_review_count}
          </span>
        )}
      </div>
      {row.last_message && (
        <p className="mt-2 line-clamp-1 text-[11px] text-stone-500">
          <span className="font-medium">{row.last_message.sender.toLowerCase()}:</span> {row.last_message.text}
        </p>
      )}
    </button>
  );
}
