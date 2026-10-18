import { Type, type FunctionDeclaration } from '@google/genai';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, finalSpecOf, renderMockupAngles, reusableRender } from '@/lib/mockups';
import { angleChoices, angleDef, angleForRequest, angleFromId, anglesFromIds, defaultMockupAngles, MOCKUP_ANGLES } from '@/lib/spec/angles';
import { isBuiltInFurniture } from '@/lib/spec/categories/furniture';
import { isClassified, missingRequired } from '@/lib/spec/catalog';
import { aiRenderCap, APPROVAL_PENDING_MESSAGE, mockupCapMessage, renderTemplate } from '@/lib/spec/guardrails';
import { isDesignCriticEnabled } from '@/lib/agents/critic-agent';
import { reviewConcept, stageForApproval } from '@/lib/design-review';
import type { CrafterProfile, IntakeProgress, MockupAngle, MockupRender, Specifications } from '@/lib/types';
import { isAiBlocked } from '@/lib/utils/takeover';
import { notifyCrafter, sendToClient } from '@/lib/whatsapp';

/**
 * Tools the intake assistant can call. The orchestrator also invokes them deterministically (client asks for a picture,
 * or the core specification is complete), so they work with Gemini offline too.
 */

export const MOCKUP_TOOL_NAME = 'generate_mockup_tool';

/** Declaration for this order: angle ids are explained with the product's own views (1 = closed, 2 = open, ...). */
export function mockupToolDeclaration(spec?: Specifications): FunctionDeclaration {
  const choices = spec && isClassified(spec) ? angleChoices(spec.category, spec.construction_type) : '1 = main exterior view, 2 = open / interior view, 3 = detail macro';
  return {
    name: MOCKUP_TOOL_NAME,
    description:
      'Render a studio mockup (draft image) of the product from the current specification and send it to the client in this chat. ' +
      'Call it when the client asks to see a picture / mockup / draft / "gambaran", or when the core specification is complete. ' +
      'Do not promise to send an image later: call this tool instead. ' +
      'Several views are rendered in ONE call (pass them all in `angles`); never call the tool once per angle.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'CLIENT_REQUEST or CORE_SPEC_COMPLETE' },
        angles: {
          type: Type.ARRAY,
          items: { type: Type.INTEGER },
          description:
            `Views to render in this single call: ${choices}. E.g. [1, 2, 3] for the full set. When the client asks for the open / ` +
            'inside view ("posisi terbuka", "bagian dalam", "slot kartu", "interior"), pass the interior angle, never the closed ' +
            'exterior. Omit for the default set.',
        },
        batch_job: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              angle: { type: Type.INTEGER, description: 'View id (see angles).' },
              derived_from: { type: Type.INTEGER, description: 'Master view this one is derived from (1): same geometry, new camera / state.' },
            },
            required: ['angle'],
          },
          description:
            'One-pass batch, preferred over `angles`: [{"angle": 1}, {"angle": 2, "derived_from": 1}, {"angle": 3, "derived_from": 1}]. ' +
            'Angle 1 is the master shot; derived angles keep its exact geometry.',
        },
        adjustment: {
          type: Type.STRING,
          description:
            'Only when the client asked to change how the picture looks in a way the specification does not capture ("lebih glossy"), in English. ' +
            'Leave empty to just show the current design again.',
        },
      },
      required: ['reason'],
    },
  };
}

export interface MockupToolArgs {
  /** [{ angle: 1 }, { angle: 2, derived_from: 1 }, ...]: one-pass batch; derived angles keep the master's geometry. */
  batch_job?: unknown;
  /** [1, 2, 3]: the slots rendered in this single call (batched, one render round). */
  angles?: unknown;
  /** 1..3, a single slot (older calls). */
  angle_id?: unknown;
  adjustment?: unknown;
  /** The client's words when they asked for a picture: an explicit view ("posisi terbuka") outranks the model's pick. */
  requestText?: string;
  /**
   * The client explicitly asked to see a picture ("kirim gambarnya", "langsung gambarin"): if the critic still fails the
   * concept after its revisions, the best-scoring pass is sent as a draft instead of nothing (crafter review stays open).
   */
  clientAsked?: boolean;
}

export type MockupToolResult =
  | { status: 'SENT'; angles: MockupAngle[]; generated: MockupAngle[]; reused: MockupAngle[]; counted: boolean }
  | { status: 'CAPPED'; reused: MockupAngle[] }
  /** The design critic failed the new renders after its automatic revisions: withheld for the crafter's review. */
  | { status: 'HELD'; held: MockupAngle[]; reused: MockupAngle[] }
  | { status: 'NOT_READY' }
  | { status: 'FAILED' }
  | { status: 'SKIPPED_TAKEOVER' };

/**
 * Concept jobs: generate_mockup_tool runs in the BACKGROUND, one job at a time per order, so the render + design-critic
 * loop (up to 3 vision passes and 2 re-renders, minutes with a real image model) never holds the WhatsApp turn open:
 * the client keeps chatting, and the images / the hold message arrive when the job ends. `isConceptRendering()` drives
 * the "preparing the concept" status (separate from "AI agents working").
 */
