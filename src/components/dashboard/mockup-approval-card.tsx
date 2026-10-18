'use client';

import { CheckCircle2, Loader2, MessageSquareQuote, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { angleDef, MOCKUP_ANGLES } from '@/lib/spec/angles';
import { describeFields } from '@/lib/spec/catalog';
import { directionFeel } from '@/lib/spec/directions';
import type { ChatMessage, MockupAngle, OrderPayload } from '@/lib/types';

/** Spec fields the crafter checks first against the render (laptop, closure, hardware finish, lining, leather...). */
const KEY_FIELDS = [
  'dimensions_cm',
  'laptop_size_inch',
  'exterior_leather',
  'color',
  'main_closure',
  'strap_type',
  'hardware',
  'lining',
  'edge_finish',
  'thread_color',
  'front_slots',
  'cash_compartments',
  'primary_material',
  'finish_coating',
  'hardware_fittings',
  'countertop',
];

/**
 * Crafter approval gate: new AI mockups never reach the client on their own. This card puts what the client asked for
 * (their words + the locked spec) next to the AI renders waiting for approval, with one "Approve & Send to Client".
 */
export function MockupApprovalCard({
  order,
  messages,
  busy,
  onApprove,
}: {
  order: OrderPayload;
  messages: ChatMessage[];
  busy: boolean;
  onApprove: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const held = order.design_review?.held_angles ?? [];
  if (!held.length || order.session_state === 'APPROVED') return null;

  const s = order.specifications;
  const renders = (order.media_assets.mockup_angles ?? []).filter((r) => held.includes(r.angle));
  const fields = describeFields(s)
    .filter((f) => KEY_FIELDS.includes(f.key))
    .sort((a, b) => KEY_FIELDS.indexOf(a.key) - KEY_FIELDS.indexOf(b.key));
  const asks = messages.filter((m) => m.sender === 'CLIENT' && m.text?.trim()).slice(-4);
  const failedCritic = order.design_review?.crafter_status === 'NEEDS_REVIEW';
  const viewLabel = (a: MockupAngle) => angleDef(s.category, a, s.construction_type).label;

  return (
    <Card className="ring-2 ring-amber-300">
      <CardHeader
        title="Client request vs AI mockup · awaiting your approval"
        icon={<ShieldCheck className="h-4 w-4 text-amber-600" />}
        action={<Badge tone={failedCritic ? 'red' : 'amber'}>{failedCritic ? 'Critic flagged · review carefully' : 'Not sent to client yet'}</Badge>}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* What the client asked for */}
        <div className="space-y-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Client request</p>
          <ul className="space-y-1.5">
            {asks.map((m) => (
              <li key={m.id} className="flex gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-700 ring-1 ring-stone-200">
                <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
                <span className="line-clamp-3">{m.text}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {s.design_direction !== 'UNSPECIFIED' && (
              <>
                <dt className="text-stone-500">Nuansa</dt>
                <dd className="font-medium text-stone-800">{directionFeel(s.design_direction)}</dd>
              </>
            )}
            {s.originality_feature && (
              <>
                <dt className="text-stone-500">Detail khas</dt>
                <dd className="text-stone-800">{s.originality_feature}</dd>
              </>
            )}
            {fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-stone-500">{f.field.label}</dt>
                <dd className="text-stone-800">{f.text}</dd>
              </div>
            ))}
            {s.custom_fields.map((f) => (
              <div key={f.id} className="contents">
                <dt className="text-stone-500">{f.label}</dt>
                <dd className="text-stone-800">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* What the AI rendered */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">AI generated mockup ({renders.length})</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MOCKUP_ANGLES.filter((a) => held.includes(a)).map((a) => {
              const r = renders.find((x) => x.angle === a);
              return (
                <figure key={a} className="overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200">
                  {r ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URLs / GCS objects
                    <img src={r.url} alt={viewLabel(a)} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-stone-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                  <figcaption className="px-2 py-1 text-[10px] text-stone-600">
                    {MOCKUP_ANGLES.indexOf(a) + 1}. {viewLabel(a)}
                    {r?.engine === 'offline-svg' && <span className="text-amber-600"> · concept sketch</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note to the client with the mockups (e.g. konstruksi sudah kami cek, siap produksi)"
            className="w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="success" disabled={busy || !renders.length} onClick={() => onApprove(note).then((ok) => ok && setNote(''))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve & Send to Client
            </Button>
            <span className="text-[11px] text-stone-500">Need changes? Use the feedback box on the mockups or &ldquo;Request changes&rdquo; in the design review below.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
