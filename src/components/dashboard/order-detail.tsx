'use client';

import {
  Bot,
  Camera,
  CheckCircle2,
  Hand,
  Images,
  Loader2,
  MessagesSquare,
  PackageCheck,
  PackageSearch,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Ruler,
  Send,
  Sparkles,
  Wand2,
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
import { schemaOf } from '@/lib/spec/catalog';
import { primaryMaterial } from '@/lib/spec/describe';
import { angleDef, MOCKUP_ANGLES } from '@/lib/spec/angles';
import type { AutomationMode, ChatMessage, InventoryItem, MockupAngle, OrderPayload, Specifications } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatIDR } from '@/lib/utils/format';
import { BomTable } from './bom-table';
import { SideBySidePreview } from './side-by-side-preview';
import { SpecEditor } from './spec-editor';

interface DetailResponse {
  order: OrderPayload;
  messages: ChatMessage[];
  breakdown: QuotationBreakdown | null;
  allocated_stock: InventoryItem | null;
  rendering_angles: boolean;
}

const ENGINE_LABEL = { 'gemini-image': 'Gemini image model', imagen: 'Imagen', 'offline-svg': 'Offline concept (no AI image)' } as const;

export function OrderDetail({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const { data, error, refresh } = usePoll<DetailResponse>(`/api/orders/${orderId}`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [quoteOverride, setQuoteOverride] = useState<{ orderId: string; value: string } | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [selectedAngle, setSelectedAngle] = useState<MockupAngle>('ANGLE_1');
  const [sendAngles, setSendAngles] = useState<Set<MockupAngle> | null>(null);
  const [shotDrafts, setShotDrafts] = useState<Partial<Record<MockupAngle, string>>>({});

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

  /** Runs an action, shows `success` (or a message derived from the response) and reloads. Resolves true on success. */
  async function act<T>(key: string, fn: () => Promise<T>, success: string | ((result: T) => string)): Promise<boolean> {
    setBusy(key);
    setFlash(null);
    try {
      const result = await fn();
      setFlash(typeof success === 'function' ? success(result) : success);
      await refresh();
      onChanged();
      return true;
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const recalculate = (spec: Specifications) =>
    act('recalc', () => postJson(`/api/orders/${orderId}/recalculate`, { specifications: spec }), 'Specification saved — BOM, SqFt, labor and quotation recalculated');

  const renders = order.media_assets.mockup_angles ?? [];
  const renderOf = (angle: MockupAngle) => renders.find((r) => r.angle === angle);
  const selected = renderOf(selectedAngle);
  const rendering = data.rendering_angles;
  // angles ticked for the client; defaults to every rendered angle
  const sendSet = sendAngles ?? new Set(renders.map((r) => r.angle));

  const viewOf = (angle: MockupAngle) => angleDef(s.category, angle, s.construction_type);
  const savedPrompt = order.media_assets.angle_prompts?.[selectedAngle] ?? '';
  const shotDraft = shotDrafts[selectedAngle] ?? savedPrompt;

  const renderAngles = (angles: MockupAngle[], withFeedback: boolean, shot?: { custom?: string; clear?: boolean }) =>
    act(
      shot ? 'mockup-shot' : angles.length > 1 ? 'mockup-all' : 'mockup',
      () =>
        postJson<{ renders: Array<{ angle: MockupAngle; engine: keyof typeof ENGINE_LABEL }>; note?: string }>('/api/ai/mock-generator', {
          order_id: orderId,
          ...(angles.length === 1 ? { angle_index: MOCKUP_ANGLES.indexOf(angles[0]) + 1 } : { angles }),
          adjustment: withFeedback ? feedback : undefined,
          custom_angle_prompt: shot?.custom,
          clear_custom_prompt: shot?.clear,
        }),
      (r) =>
        r.note ??
        `${r.renders.length} angle(s) rendered with ${ENGINE_LABEL[r.renders[0]?.engine ?? 'gemini-image']}${withFeedback ? ' using your feedback' : ''}${shot?.custom ? ' using your custom shot' : shot?.clear ? ' with the default shot' : ''}`,
    ).then((ok) => {
      if (ok && withFeedback) setFeedback('');
      if (ok && shot) setShotDrafts(({ [angles[0]]: _done, ...rest }) => (void _done, rest));
    });

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
            {order.escalation_note && order.automation_mode !== 'AI_COPILOT' && (
              <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">🔔 {order.escalation_note}</p>
            )}
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

      {/* Multi-angle studio mockups + feedback */}
      <Card>
        <CardHeader
          title="Sketch → AI studio mockups"
          icon={<Sparkles className="h-4 w-4 text-leather-500" />}
          action={
            <Button
              variant="secondary"
              size="sm"
              disabled={!!busy || s.construction_type === 'UNSPECIFIED' || order.session_state === 'APPROVED'}
              onClick={() => renderAngles(MOCKUP_ANGLES, false)}
            >
              {busy === 'mockup-all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Images className="h-3.5 w-3.5" />} Render all angles
            </Button>
          }
        />
        <div className="space-y-4 p-4">
          {/* angle tabs */}
          <div role="tablist" aria-label="Mockup angles" className="flex flex-wrap gap-1.5">
            {MOCKUP_ANGLES.map((angle, i) => {
              const r = renderOf(angle);
              const active = angle === selectedAngle;
              return (
                <button
                  key={angle}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedAngle(angle)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ring-1 transition',
                    active ? 'bg-leather-700 text-white ring-leather-700' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50',
                  )}
                >
                  {rendering && !r ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className={cn('h-2 w-2 rounded-full', !r ? 'bg-stone-300' : r.engine === 'offline-svg' ? 'bg-amber-400' : 'bg-emerald-500')} />
                  )}
                  Angle {i + 1} · {viewOf(angle).label}
                  {order.media_assets.angle_prompts?.[angle] && <span className="rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-800">custom</span>}
                </button>
              );
            })}
            {selected && (
              <Badge tone={selected.engine === 'offline-svg' ? 'amber' : 'green'} className="ml-auto self-center">
                {ENGINE_LABEL[selected.engine]}
              </Badge>
            )}
          </div>

          {selected?.engine === 'offline-svg' && selected.error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <b>Why no AI render:</b> {selected.error}
            </p>
          )}
          <SideBySidePreview
            sketchUrl={order.media_assets.original_sketch_url}
            mockupUrl={selected?.url}
            mockupLabel={`Angle ${MOCKUP_ANGLES.indexOf(selectedAngle) + 1} · ${selected?.custom_prompt ? 'Custom shot' : viewOf(selectedAngle).label}`}
            mockupEmpty={
              rendering
                ? 'Rendering this angle in the background…'
                : s.construction_type === 'UNSPECIFIED'
                  ? 'Mockups appear once the spec is complete'
                  : 'Not rendered yet — use "Render this angle" below'
            }
          />

          {/* custom shot direction for this angle */}
          <div className="rounded-lg bg-sky-50/60 p-3 ring-1 ring-sky-200">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700" htmlFor="shot-override">
              <Camera className="h-3.5 w-3.5 text-sky-700" /> Custom shot direction / prompt override · Angle {MOCKUP_ANGLES.indexOf(selectedAngle) + 1}
            </label>
            <input
              id="shot-override"
              value={shotDraft}
              onChange={(e) => setShotDrafts((d) => ({ ...d, [selectedAngle]: e.target.value }))}
              disabled={order.session_state === 'APPROVED'}
              placeholder={`Default: ${viewOf(selectedAngle).shot}`}
              className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-sky-500"
            />
            <p className="mt-1 text-[11px] text-stone-500">
              The order&apos;s spec JSON (materials, colours, stitching) is always sent first; this replaces only the camera / shot. Saved for this angle
              until you reset it.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!!busy || !shotDraft.trim() || s.construction_type === 'UNSPECIFIED' || order.session_state === 'APPROVED'}
                onClick={() => renderAngles([selectedAngle], false, { custom: shotDraft })}
              >
                {busy === 'mockup-shot' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Re-render angle with custom prompt
              </Button>
              {savedPrompt && (
                <Button variant="ghost" size="sm" disabled={!!busy || order.session_state === 'APPROVED'} onClick={() => renderAngles([selectedAngle], false, { clear: true })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to default shot ({viewOf(selectedAngle).label})
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700" htmlFor="mockup-feedback">
              <Wand2 className="h-3.5 w-3.5 text-leather-500" /> Edit feedback · Angle {MOCKUP_ANGLES.indexOf(selectedAngle) + 1}
            </label>
            <textarea
              id="mockup-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              disabled={order.session_state === 'APPROVED'}
              placeholder="e.g. Change to a flat card sleeve, show the open card slots from the front view"
              className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!!busy || !feedback.trim() || s.construction_type === 'UNSPECIFIED' || order.session_state === 'APPROVED'}
                onClick={() => renderAngles([selectedAngle], true)}
              >
                {busy === 'mockup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Re-generate this angle with feedback
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy || s.construction_type === 'UNSPECIFIED' || order.session_state === 'APPROVED'}
                onClick={() => renderAngles([selectedAngle], false)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> {selected ? 'Re-render this angle' : 'Render this angle'}
              </Button>
              <span className="text-[11px] text-stone-500">Only the mockup changes; the specification, BOM and quote stay as they are.</span>
            </div>
            {selected?.feedback?.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {selected.feedback.map((f, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setFeedback(f)} title="Reuse this feedback" className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100">
                      {i + 1}. {f.length > 50 ? `${f.slice(0, 48)}…` : f}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Card>

      <SpecEditor key={order.order_id} order={order} busy={busy === 'recalc'} onRecalculate={recalculate} />

      <div className="grid gap-4 xl:grid-cols-2">
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
                      ? `${allocated_stock.name}: only ${allocated_stock.available_sqft} sqft left, need ${bom.estimated_material_sqft}`
                      : `No stock matches "${primaryMaterial(s) || 'the requested material'}"`}
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
        <CardHeader title={order.craft_category === 'FURNITURE' ? 'Cut list & board SqFt' : '2D pattern components & SqFt'} icon={<Ruler className="h-4 w-4 text-leather-500" />} />
        <BomTable bom={bom} materialLabel={schemaOf(order.craft_category).material_label} />
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
                    [schemaOf(order.craft_category).material_label, breakdown.material_idr],
                    ['Hardware', breakdown.hardware_idr],
                    ['Labor', breakdown.labor_idr],
                    ['Sourcing', breakdown.sourcing_idr],
                    ['Personalization', breakdown.personalization_idr],
                    ['Custom requests', breakdown.custom_requests_idr],
                    ['Site visit', breakdown.site_visit_idr],
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
                {order.media_assets.approved_angles?.length ? (
                  <a href={`/gallery/${order.order_id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs underline">
                    {order.media_assets.approved_angles.length} mockup angle(s) · client gallery
                  </a>
                ) : null}
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
                <fieldset>
                  <legend className="text-[11px] uppercase tracking-wide text-stone-500">Mockups to send with the quote</legend>
                  {renders.length ? (
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {MOCKUP_ANGLES.map((angle, i) => {
                        const r = renderOf(angle);
                        if (!r) return null;
                        const on = sendSet.has(angle);
                        return (
                          <label
                            key={angle}
                            className={cn('cursor-pointer overflow-hidden rounded-lg ring-2 transition', on ? 'ring-leather-600' : 'opacity-50 ring-stone-200')}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={on}
                              onChange={() => {
                                const next = new Set(sendSet);
                                if (on) next.delete(angle);
                                else next.add(angle);
                                setSendAngles(next);
                              }}
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element -- data URLs / GCS objects */}
                            <img src={r.url} alt={viewOf(angle).label} className="aspect-square w-full bg-stone-100 object-cover" />
                            <span className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-stone-700">
                              {on ? <CheckCircle2 className="h-3 w-3 text-leather-600" /> : <span className="h-3 w-3 rounded-full ring-1 ring-stone-300" />}
                              {i + 1}. {viewOf(angle).label}
                              {r.engine === 'offline-svg' && <span className="text-amber-600"> · concept</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-stone-500">No mockup rendered yet: the quote is sent as text only.</p>
                  )}
                </fieldset>
                <Button
                  className="w-full"
                  disabled={!!busy || !bom.components_breakdown.length}
                  onClick={() =>
                    act(
                      'approve',
                      () =>
                        postJson<{ sent_angles: MockupAngle[] }>(`/api/orders/${orderId}/approve`, {
                          quotation_idr: Number(quoteValue) || undefined,
                          note,
                          angles: [...sendSet],
                        }),
                      (r) => `Quotation approved and sent to client with ${r.sent_angles.length} mockup angle(s)`,
                    )
                  }
                >
                  {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve & send formal quote{sendSet.size ? ` + ${sendSet.size} mockup${sendSet.size > 1 ? 's' : ''}` : ''}
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Conversation + crafter reply */}
        <Card className="flex flex-col">
          <CardHeader title="WhatsApp conversation" icon={<MessagesSquare className="h-4 w-4 text-leather-500" />} />
          <div className="max-h-[min(750px,75vh)] min-h-48 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4">
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
