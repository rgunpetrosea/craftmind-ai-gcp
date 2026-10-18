'use client';

import { AlertTriangle, CheckCircle2, Compass, Loader2, RefreshCw, ScanEye, ShieldAlert, Wand2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { designRiskFlags, directionCards, type DirectionRecommendation } from '@/lib/agents/direction-agent';
import { MOCKUP_ANGLES } from '@/lib/spec/angles';
import { CRITIC_CRITERIA, CRITIC_THRESHOLD, criterionLabel, MAX_CRITIC_REVISIONS } from '@/lib/spec/critic-criteria';
import { DIRECTIONS, isDirectionSet } from '@/lib/spec/directions';
import type { CrafterDesignStatus, DesignDirection, OrderPayload, Specifications } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

export type DesignReviewAction = 'APPROVE' | 'REJECT' | 'REGENERATE' | 'RECHECK' | 'UPDATE_DESIGN';

const STATUS: Record<CrafterDesignStatus, { label: string; tone: BadgeTone }> = {
  NOT_REVIEWED: { label: 'Not reviewed yet', tone: 'neutral' },
  PENDING_REVIEW: { label: 'Critic approved · awaiting crafter', tone: 'blue' },
  PENDING_CRAFTER_APPROVAL: { label: 'Mockup awaiting your approval', tone: 'amber' },
  NEEDS_REVIEW: { label: 'Needs crafter review', tone: 'red' },
  APPROVED: { label: 'Approved by crafter', tone: 'green' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'amber' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};

type DesignDraft = Pick<Specifications, 'design_direction' | 'secondary_direction' | 'originality_feature' | 'functional_advantage' | 'craftsmanship_detail'> & {
  reference_likes: string;
  reference_do_not_copy: string;
};

const draftOf = (s: Specifications): DesignDraft => ({
  design_direction: s.design_direction,
  secondary_direction: s.secondary_direction,
  originality_feature: s.originality_feature,
  functional_advantage: s.functional_advantage,
  craftsmanship_detail: s.craftsmanship_detail,
  reference_likes: s.reference_likes.join('\n'),
  reference_do_not_copy: s.reference_do_not_copy.join('\n'),
});

const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Design Intelligence Layer v2 on the review screen: the concept's design intent (direction, original feature, anti-copying
 * split), the direction cards the client was offered, risk flags, the design critic's scores and revision loop, and the
 * crafter's sign-off (approve & release held renders, request changes, reject, re-run the critic).
 */
export function DesignReviewPanel({
  order,
  busy,
  onAction,
}: {
  order: OrderPayload;
  busy: string | null;
  onAction: (action: DesignReviewAction, payload?: Record<string, unknown>) => Promise<boolean>;
}) {
  const s = order.specifications;
  const review = order.design_review;
  const report = review?.history.at(-1);
  const status = STATUS[review?.crafter_status ?? 'NOT_REVIEWED'];
  const [draft, setDraft] = useState<DesignDraft>(() => draftOf(s));
  const [note, setNote] = useState('');
  const proposed = (order.intake?.proposed_directions ?? []).filter(isDirectionSet);
  const cards = directionCards(s, proposed.map((id) => ({ id, reason: '' }) as DirectionRecommendation));
  const flags = designRiskFlags(s);
  const held = review?.held_angles ?? [];
  const hasRenders = (order.media_assets.mockup_angles ?? []).length > 0;
  const locked = order.session_state === 'APPROVED';
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(s));

  const field = (key: keyof DesignDraft, label: string, placeholder: string, multiline = false) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
      {multiline ? (
        <textarea
          rows={2}
          value={draft[key]}
          placeholder={placeholder}
          disabled={locked}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
        />
      ) : (
        <input
          value={draft[key]}
          placeholder={placeholder}
          disabled={locked}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
        />
      )}
    </label>
  );

  const directionSelect = (key: 'design_direction' | 'secondary_direction', label: string) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
      <select
        value={draft[key]}
        disabled={locked}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value as DesignDirection }))}
        className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
      >
        <option value="UNSPECIFIED">{key === 'design_direction' ? 'Not chosen yet' : 'None'}</option>
        {DIRECTIONS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.feel}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card>
      <CardHeader
        title="Design intelligence · concept review"
        icon={<Compass className="h-4 w-4 text-leather-500" />}
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <div className="space-y-4 p-4 text-sm">
        {held.length > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {held.length} render(s) ({held.map((a) => `Angle ${MOCKUP_ANGLES.indexOf(a) + 1}`).join(', ')}) are waiting for your approval
            {review?.crafter_status === 'NEEDS_REVIEW' ? ` and failed the design critic after ${review?.revision_number ?? 0} automatic revision(s)` : ''}. The client has not
            seen them yet: approve to send them with the concept presentation, or request changes.
          </p>
        )}

        {/* Design intent */}
        <div className="grid gap-3 md:grid-cols-2">
          {directionSelect('design_direction', 'Design direction (proposition)')}
          {directionSelect('secondary_direction', 'Blended with')}
          {field('originality_feature', 'Original feature', 'The one recognizable but original visual feature')}
          {field('functional_advantage', 'Functional advantage', 'The one useful functional advantage')}
          {field('craftsmanship_detail', 'Craftsmanship detail', 'The one visible craftsmanship opportunity')}
          <div />
          {field('reference_likes', 'Reference: what the client likes', 'One per line: mood, quality, utility…', true)}
          {field('reference_do_not_copy', 'Reference: must NOT be copied', 'One per line: signature silhouette, closure, logo…', true)}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy || !dirty || locked}
          onClick={() =>
            onAction('UPDATE_DESIGN', {
              design: { ...draft, reference_likes: lines(draft.reference_likes), reference_do_not_copy: lines(draft.reference_do_not_copy) },
            })
          }
        >
          {busy === 'design-UPDATE_DESIGN' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save design intent
        </Button>

        {cards.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Directions proposed to the client</p>
            <div className="mt-1.5 grid gap-2 md:grid-cols-3">
              {cards.map((c, i) => (
                <div
                  key={c.id}
                  className={cn('rounded-lg p-2.5 text-xs ring-1', c.id === s.design_direction ? 'bg-leather-50 ring-leather-400' : 'bg-white ring-stone-200')}
                >
                  <p className="font-semibold text-stone-900">
                    {i + 1}. {c.feel} {c.id === s.design_direction && <span className="text-leather-700">· chosen</span>}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">{c.name}</p>
                  <p className="mt-0.5 text-stone-600">
                    {c.personality}; {c.use_fit}
                  </p>
                  <p className="mt-1 text-stone-500">
                    <b>Shape & material:</b> {c.silhouette_material_logic}
                  </p>
                  <p className="mt-1 text-stone-500">
                    <b>Original:</b> {c.original_feature}
                  </p>
                  <p className="text-stone-500">
                    <b>Benefit:</b> {c.practical_benefit}. <b>Trade-off:</b> {c.trade_off}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {flags.length > 0 && (
          <ul className="space-y-1">
            {flags.map((f) => (
              <li key={f} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
        )}

        {/* Design critic */}
        <div className="rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
          <div className="flex flex-wrap items-center gap-2">
            <ScanEye className="h-4 w-4 text-leather-600" />
            <span className="text-xs font-semibold text-stone-800">Design critic</span>
            {report ? (
              <>
                <Badge tone={report.decision === 'APPROVE' ? 'green' : report.decision === 'REVISE' ? 'amber' : 'red'}>{report.decision.replaceAll('_', ' ')}</Badge>
                <Badge tone={report.mode === 'ai' ? 'blue' : 'neutral'} title={report.mode === 'ai' ? 'A vision model reviewed the renders' : 'No AI image review available: spec-level check only'}>
                  {report.mode === 'ai' ? 'Vision review' : 'Spec-level check (images not evaluated)'}
                </Badge>
                <span className="text-[11px] text-stone-500">
                  Automatic revisions {review?.revision_number ?? 0}/{MAX_CRITIC_REVISIONS} · threshold {CRITIC_THRESHOLD}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-stone-500">Runs automatically after every mockup render, before the client sees it.</span>
            )}
          </div>

          {report && (
            <>
              <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {CRITIC_CRITERIA.map((c) => {
                  const v = report.critic_scores[c.key];
                  const fail = c.gated && v < CRITIC_THRESHOLD;
                  return (
                    <div key={c.key}>
                      <div className="flex justify-between text-[11px]">
                        <span className={cn('text-stone-600', c.gated && 'font-medium')}>
                          {c.label}
                          {c.gated && <span className="text-stone-400"> · gated</span>}
                        </span>
                        <span className={cn('tabular-nums', fail ? 'font-semibold text-red-700' : 'text-stone-800')}>{v}</span>
                      </div>
                      <div className="relative mt-0.5 h-1.5 rounded-full bg-stone-200">
                        <div className={cn('h-1.5 rounded-full', fail ? 'bg-red-500' : v >= CRITIC_THRESHOLD ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${v}%` }} />
                        <div className="absolute top-[-2px] h-2.5 w-px bg-stone-500" style={{ left: `${CRITIC_THRESHOLD}%` }} aria-hidden />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                {report.strengths.length > 0 && (
                  <div>
                    <p className="font-semibold text-emerald-800">Strongest qualities</p>
                    <ul className="mt-0.5 list-disc pl-4 text-stone-700">
                      {report.strengths.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.weaknesses.length > 0 && (
                  <div>
                    <p className="font-semibold text-red-800">Weaknesses</p>
                    <ul className="mt-0.5 list-disc pl-4 text-stone-700">
                      {report.weaknesses.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {report.improvement_instructions && (
                <p className="mt-2 text-xs text-stone-700">
                  <b>Improvement instructions:</b> {report.improvement_instructions}
                </p>
              )}
              {report.failed.length > 0 && (
                <p className="mt-1 text-[11px] text-red-700">Below threshold: {report.failed.map(criterionLabel).join(', ')}</p>
              )}
              {(review?.history.length ?? 0) > 1 && (
                <p className="mt-2 text-[11px] text-stone-500">
                  Passes:{' '}
                  {review!.history.map((h, i) => (
                    <span key={h.created_at + i} className="mr-2">
                      #{i + 1} {h.decision === 'APPROVE' ? '✓' : '✗'} (rev {h.revision_number}, min gated{' '}
                      {Math.min(...CRITIC_CRITERIA.filter((c) => c.gated).map((c) => h.critic_scores[c.key]))})
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>

        {/* Crafter sign-off */}
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={locked}
            placeholder="Crafter note / change request (e.g. reduce the flap curve, swap to a single brass turn-lock, keep the gusset at 12 cm)"
            className="w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="success" disabled={!!busy || locked || !hasRenders} onClick={() => onAction('APPROVE', { note })}>
              {busy === 'design-APPROVE' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {held.length ? `Approve & release ${held.length} held render(s)` : 'Approve concept'}
            </Button>
            <Button
              size="sm"
              disabled={!!busy || locked || !hasRenders || !note.trim()}
              onClick={() => onAction('REGENERATE', { note }).then((ok) => ok && setNote(''))}
              title="Re-render the held (or all) angles with your note, then score them"
            >
              {busy === 'design-REGENERATE' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Request changes & regenerate
            </Button>
            <Button size="sm" variant="secondary" disabled={!!busy || !hasRenders} onClick={() => onAction('RECHECK')}>
              {busy === 'design-RECHECK' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-run critic
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy || locked || !hasRenders} onClick={() => onAction('REJECT', { note })}>
              <XCircle className="h-3.5 w-3.5" /> Reject concept
            </Button>
          </div>
          <p className="text-[11px] text-stone-500">
            The software assists; you remain accountable for feasibility, dimensions, materials, construction, hardware, production method, lead time and cost.
          </p>
        </div>
      </div>
    </Card>
  );
}
