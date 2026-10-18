import { isDesignCriticEnabled, runDesignCritic, scoreBreakdown } from '@/lib/agents/critic-agent';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, finalSpecOf, renderMockupAngles } from '@/lib/mockups';
import { MOCKUP_ANGLES } from '@/lib/spec/angles';
import { criterionLabel, failedCriteria, MAX_CRITIC_REVISIONS } from '@/lib/spec/critic-criteria';
import type { CrafterDesignStatus, CriticReport, DesignReview, MockupAngle, MockupRender, OrderPayload } from '@/lib/types';
import { nowIso } from '@/lib/utils/format';
import { notifyCrafter } from '@/lib/whatsapp';

/**
 * Automatic improvement loop (Design Intelligence Layer v2, section 11), run after every concept render and BEFORE the
 * client sees it:
 *   1. the Design Critic scores the whole current set (view consistency needs every view);
 *   2. a gated criterion below the threshold → only the views it names (among the ones just rendered) are regenerated with
 *      its improvement instructions, every customer requirement preserved, and the critic runs again;
 *   3. at most MAX_CRITIC_REVISIONS cycles; still failing → the new renders are HELD from the client and the crafter gets
 *      the scores and unresolved issues (dashboard + notification). Never hides uncertainty.
 * A heuristic (offline) critique never re-renders and never holds: it only flags the concept for the crafter.
 */

/** Cost guardrail: critic passes per order (each AI pass is one vision call). */
export const MAX_CRITIC_PASSES_PER_ORDER = Number(process.env.MAX_CRITIC_PASSES_PER_ORDER ?? 24);
const HISTORY_KEPT = 10;
/** Originality / Visual Identity below this → the revision redesigns from scratch; above it the render is edited. */
const FRESH_BELOW = Number(process.env.CRITIC_FRESH_BELOW ?? 60);
/** A revision scoring below this share of the best pass so far stops the loop (diverging). */
const DIVERGING_RATIO = 0.92;

export type ReviewSource = 'CLIENT' | 'BACKGROUND' | 'CRAFTER';

export interface ReviewOutcome {
  /** Show the new renders to the client. */
  approved: boolean;
  /** The renders were withheld (critic failed after the automatic revisions). */
  held: boolean;
  /** The critic failed, but the client asked for a picture: the best pass is released, labelled as a draft. */
  draft: boolean;
  report?: CriticReport;
  revisions: number;
  /** The set after any revisions (by slot). */
  renders: MockupRender[];
}

export const blankReview = (): DesignReview => ({ revision_number: 0, crafter_status: 'NOT_REVIEWED', history: [] });

async function saveReview(orderId: string, patch: (r: DesignReview, order: OrderPayload) => Partial<DesignReview>): Promise<OrderPayload | null> {
  const store = getStore();
  const latest = await store.getOrder(orderId);
  if (!latest) return null;
  const current = latest.design_review ?? blankReview();
  latest.design_review = { ...current, ...patch(current, latest), updated_at: nowIso() };
  await store.saveOrder(latest);
  return latest;
}

/**
 * Crafter approval staging: these renders wait on the dashboard for "Approve & Send to Client" (they never reach the
 * client on their own). NEEDS_REVIEW when the design critic also failed them, else PENDING_CRAFTER_APPROVAL.
 */
export async function stageForApproval(orderId: string, angles: MockupAngle[], status: Extract<CrafterDesignStatus, 'PENDING_CRAFTER_APPROVAL' | 'NEEDS_REVIEW'>) {
  return saveReview(orderId, (r) => ({ crafter_status: status, held_angles: [...new Set([...(r.held_angles ?? []), ...angles])], draft_released_angles: undefined }));
}

/** Audit log of every pass (Firestore `critic_reviews`); never blocks the review if the write fails. */
async function logPass(order: OrderPayload, report: CriticReport, source: ReviewSource): Promise<void> {
  try {
    await getStore().appendCriticReview({
      ...report,
      review_id: `${order.order_id}__${report.created_at.replace(/[^0-9TZ]/g, '')}__${report.revision_number}`,
      order_id: order.order_id,
      crafter_id: order.crafter_id,
      craft_category: order.craft_category,
      craft_family: order.craft_family,
      source,
    });
  } catch (err) {
    console.warn(`[design-review] could not log the critic pass for ${order.order_id}:`, err);
  }
}

function recordPass(report: CriticReport, revisions: number) {
  return (r: DesignReview): Partial<DesignReview> => ({
    critic_scores: report.critic_scores,
    decision: report.decision,
    revision_number: revisions,
    history: [...r.history, report].slice(-HISTORY_KEPT),
    critic_pass_count: (r.critic_pass_count ?? 0) + 1,
  });
}