const globalForJobs = globalThis as unknown as { __craftmindConceptJobs?: Map<string, Promise<unknown>> };
const conceptJobs = (globalForJobs.__craftmindConceptJobs ??= new Map<string, Promise<unknown>>());

export function isConceptRendering(orderId: string): boolean {
  return conceptJobs.has(orderId);
}

export function enqueueMockupTool(
  orderId: string,
  profile: CrafterProfile,
  args: MockupToolArgs = {},
  after?: (result: MockupToolResult) => void | Promise<void>,
): void {
  const previous = conceptJobs.get(orderId) ?? Promise.resolve();
  const job: Promise<unknown> = previous
    .catch(() => undefined)
    .then(() => executeGenerateMockupTool(orderId, profile, args))
    .then(async (result) => {
      await after?.(result);
      return result;
    })
    .catch((err) => console.error(`[generate_mockup_tool] background job for ${orderId} failed:`, err))
    .finally(() => {
      if (conceptJobs.get(orderId) === job) conceptJobs.delete(orderId);
    });
  conceptJobs.set(orderId, job);
}

/** Angles of a `batch_job` ([{ angle, derived_from }]) and whether any of them is derived from the master shot. */
export function parseBatchJob(job: unknown): { angles: MockupAngle[]; derived: boolean } {
  if (!Array.isArray(job)) return { angles: [], derived: false };
  const items = job.filter((j): j is { angle?: unknown; derived_from?: unknown } => typeof j === 'object' && j !== null);
  return { angles: anglesFromIds(items.map((j) => j.angle)), derived: items.some((j) => Number(j.derived_from) === 1) };
}

/** One-pass batch for a set of slots: ANGLE_1 is the master, the others are derived from it. */
export function batchJobFor(angles: MockupAngle[]): Array<{ angle: number; derived_from?: number }> {
  return angles.map((a) => {
    const angle = MOCKUP_ANGLES.indexOf(a) + 1;
    return angle === 1 ? { angle } : { angle, derived_from: 1 };
  });
}

/**
 * Which slots this call renders: an explicit view in the client's words, else the `batch_job`, else the batch in
 * `angles`, else a single `angle_id`, else the default set (wallets / bags: closed + open interior).
 */
export function targetAngles(spec: Specifications, args: MockupToolArgs): MockupAngle[] {
  const asked = angleForRequest(args.requestText ?? '', spec.category, spec.construction_type);
  if (asked) return [asked];
  const job = parseBatchJob(args.batch_job).angles;
  if (job.length) return job;
  const batch = anglesFromIds(args.angles);
  if (batch.length) return batch;
  const single = angleFromId(args.angle_id);
  return single ? [single] : defaultMockupAngles(spec.category, spec.construction_type);
}

/**
 * generate_mockup_tool: render the requested angle(s) and send them to the client as image messages, each one as soon as
 * it is ready (in slot order: the closed exterior first, then the open interior), so a revision never stops at the
 * acknowledgment text.
 *
 * Quota: an angle whose existing render still shows the current spec (same signature) and is not the target of a free-text
 * adjustment is re-sent as is, without an image call. The per-session AI render counter (`mockup_render_count`, max
 * `aiRenderCap()`: 6 by default, initial renders and feedback re-renders alike) goes up by ONE per call, however many angles the batch renders, and only when a real
 * image (not the offline concept) was generated for a requested angle. Over the cap no image API is called and the
 * client gets the crafter hand-off message (once). A render failure gets a short apology and the crafter is notified.
 */
