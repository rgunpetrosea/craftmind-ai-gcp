'use client';

import {
  Bot,
  CheckCircle2,
  ClipboardList,
  Hand,
  Loader2,
  MessagesSquare,
  PackageCheck,
  PackageSearch,
  PauseCircle,
  RefreshCw,
  Ruler,
  Send,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { WaText } from '@/components/simulation/wa-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { AutomationBadge, ESCALATION_LABEL, SessionStateBadge } from '@/components/ui/status-badges';
import type { QuotationBreakdown } from '@/lib/agents/pricing';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import type { AutomationMode, ChatMessage, InventoryItem, OrderPayload } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatIDR } from '@/lib/utils/format';
import { BomTable } from './bom-table';
import { SideBySidePreview } from './side-by-side-preview';

interface DetailResponse {
  order: OrderPayload;
  messages: ChatMessage[];
  breakdown: QuotationBreakdown | null;
  allocated_stock: InventoryItem | null;
}

const SPEC_LABELS: Array<[keyof OrderPayload['specifications'], string]> = [
  ['silhouette', 'Silhouette'],
  ['target_capacity', 'Capacity'],
  ['exterior_leather', 'Exterior leather'],
  ['lining_material', 'Lining'],
  ['structure_temper', 'Structure'],
  ['stitching_method', 'Stitching'],
  ['edge_finish', 'Edge finish'],
];

