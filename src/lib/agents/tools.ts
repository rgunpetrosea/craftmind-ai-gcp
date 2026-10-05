import { Type, type FunctionDeclaration } from '@google/genai';
import { getStore } from '@/lib/gcp/firestore';
import { currentAngles, finalSpecOf, renderMockupAngles, reusableRender } from '@/lib/mockups';
import { angleChoices, angleDef, angleForRequest, angleFromId, defaultMockupAngles } from '@/lib/spec/angles';
import { isClassified } from '@/lib/spec/catalog';
import { MAX_AI_MOCKUP_RENDERS, mockupCapMessage } from '@/lib/spec/guardrails';
import type { CrafterProfile, IntakeProgress, MockupAngle, MockupRender, Specifications } from '@/lib/types';
import { isAiBlocked } from '@/lib/utils/takeover';
import { sendToClient } from '@/lib/whatsapp';

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
  | { status: 'SKIPPED_TAKEOVER' };

/** Which slots this call is for: an explicit view in the client's words, else the model's angle_id, else the default set. */
export function targetAngles(spec: Specifications, args: MockupToolArgs): MockupAngle[] {
  const asked = angleForRequest(args.requestText ?? '', spec.category, spec.construction_type) ?? angleFromId(args.angle_id);
  return asked ? [asked] : defaultMockupAngles(spec.category, spec.construction_type);
}

/**
 * generate_mockup_tool: render the requested angle(s) and send them to the client as image messages.
 *
 * Quota: an angle whose existing render still shows the current spec (same signature) and gets no new adjustment is
 * re-sent as is, without an image call. The per-session AI render counter (`mockup_render_count`, max
 * MAX_AI_MOCKUP_RENDERS) goes up by one per call, and only when a new image was actually generated for a requested
 * angle (an offline concept after a failed call doesn't count). Over the cap no image API is called and the client
 * gets the crafter hand-off message.
 */
export async function executeGenerateMockupTool(orderId: string, profile: CrafterProfile, args: MockupToolArgs = {}): Promise<MockupToolResult> {
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || isAiBlocked(order)) return { status: 'SKIPPED_TAKEOVER' };
  if (!isClassified(order.specifications)) return { status: 'NOT_READY' };

  const spec = order.specifications;
  const targets = targetAngles(spec, args);
  const adjustment = typeof args.adjustment === 'string' && args.adjustment.trim() ? args.adjustment.trim() : undefined;
  const finalSpec = await finalSpecOf(order);
  const reused = adjustment ? [] : targets.filter((a) => reusableRender(order, a, finalSpec));
  const toGenerate = targets.filter((a) => !reused.includes(a));

  const used = order.intake?.mockup_render_count ?? 0;
  const capped = toGenerate.length > 0 && used >= MAX_AI_MOCKUP_RENDERS;
  const generated = toGenerate.length && !capped ? await renderMockupAngles(orderId, { angles: toGenerate, adjustment }) : [];
  // counted only for a real image on an angle that was asked for
  const counted = generated.some((r) => toGenerate.includes(r.angle) && r.engine !== 'offline-svg');

  const latest = await store.getOrder(orderId);
  if (!latest) return { status: 'NOT_READY' };
  if (counted) {
    const intake: IntakeProgress = { asked_topics: [], last_asked: [], deferred_topics: [], question_rounds: 0, ...latest.intake, mockup_render_count: used + 1 };
    await store.saveOrder({ ...latest, intake });
  }
  if (isAiBlocked(latest)) return { status: 'SKIPPED_TAKEOVER' };

  const byAngle = new Map(currentAngles(latest).map((r) => [r.angle, r]));
  const toSend = targets
    .filter((a) => !(capped && toGenerate.includes(a)))
    .map((a) => generated.find((r) => r.angle === a) ?? byAngle.get(a))
    .filter((r): r is MockupRender => Boolean(r));

  const intro = !generated.length
    ? 'Ini gambarnya ya kak.'
    : generated.every((r) => r.engine === 'offline-svg')
      ? 'Ini sketsa konsep awalnya dulu ya kak. Gambar studionya nanti dibantu crafter kami.'
      : used === 0 && !adjustment
        ? 'Ini gambaran awal desainnya ya kak. Kalau ada yang kurang pas, bilang aja biar kami sesuaikan.'
        : 'Ini gambar terbarunya ya kak. Kalau masih ada yang kurang pas, bilang aja.';
  for (const [i, r] of toSend.entries()) {
    const label = angleDef(spec.category, r.angle, spec.construction_type).label_id;
    const mime = r.url.startsWith('data:') ? r.url.slice(5, r.url.indexOf(';')) : 'image/jpeg';
    await sendToClient(latest, 'AI', i === 0 ? `${intro}\n\n${label}` : label, { type: 'image', url: r.url, mime_type: mime });
  }

  const sent = toSend.map((r) => r.angle);
  if (capped) {
    await sendToClient(latest, 'AI', mockupCapMessage(profile));
    return { status: 'CAPPED', reused: sent };
  }
  return { status: 'SENT', angles: sent, generated: generated.map((r) => r.angle), reused, counted };
}
