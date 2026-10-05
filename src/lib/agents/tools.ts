import { Type, type FunctionDeclaration } from '@google/genai';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, finalSpecOf, renderMockupAngles, reusableRender } from '@/lib/mockups';
import { angleChoices, angleDef, angleForRequest, angleFromId, defaultMockupAngles } from '@/lib/spec/angles';
import { isClassified } from '@/lib/spec/catalog';
import { MAX_AI_MOCKUP_RENDERS, mockupCapMessage } from '@/lib/spec/guardrails';
import type { CrafterProfile, IntakeProgress, MockupAngle, MockupRender, Specifications } from '@/lib/types';
import { isAiBlocked } from '@/lib/utils/takeover';
import { notifyCrafter, sendToClient } from '@/lib/whatsapp';

/**
 * Tools the intake assistant can call. The orchestrator also invokes them deterministically (client asks for a picture,
 * or the core specification is complete), so they work with Gemini offline too.
 */

export const MOCKUP_TOOL_NAME = 'generate_mockup_tool';

/** Declaration for this order: `angle_id` is explained with the product's own views (1 = closed, 2 = open, ...). */
export function mockupToolDeclaration(spec?: Specifications): FunctionDeclaration {
  const choices = spec && isClassified(spec) ? angleChoices(spec.category, spec.construction_type) : '1 = main exterior view, 2 = open / interior view, 3 = detail macro';
  return {
    name: MOCKUP_TOOL_NAME,
    description:
      'Render a studio mockup (draft image) of the product from the current specification and send it to the client in this chat. ' +
      'Call it when the client asks to see a picture / mockup / draft / "gambaran", or when the core specification is complete. ' +
      'Do not promise to send an image later: call this tool instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'CLIENT_REQUEST or CORE_SPEC_COMPLETE' },
        angle_id: {
          type: Type.INTEGER,
          description:
            `Which view to render: ${choices}. When the client asks for the open / inside view ("posisi terbuka", "bagian dalam", ` +
            '"slot kartu", "interior"), pass the interior angle, never the closed exterior. Omit for the default set.',
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
  /** 1..3, the slot the model picked. */
  angle_id?: unknown;
  adjustment?: unknown;
  /** The client's words when they asked for a picture: an explicit view ("posisi terbuka") outranks the model's pick. */
  requestText?: string;
}

export type MockupToolResult =
  | { status: 'SENT'; angles: MockupAngle[]; generated: MockupAngle[]; reused: MockupAngle[]; counted: boolean }
  | { status: 'CAPPED'; reused: MockupAngle[] }
  | { status: 'NOT_READY' }
  | { status: 'FAILED' }
  | { status: 'SKIPPED_TAKEOVER' };

/** Which slots this call is for: an explicit view in the client's words, else the model's angle_id, else the default set. */
export function targetAngles(spec: Specifications, args: MockupToolArgs): MockupAngle[] {
  const asked = angleForRequest(args.requestText ?? '', spec.category, spec.construction_type) ?? angleFromId(args.angle_id);
  return asked ? [asked] : defaultMockupAngles(spec.category, spec.construction_type);
}

/**
 * generate_mockup_tool: render the requested angle(s) and send them to the client as image messages, each one as soon as
 * it is ready (in slot order: the closed exterior first, then the open interior), so a revision never stops at the
 * acknowledgment text.
 *
 * Quota: an angle whose existing render still shows the current spec (same signature) and is not the target of a free-text
 * adjustment is re-sent as is, without an image call. The per-session AI render counter (`mockup_render_count`, max
 * MAX_AI_MOCKUP_RENDERS) goes up by ONE per call, a paired exterior + interior render included, and only when a real
 * image (not the offline concept) was generated for a requested angle. Over the cap no image API is called and the
 * client gets the crafter hand-off message (once). A render failure gets a short apology and the crafter is notified.
 */
export async function executeGenerateMockupTool(orderId: string, profile: CrafterProfile, args: MockupToolArgs = {}): Promise<MockupToolResult> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || isAiBlocked(order)) return { status: 'SKIPPED_TAKEOVER' };
  if (!isClassified(order.specifications)) return { status: 'NOT_READY' };

  const spec = order.specifications;
  const targets = targetAngles(spec, args);
  const adjustment = typeof args.adjustment === 'string' && args.adjustment.trim() ? args.adjustment.trim() : undefined;
  // a free-text change aimed at one view ("slot kartunya miring" → interior) only re-renders that view
  const focus = adjustment ? angleForRequest(adjustment, spec.category, spec.construction_type) : undefined;
  const adjusted = !adjustment ? [] : focus && targets.includes(focus) ? [focus] : targets;
  const finalSpec = await finalSpecOf(order);
  const current = new Map(currentAngles(order).map((r) => [r.angle, r]));
  const reused = targets.filter((a) => !adjusted.includes(a) && reusableRender(order, a, finalSpec));
  const toGenerate = targets.filter((a) => !reused.includes(a));

  const used = order.intake?.mockup_render_count ?? 0;
  const capped = toGenerate.length > 0 && used >= MAX_AI_MOCKUP_RENDERS;
  const sendable = targets.filter((a) => !(capped && toGenerate.includes(a)));
  const intro = !toGenerate.length || capped
    ? 'Ini gambarnya ya kak.'
    : used === 0 && !current.size
      ? 'Ini gambaran awal desainnya ya kak. Kalau ada yang kurang pas, bilang aja biar kami sesuaikan.'
      : 'Ini gambar yang sudah disesuaikan ya kak. Kalau masih ada yang kurang pas, bilang aja.';

  // Images go out in slot order as they become ready; a reused leading angle is sent before rendering starts.
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
        const label = r.engine === 'offline-svg' ? `${def.label_id} (sketsa konsep, gambar studionya dibantu crafter kami)` : def.label_id;
        const mime = r.url.startsWith('data:') ? r.url.slice(5, r.url.indexOf(';')) : 'image/jpeg';
        await sendToClient(latest, 'AI', sent.length === 0 ? `${intro}\n\n${label}` : label, { type: 'image', url: r.url, mime_type: mime });
        sent.push(r.angle);
      }
    });
    return chain;
  };
  await flush();

  let generated: MockupRender[] = [];
  if (toGenerate.length && !capped) {
    try {
      generated = await renderMockupAngles(orderId, {
        angles: toGenerate,
        adjustment: adjustment && `Client's requested change (their own words): "${adjustment}"`,
        onRender: async (r) => {
          if (!sendable.includes(r.angle)) return;
          ready.set(r.angle, r);
          await flush();
        },
      });
    } catch (err) {
      console.error(`[generate_mockup_tool] render for ${orderId} failed:`, err);
      const latest = await store.getOrder(orderId);
      if (latest && !isAiBlocked(latest)) {
        await sendToClient(latest, 'AI', 'Maaf kak, gambarnya lagi ada kendala teknis. Crafter kami bantu kirimkan langsung ya.');
        await notifyCrafter(latest, `Render mockup gagal (${err instanceof Error ? err.message : String(err)}); kirim gambar manual ke klien`);
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
  return { status: 'SENT', angles: sent, generated: generated.map((r) => r.angle), reused, counted };
}