export function OrderDetail({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const { data, error, refresh } = usePoll<DetailResponse>(`/api/orders/${orderId}`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [quoteOverride, setQuoteOverride] = useState<{ orderId: string; value: string } | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  if (error && !data) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-stone-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const { order, messages, breakdown, allocated_stock } = data;
  const s = order.specifications;
  const bom = order.pattern_and_bom;
  const quoteValue = quoteOverride?.orderId === orderId ? quoteOverride.value : String(bom.suggested_quotation_idr || '');

  async function act(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      setFlash(success);
      await refresh();
      onChanged();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const setMode = (mode: AutomationMode, label: string) =>
    act(mode, () => postJson(`/api/orders/${orderId}/takeover`, { mode }), label);

  return (
    <div className="space-y-4">
      {/* Header + takeover controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-stone-400">{order.order_id}</p>
            <h2 className="text-lg font-semibold text-stone-900">{order.client_info.client_name_wa}</h2>
            <p className="text-xs text-stone-500">{order.client_info.phone_number}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SessionStateBadge state={order.session_state} />
              <AutomationBadge order={order} />
              {order.escalation_reason && <Badge tone="neutral">{ESCALATION_LABEL[order.escalation_reason]}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {order.automation_mode !== 'FULL_MANUAL' && (
              <Button variant="danger" size="sm" disabled={!!busy} onClick={() => setMode('FULL_MANUAL', 'You have taken over this chat')}>
                <Hand className="h-3.5 w-3.5" /> Take over
              </Button>
            )}
            {order.automation_mode === 'AI_COPILOT' && (
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setMode('PARTIAL_PAUSE', 'AI paused for 30 minutes')}>
                <PauseCircle className="h-3.5 w-3.5" /> Pause AI 30m
              </Button>
            )}
            {order.automation_mode !== 'AI_COPILOT' && (
              <Button variant="success" size="sm" disabled={!!busy} onClick={() => setMode('AI_COPILOT', 'Handed back to AI Co-Pilot')}>
                <Bot className="h-3.5 w-3.5" /> Resume AI
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!!busy || order.session_state === 'APPROVED'}
              title="Re-run all agents. During a takeover this recomputes without messaging the client."
              onClick={() => act('rerun', () => postJson('/api/ai/orchestrator', { order_id: orderId, force: true }), 'Agents re-ran')}
            >
              {busy === 'rerun' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-run agents
            </Button>
          </div>
        </div>
        {flash && <p className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">{flash}</p>}
      </Card>

      {/* Side-by-side review */}
      <Card>
        <CardHeader
          title="Sketch → AI studio mockup"
          icon={<Sparkles className="h-4 w-4 text-leather-500" />}
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy || !s.silhouette}
              onClick={() => act('mockup', () => postJson('/api/ai/mock-generator', { order_id: orderId }), 'Mockup regenerated')}
            >
              {busy === 'mockup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
            </Button>
          }
        />
        <div className="p-4">
          <SideBySidePreview sketchUrl={order.media_assets.original_sketch_url} mockupUrl={order.media_assets.ai_generated_mockup_url} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Specification */}
        <Card>
          <CardHeader title="Structured specification" icon={<ClipboardList className="h-4 w-4 text-leather-500" />} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-stone-500">Dimensions (L × W × H)</dt>
              <dd className="flex items-center gap-1.5 font-medium text-stone-800">
                <Ruler className="h-3.5 w-3.5 text-stone-400" />
                {s.dimensions_cm.length || '?'} × {s.dimensions_cm.width || '?'} × {s.dimensions_cm.height || '?'} cm
              </dd>
            </div>
            {SPEC_LABELS.map(([key, label]) => (
              <div key={key}>
                <dt className="text-[11px] uppercase tracking-wide text-stone-500">{label}</dt>
                <dd className={cn('font-medium', s[key] ? 'text-stone-800' : 'text-stone-300')}>{(s[key] as string) || 'missing'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* Sourcing */}
        <Card>
          <CardHeader title="Material sourcing" icon={<PackageSearch className="h-4 w-4 text-leather-500" />} />
          <div className="space-y-3 p-4 text-sm">
            {bom.components_breakdown.length === 0 ? (
              <p className="text-stone-500">Stock is matched once the leather and size are known.</p>
            ) : order.material_sourcing.status === 'IN_STOCK' ? (
              <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
                <PackageCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-800">In stock — allocated</p>
                  <p className="text-emerald-700">
                    {allocated_stock?.name ?? order.material_sourcing.allocated_stock_id} · {allocated_stock?.available_sqft} sqft on shelf
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                <PackageSearch className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-900">Special sourcing needed</p>
                  <p className="text-amber-800">
                    {allocated_stock
                      ? `${allocated_stock.name}: only ${allocated_stock.available_sqft} sqft left, need ${bom.estimated_leather_sqft}`
                      : `No stock matches "${s.exterior_leather}"`}
                  </p>
                  <p className="mt-1 text-amber-800">
                    +{formatIDR(order.material_sourcing.sourcing_fee_idr)} fee · +{order.material_sourcing.additional_lead_days} days lead time
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* BOM */}
      <Card>
        <CardHeader title="2D pattern components & SqFt" icon={<Ruler className="h-4 w-4 text-leather-500" />} />
        <BomTable bom={bom} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Quotation + approval */}
        <Card>
          <CardHeader title="Quotation & approval" icon={<Wallet className="h-4 w-4 text-leather-500" />} />
          <div className="space-y-3 p-4 text-sm">
            {breakdown ? (
              <dl className="space-y-1">
                {(
                  [
                    ['Leather', breakdown.leather_idr],
                    ['Hardware', breakdown.hardware_idr],
                    ['Labor', breakdown.labor_idr],
                    ['Sourcing', breakdown.sourcing_idr],
                    ['Margin', breakdown.margin_idr],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="flex justify-between text-stone-600">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{formatIDR(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold text-stone-900">
                  <dt>AI suggested</dt>
                  <dd className="tabular-nums">{formatIDR(breakdown.total_idr)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-stone-500">Quote is computed after the pattern breakdown.</p>
            )}

            {order.session_state === 'APPROVED' ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-4 w-4" /> Approved at {formatIDR(bom.suggested_quotation_idr)} — quotation sent via WhatsApp
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-stone-500">Final quote (IDR)</span>
                  <input
                    type="number"
                    value={quoteValue}
                    onChange={(e) => setQuoteOverride({ orderId, value: e.target.value })}
                    className="mt-1 w-full rounded-lg px-3 py-2 ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
                  />
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note to client (optional)"
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
                />
                <Button
                  className="w-full"
                  disabled={!!busy || !bom.components_breakdown.length}
                  onClick={() =>
                    act(
                      'approve',
                      () => postJson(`/api/orders/${orderId}/approve`, { quotation_idr: Number(quoteValue) || undefined, note }),
                      'Quotation approved and sent to client',
                    )
                  }
                >
                  {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve & send quotation
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Conversation + crafter reply */}
        <Card className="flex flex-col">
          <CardHeader title="WhatsApp conversation" icon={<MessagesSquare className="h-4 w-4 text-leather-500" />} />
          <div className="max-h-80 flex-1 space-y-2 overflow-y-auto p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs',
                  m.sender === 'CLIENT' ? 'bg-stone-100' : m.sender === 'SYSTEM' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50',
                  m.awaiting_crafter_review && 'ring-2 ring-red-300',
                )}
              >
                <p className="mb-0.5 flex items-center justify-between text-[10px] font-semibold uppercase text-stone-500">
                  <span>{m.sender}</span>
                  {m.awaiting_crafter_review && <span className="text-red-600">needs reply</span>}
                </p>
                {m.media_type && <p className="italic text-stone-500">[{m.media_type === 'image' ? 'sketch/photo' : 'voice note'}]</p>}
                {m.text && <WaText text={m.text} />}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              const text = reply;
              setReply('');
              act(
                'reply',
                () => postJson('/api/webhook/whatsapp', { phone_number: order.client_info.phone_number, order_id: orderId, sender: 'CRAFTER', text }),
                order.automation_mode === 'AI_COPILOT' ? 'Reply sent — AI auto-paused for 30 minutes' : 'Reply sent',
              );
            }}
            className="flex gap-2 border-t border-stone-100 p-3"
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply as crafter…"
              className="h-9 flex-1 rounded-lg px-3 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
            />
            <Button size="sm" className="h-9" disabled={!!busy || !reply.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