/** QA test hooks (SIMULATE_CRITIC) are allowed outside production, or when ALLOW_TEST_HOOKS=true. */
export const testHooksAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_TEST_HOOKS === 'true';

/**
 * QA hook: turns a pass into a failing one (Originality 72, View Consistency 74), so the scenario runner can exercise the
 * revision loop and the hold / escalation path without a vision model.
 */
function simulatedFailure(report: CriticReport, angles: MockupAngle[], revisions: number): CriticReport {
  const critic_scores = { ...report.critic_scores, originality: 72, view_consistency: 74 };
  const failed = failedCriteria(critic_scores);
  return {
    ...report,
    critic_scores,
    failed,
    weaknesses: ['Simulated critic failure (QA test hook): original feature not distinctive enough', 'Simulated: views drift in hardware placement', ...report.weaknesses],
    improvement_instructions: 'Make the original feature clearly visible and keep hardware, proportions and stitching identical across views.',
    render_positive: ['original feature clearly visible on the front', 'identical hardware placement in every view'],
    render_negative: ['hardware that changes position between views'],
    views_to_revise: angles,
    decision: revisions < MAX_CRITIC_REVISIONS ? 'REVISE' : 'ESCALATE_TO_CRAFTER',
    simulated: true,
  };
}

export async function reviewConcept(
  orderId: string,
  opts: {
    angles: MockupAngle[];
    source: ReviewSource;
    /** client asked for a picture: release the best pass as a draft on failure */
    releaseDraft?: boolean;
    /** run even with the automatic critic disabled (the crafter asked for it on the dashboard) */
    force?: boolean;
  },
): Promise<ReviewOutcome> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  const passthrough = (o: OrderPayload | null): ReviewOutcome => ({ approved: true, held: false, draft: false, revisions: 0, renders: o ? currentAngles(o) : [] });
  if (!order || (!isDesignCriticEnabled() && !opts.force) || !opts.angles.length) return passthrough(order);
  if ((order.design_review?.critic_pass_count ?? 0) >= MAX_CRITIC_PASSES_PER_ORDER) {
    console.info(`[design-review] ${orderId}: critic pass cap reached, renders shown unreviewed`);
    return passthrough(order);
  }

  const spec = await finalSpecOf(order);
  const clientText = (await store.listMessages(orderId)).filter((m) => m.sender === 'CLIENT' && m.text).map((m) => m.text).join('\n');
  // automatic revisions only for renders the client is about to see (the crafter's own renders are only scored)
  const loop = opts.source !== 'CRAFTER';
  let revisions = 0;
  let latest: OrderPayload = order;
  let report: CriticReport;
  /** Every pass with the renders it judged, to release / keep the best one. */
  const passes: Array<{ report: CriticReport; score: number; renders: MockupRender[]; real: boolean }> = [];

  for (;;) {
    report = await runDesignCritic({ spec, renders: currentAngles(latest), revisionNumber: revisions, clientText });
    const simulate = (latest.design_review?.simulate_fail_passes ?? 0) > 0;
    if (simulate) report = simulatedFailure(report, opts.angles, revisions);
    latest =
      (await saveReview(orderId, (r) => ({
        ...recordPass(report, revisions)(r),
        ...(simulate && { simulate_fail_passes: Math.max(0, (r.simulate_fail_passes ?? 0) - 1) }),
      }))) ?? latest;
    await logPass(latest, report, opts.source);
    const evaluated = currentAngles(latest).filter((r) => opts.angles.includes(r.angle));
    passes.push({ report, score: aggregate(report), renders: evaluated, real: evaluated.every((r) => r.engine !== 'offline-svg') });
    // revisions are diverging (clearly worse than the best pass so far): stop spending renders, keep the best
    const bestSoFar = Math.max(...passes.map((p) => p.score));
    if (passes.length > 1 && passes.at(-1)!.score < bestSoFar * DIVERGING_RATIO) {
      console.info(`[design-review] ${orderId}: revision ${revisions} scored below the best pass, stopping the loop`);
      break;
    }
    // a spec-level (heuristic) check cannot judge pixels, so it never asks for a re-render
    const advisoryOnly = report.mode === 'heuristic' && !report.simulated;
    if (report.decision === 'APPROVE' || advisoryOnly || !loop || revisions >= MAX_CRITIC_REVISIONS) break;
    if ((latest.design_review?.critic_pass_count ?? 0) >= MAX_CRITIC_PASSES_PER_ORDER) break;
    // regenerate only the necessary views, and never one the client already has from an earlier, approved round
    const targets = report.views_to_revise.filter((a) => opts.angles.includes(a));
    // a copied / generic concept is re-designed from scratch (editing the previous image keeps its silhouette); the master
    // view leads so the other views follow the new design
    // only a clear copy / generic design (< FRESH_BELOW) is redone from scratch; a near miss is edited, which keeps what
    // already works (a fresh re-render of an 85-point wallet scored 68)
    const fresh = report.critic_scores.originality < FRESH_BELOW || report.critic_scores.visual_identity < FRESH_BELOW;
    const views = [...new Set([...(fresh && opts.angles.includes('ANGLE_1') ? (['ANGLE_1'] as MockupAngle[]) : []), ...(targets.length ? targets : opts.angles)])];
    revisions += 1;
    console.info(`[design-review] ${orderId}: revision ${revisions}${fresh ? ' (fresh)' : ''} of ${views.join(', ')} (${report.failed.map(criterionLabel).join(', ')} below threshold)`);
    const redone = await renderMockupAngles(orderId, {
      angles: views,
      revision: { instructions: report.improvement_instructions, positive: report.render_positive, negative: report.render_negative, number: revisions, fresh },
    });
    latest = (await store.getOrder(orderId)) ?? latest;
    // every image model failed: an offline sketch cannot be improved by another pass (the QA hook still walks the loop)
    if (redone.every((r) => r.engine === 'offline-svg') && !report.simulated) break;
  }

  const passed = report.decision === 'APPROVE';
  const advisory = report.mode === 'heuristic' && !report.simulated;
  const failedForReal = !passed && !advisory;

  // The revisions don't always improve on each other: keep the best-scoring pass's renders (they become the set the crafter
  // reviews and, when released, what the client sees)
  let best = passes.at(-1);
  if (failedForReal && passes.length > 1) {
    // only passes whose every view is a real render can win (the critic never saw an offline sketch)
    const eligible = passes.some((p) => p.real) ? passes.filter((p) => p.real) : passes;
    best = eligible.reduce((a, b) => (b.score > a.score ? b : a));
    if (best !== passes.at(-1)) latest = (await restoreRenders(orderId, best.renders)) ?? latest;
  }
  // the client explicitly asked for a picture: never leave them with nothing, send the best pass as a labelled draft
  const draft = failedForReal && opts.source === 'CLIENT' && opts.releaseDraft === true;
  const hold = failedForReal && opts.source === 'CLIENT' && !draft;
  const status: CrafterDesignStatus = passed || opts.source === 'CRAFTER' ? 'PENDING_REVIEW' : 'NEEDS_REVIEW';
  latest =
    (await saveReview(orderId, (r) => ({
      crafter_status: status,
      revision_number: revisions,
      held_angles: hold ? [...new Set([...(r.held_angles ?? []), ...opts.angles])] : (passed || draft) && opts.source === 'CLIENT' ? undefined : r.held_angles,
      draft_released_angles: draft ? opts.angles : passed && opts.source === 'CLIENT' ? undefined : r.draft_released_angles,
      ...(failedForReal && best && opts.source === 'CLIENT' && { best_pass_revision: best.report.revision_number }),
    }))) ?? latest;

  if (failedForReal && opts.source !== 'CRAFTER') {
    const what = hold ? ' (gambar ditahan, belum dikirim ke klien)' : draft ? ' (pass terbaik dikirim ke klien sebagai DRAFT konsep)' : '';
    await notifyCrafter(
      latest,
      `Konsep desain belum lolos Design Critic setelah ${revisions} revisi otomatis${what}. ` +
        `Skor terbaik (revisi ${best?.report.revision_number ?? revisions}): ${scoreBreakdown(best?.report ?? report)}. Isu: ${report.weaknesses.join('; ') || report.improvement_instructions}. Mohon review di dashboard.`,
    );
  }
  return { approved: passed || advisory, held: hold, draft, report: best?.report ?? report, revisions, renders: currentAngles(latest) };
}

/** Sum of the ten scores: how good a pass is overall (ties go to the later pass). */
const aggregate = (r: CriticReport) => Object.values(r.critic_scores).reduce((s, v) => s + v, 0);

/** Put a pass's renders back as the current ones for their slots (the URLs stay valid; GCS objects are never deleted). */
async function restoreRenders(orderId: string, renders: MockupRender[]): Promise<OrderPayload | null> {
  const store = getStore();
  const latest = await store.getOrder(orderId);
  if (!latest || !renders.length) return latest;
  const merged = new Map(currentAngles(latest).map((r) => [r.angle, r]));
  for (const r of renders) merged.set(r.angle, r);
  const angles = MOCKUP_ANGLES.map((a) => merged.get(a)).filter((r): r is MockupRender => Boolean(r));
  const anchor = merged.get('ANGLE_1');
  latest.media_assets = {
    ...latest.media_assets,
    mockup_angles: angles,
    ...(anchor && { ai_generated_mockup_url: anchor.url, mockup_engine: anchor.engine, mockup_error: anchor.error }),
  };
  await store.saveOrder(latest);
  return latest;
}