export async function executeGenerateMockupTool(orderId: string, profile: CrafterProfile, args: MockupToolArgs = {}): Promise<MockupToolResult> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || isAiBlocked(order)) return { status: 'SKIPPED_TAKEOVER' };
  if (!isClassified(order.specifications)) return { status: 'NOT_READY' };
  // Required spec gate (every caller checks it too): no image while a mandatory slot (built-ins: board core, finishing,
  // hinges & rails, top table) is still empty; the conversation asks for it instead.
  if (missingRequired(order.specifications, order.intake).length) return { status: 'NOT_READY' };

  const spec = order.specifications;
  const targets = targetAngles(spec, args);
  const adjustment = typeof args.adjustment === 'string' && args.adjustment.trim() ? args.adjustment.trim() : undefined;
  // a free-text change aimed at one view ("slot kartunya miring" → interior) only re-renders that view
  const focus = adjustment ? angleForRequest(adjustment, spec.category, spec.construction_type) : undefined;
  const adjusted = !adjustment ? [] : focus && targets.includes(focus) ? [focus] : targets;
  const finalSpec = await finalSpecOf(order);
  const current = new Map(currentAngles(order).map((r) => [r.angle, r]));
  let reused = targets.filter((a) => !adjusted.includes(a) && reusableRender(order, a, finalSpec));
  // Geometry lock (built-in interiors, or a batch with derived angles): every derived angle is built on the current master
  // shot. A stale master is rendered first in the same call; when the master changes, its derived angles change with it.
  const geometryLocked = (spec.category === 'FURNITURE' && isBuiltInFurniture(spec.construction_type)) || parseBatchJob(args.batch_job).derived;
  if (geometryLocked && targets.some((a) => !reused.includes(a))) {
    const masterCurrent = reused.includes('ANGLE_1') || (!targets.includes('ANGLE_1') && reusableRender(order, 'ANGLE_1', finalSpec));
    if (!masterCurrent) {
      if (!targets.includes('ANGLE_1')) targets.unshift('ANGLE_1');
      reused = [];
    }
  }
  const toGenerate = targets.filter((a) => !reused.includes(a));

  const used = order.intake?.mockup_render_count ?? 0;
  const capped = toGenerate.length > 0 && used >= aiRenderCap(spec);
  // Only renders the crafter has already approved go straight to the client (re-sent, no image call); everything new or
  // still awaiting approval is staged on the dashboard below.
  const pendingApproval = new Set(order.design_review?.held_angles ?? []);
  const sendable = reused.filter((a) => !pendingApproval.has(a));
  const intro = "Here's the picture.";

  // Approved images go out in slot order.
  const ready = new Map(reused.map((a) => [a, current.get(a)!] as const));
  const sent: MockupAngle[] = [];
  let chain = Promise.resolve();
  const flush = () => {
    chain = chain.then(async () => {
      while (sent.length < sendable.length && ready.has(sendable[sent.length])) {
        const r = ready.get(sendable[sent.length])!;
        const latest = await store.getOrder(orderId);
        if (!latest || isAiBlocked(latest)) return;
        const def = angleDef(spec.category, r.angle, spec.construction_type);
        const label = r.engine === 'offline-svg' ? `${def.label} (concept sketch; our crafter will follow up with the studio render)` : def.label;
        const mime = r.url.startsWith('data:') ? r.url.slice(5, r.url.indexOf(';')) : 'image/jpeg';
        await sendToClient(latest, 'AI', sent.length === 0 ? `${intro}\n\n${label}` : label, { type: 'image', url: r.url, mime_type: mime });
        sent.push(r.angle);
      }
    });
    return chain;
  };
  await flush();

  let generated: MockupRender[] = [];
  // Design critic (optional, DESIGN_CRITIC=on): scores and revises the new renders before the crafter sees them
  const critic = isDesignCriticEnabled();
  let criticFailed = false;
  if (toGenerate.length && !capped) {
    try {
      generated = await renderMockupAngles(orderId, {
        angles: toGenerate,
        adjustment: adjustment && `Client's requested change (their own words): "${adjustment}"`,
      });
      if (critic) criticFailed = (await reviewConcept(orderId, { angles: toGenerate, source: 'CLIENT' })).held;
    } catch (err) {
      console.error(`[generate_mockup_tool] render for ${orderId} failed:`, err);
      const latest = await store.getOrder(orderId);
      if (latest && !isAiBlocked(latest)) {
        await sendToClient(latest, 'AI', "Sorry, we've hit a technical issue with the picture. Our crafter will send it to you directly.");
        await notifyCrafter(latest, `Mockup render failed (${err instanceof Error ? err.message : String(err)}); send the images to the client manually`);
      }
      return { status: 'FAILED' };
    }
  }
  await chain;

  // counted once per call, only for a real image on an angle that was asked for
  const counted = generated.some((r) => toGenerate.includes(r.angle) && r.engine !== 'offline-svg');
  const latest = await store.getOrder(orderId);
  if (!latest) return { status: 'NOT_READY' };
  if (counted) {
    const intake: IntakeProgress = { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: 0, ...latest.intake, mockup_render_count: used + 1 };
    await store.saveOrder({ ...latest, intake });
  }
  if (capped) {
    const capText = mockupCapMessage(profile);
    // the hand-off is said once, not on every later picture request
    const alreadySaid = (await store.listMessages(orderId)).some((m) => m.sender === 'AI' && m.text === capText);
    if (!alreadySaid && !isAiBlocked(latest)) await sendToClient(latest, 'AI', capText);
    return { status: 'CAPPED', reused: sent };
  }
  if (isAiBlocked(latest)) return { status: 'SKIPPED_TAKEOVER' };

  // Crafter approval (no auto-submit): every new render, and any earlier one still unapproved, waits on the dashboard for
  // "Approve & Send to Client"; the client hears that the draft is being reviewed for construction feasibility.
  const staged = [...toGenerate, ...reused.filter((a) => pendingApproval.has(a))];
  if (staged.length) {
    await stageForApproval(orderId, staged, criticFailed ? 'NEEDS_REVIEW' : 'PENDING_CRAFTER_APPROVAL');
    const fresh = await store.getOrder(orderId);
    if (fresh && !isAiBlocked(fresh)) {
      await sendToClient(fresh, 'AI', renderTemplate(APPROVAL_PENDING_MESSAGE, profile));
      if (!criticFailed) await notifyCrafter(fresh, `Draft mockup (${staged.length} views) ready for review. Approve & send to the client from the dashboard.`);
    }
    return { status: 'HELD', held: staged, reused: sent };
  }
  return { status: 'SENT', angles: sent, generated: generated.map((r) => r.angle), reused, counted };
}
