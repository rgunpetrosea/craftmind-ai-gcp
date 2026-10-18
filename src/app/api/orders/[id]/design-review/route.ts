import type { NextRequest } from 'next/server';
import { orderHidden } from '@/lib/auth';
import { completeDesignIntent } from '@/lib/agents/direction-agent';
import { blankReview, reviewConcept, testHooksAllowed } from '@/lib/design-review';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, renderMockupAngles } from '@/lib/mockups';
import { angleDef, MOCKUP_ANGLES } from '@/lib/spec/angles';
import { missingRequired, normalizeDesignIntent, normalizeSpecifications } from '@/lib/spec/catalog';
import { conceptPresentation } from '@/lib/spec/describe';
import { MAX_CRAFTER_RENDERS_PER_ORDER } from '@/lib/spec/guardrails';
import type { MockupAngle, OrderPayload, Specifications } from '@/lib/types';
import { nowIso } from '@/lib/utils/format';
import { sendToClient } from '@/lib/whatsapp';

const mimeOf = (url: string) => (url.startsWith('data:') ? url.slice(5, url.indexOf(';')) : 'image/jpeg');

/**
 * Crafter review of a design concept (Design Intelligence Layer v2, section 12). The software assists; the maker decides.
 * Body: { action, note?, angles?, design? }
 *   APPROVE        sign off the concept; renders the critic held back are sent to the client with the concept presentation
 *                  (direction, original feature, materials, benefit, pending items, "not a manufacturing guarantee").
 *   REJECT         the concept is not shown; held renders are dropped.
 *   REGENERATE     re-render `angles` (default: the held ones, else every rendered slot) with `note` as the crafter's
 *                  change request, then score it (crafter renders are never revised automatically).
 *   RECHECK        run the design critic again on the current set.
 *   UPDATE_DESIGN  edit the design intent (`design`: design_direction, secondary_direction, originality_feature,
 *                  functional_advantage, craftsmanship_detail, reference_likes, reference_do_not_copy); no re-render.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/design-review'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'APPROVE' | 'REJECT' | 'REGENERATE' | 'RECHECK' | 'UPDATE_DESIGN' | 'SIMULATE_CRITIC';
    note?: string;
    fail_passes?: number;
    angles?: MockupAngle[];
    design?: Partial<Specifications>;
  };
  const store = getStore();
  const order = await store.getOrder(id);
  if (!order || orderHidden(request, order)) return Response.json({ error: 'Order not found' }, { status: 404 });
  const note = body.note?.trim() || undefined;
  const review = order.design_review ?? blankReview();
  const save = async (o: OrderPayload) => {
    await store.saveOrder(o);
    return Response.json({ order: o });
  };

  switch (body.action) {
    case 'APPROVE': {
      const held = review.held_angles ?? [];
      order.design_review = { ...review, crafter_status: 'APPROVED', held_angles: undefined, crafter_note: note ?? review.crafter_note, updated_at: nowIso() };
      await store.saveOrder(order);
      const renders = currentAngles(order).filter((r) => held.includes(r.angle));
      if (renders.length && order.session_state !== 'APPROVED') {
        const s = order.specifications;
        const pending = missingRequired(s, order.intake).map((t) => t.label);
        await sendToClient(order, 'CRAFTER', `${conceptPresentation(s, pending)}${note ? `\n\nCrafter's note: ${note}` : ''}`);
        for (const r of renders) {
          await sendToClient(order, 'CRAFTER', angleDef(s.category, r.angle, s.construction_type).label, { type: 'image', url: r.url, mime_type: mimeOf(r.url) });
        }
      }
      return Response.json({ order, released: renders.map((r) => r.angle) });
    }
    case 'REJECT':
      order.design_review = { ...review, crafter_status: 'REJECTED', held_angles: undefined, crafter_note: note ?? review.crafter_note, updated_at: nowIso() };
      return save(order);
    case 'UPDATE_DESIGN': {
      const merged = normalizeSpecifications({ ...order.specifications, ...normalizeDesignIntent({ ...order.specifications, ...body.design }) });
      order.specifications = completeDesignIntent(merged);
      return save(order);
    }
    case 'RECHECK': {
      const angles = currentAngles(order).map((r) => r.angle);
      if (!angles.length) return Response.json({ error: 'No renders to review yet' }, { status: 409 });
      const outcome = await reviewConcept(id, { angles, source: 'CRAFTER', force: true });
      return Response.json({ order: await store.getOrder(id), critic: outcome.report });
    }
    case 'REGENERATE': {
      const used = order.media_assets.crafter_render_count ?? 0;
      if (used >= MAX_CRAFTER_RENDERS_PER_ORDER) return Response.json({ error: `Render limit reached for this order (${MAX_CRAFTER_RENDERS_PER_ORDER}).` }, { status: 429 });
      const wanted = body.angles?.length ? body.angles : review.held_angles?.length ? review.held_angles : currentAngles(order).map((r) => r.angle);
      const angles = MOCKUP_ANGLES.filter((a) => wanted.includes(a));
      if (!angles.length) return Response.json({ error: 'Nothing to regenerate' }, { status: 409 });
      order.design_review = { ...review, crafter_status: 'CHANGES_REQUESTED', crafter_note: note ?? review.crafter_note, updated_at: nowIso() };
      order.media_assets = { ...order.media_assets, crafter_render_count: used + 1 };
      await store.saveOrder(order);
      await renderMockupAngles(id, { angles, adjustment: note });
      const outcome = await reviewConcept(id, { angles, source: 'CRAFTER', force: true });
      return Response.json({ order: await store.getOrder(id), critic: outcome.report });
    }
    case 'SIMULATE_CRITIC': {
      // QA test hook (scripts/run-scenarios.mjs): the next `fail_passes` critic passes fail, to exercise the revision loop
      if (!testHooksAllowed()) return Response.json({ error: 'Test hooks are disabled in production (set ALLOW_TEST_HOOKS=true)' }, { status: 403 });
      order.design_review = { ...review, simulate_fail_passes: Math.max(0, Math.min(5, Number(body.fail_passes) || 0)), updated_at: nowIso() };
      return save(order);
    }
    default:
      return Response.json({ error: 'action must be APPROVE, REJECT, REGENERATE, RECHECK or UPDATE_DESIGN' }, { status: 400 });
  }
}
