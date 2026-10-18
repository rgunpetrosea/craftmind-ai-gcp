// End-to-end scenario runner: plays each scenario from scenarios.csv (via src/lib/data/scenarios.json) against a running
// server as a WhatsApp chat and checks the expected columns of the CSV.
//
//   npm run scenarios                         # all scenarios against http://localhost:3000
//   npm run scenarios -- --only SCN-02,SCN-05 # a subset
//   npm run scenarios -- --base http://localhost:3100 --timeout 120
//   npm run scenarios -- --pause 12           # free-tier Gemini key: wait between turns (requests-per-minute limit)
//
// Start the server with a short debounce so each turn is answered quickly:  DEBOUNCE_BASE_MS=800 npm run dev
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:3000');
const TIMEOUT_MS = Number(arg('timeout', 90)) * 1000;
/** Seconds to wait between turns, to stay under free-tier requests-per-minute limits. */
const PAUSE_MS = Number(arg('pause', 0)) * 1000;
const only = arg('only', '').split(',').filter(Boolean);
const scenarios = JSON.parse(readFileSync(new URL('../src/lib/data/scenarios.json', import.meta.url), 'utf8')).filter((s) => !only.length || only.includes(s.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, init) => (await fetch(BASE + path, init)).json();
const session = (phone) => api(`/api/webhook/whatsapp?phone=${encodeURIComponent(phone)}`);
const post = (body) => api('/api/webhook/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const isQuoted = (o) => o && (o.session_state === 'PENDING_CRAFTER_APPROVAL' || o.session_state === 'APPROVED');
const aiActive = (o) => o && o.automation_mode === 'AI_COPILOT';

/** A crafter-dashboard call from the script (":order" → the scenario's order id). */
async function callApi(phone, step) {
  const orderId = (await session(phone)).order?.order_id;
  if (!orderId) throw new Error(`${step.path}: no order yet`);
  // e.g. "Approve & Send to Client": wait until the background render job has staged the mockups
  if (step.wait_for_renders) {
    for (let i = 0; i < 900; i++) {
      const d = await api(`/api/orders/${orderId}`);
      if (!d.rendering_angles && (d.order?.design_review?.held_angles?.length ?? 0) > 0) break;
      if (!d.rendering_angles && i > 5) break;
      await sleep(1000);
    }
  }
  const fill = (s) => s.replaceAll(':order', orderId);
  const res = await api(fill(step.path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fill(JSON.stringify(step.body ?? {})) });
  if (res.error) throw new Error(`${step.path}: ${res.error}`);
  return { res: { action: 'API' }, reply: null };
}

/** Send one message; for a client message the AI is expected to answer, wait until it has answered and is idle. */
async function send(phone, step) {
  if (step.as === 'API') return callApi(phone, step);
  const before = (await session(phone)).messages?.filter((m) => m.sender !== 'CLIENT').length ?? 0;
  const res = await post({ phone_number: phone, client_name_wa: 'Tester', sender: step.as, text: step.text });
  if (res.error) throw new Error(res.error);
  if (step.as === 'CRAFTER' || res.action !== 'BUFFERED_FOR_AI') return { res, reply: res.action === 'ESCALATED_TO_CRAFTER' ? '(handed over to crafter)' : null };
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(1200);
    const s = await session(phone);
    const bot = s.messages.filter((m) => m.sender !== 'CLIENT');
    if (bot.length > before && !s.ai_pending) return { res, reply: bot.at(-1).text };
  }
  return { res, reply: null, timedOut: true };
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sorted = (xs) => [...xs].map(Number).sort((a, b) => a - b);

function evaluate(sc, order, ctx) {
  const e = sc.expected;
  const spec = order.specifications;
  const out = [];
  const check = (name, pass, detail) => out.push({ name, pass, detail });

  check('category', spec.category === e.category, `category = ${spec.category} (want ${e.category})`);
  if (e.dimension_mode) check('dimension_mode', spec.dimension_mode === e.dimension_mode, `dimension_mode = ${spec.dimension_mode} (want ${e.dimension_mode})`);
  if (e.dims) {
    const d = spec.attributes.dimensions_cm ?? { length: 0, width: 0, height: 0 };
    const got = sorted([d.length, d.width, d.height]);
    const want = sorted(e.dims.length === 2 ? [...e.dims, got[0]] : e.dims);
    // the CSV mixes axis order (LxWxH vs LxHxW), so compare the three measurements regardless of order
    check('dimensions', want.every((v, i) => Math.abs(v - got[i]) < 0.06), `dimensions = ${d.length} x ${d.width} x ${d.height} cm (want ${e.dims.join(' x ')} cm, any axis order)`);
  }
  if (e.reference) {
    const tokens = norm(e.reference).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    const ref = norm(spec.reference_object);
    check('reference', tokens.every((t) => ref.includes(t)), `reference_object = "${spec.reference_object}" (want ~"${e.reference}")`);
    const d = spec.attributes.dimensions_cm;
    check('inferred size', d && d.length > 0 && d.height > 0, `inferred dimensions = ${d?.length} x ${d?.width} x ${d?.height} cm`);
  }
  if (e.material_status) {
    if (isQuoted(order)) check('material', order.material_sourcing.status === e.material_status, `material_sourcing = ${order.material_sourcing.status} (want ${e.material_status})`);
    else out.push({ name: 'material', pass: true, skipped: true, detail: `material not checked: no quote yet (session ${order.session_state}, ${order.automation_mode})` });
  }
  if (e.automation_mode) check('automation', order.automation_mode === e.automation_mode, `automation_mode = ${order.automation_mode} (want ${e.automation_mode})`);
  check('escalation', (order.escalation_reason ?? null) === e.escalation_reason, `escalation_reason = ${order.escalation_reason ?? 'none'} (want ${e.escalation_reason ?? 'none'})`);
  if (e.debounce_bypass) check('debounce bypass', ctx.scenarioDebounceMs !== undefined && ctx.scenarioDebounceMs <= 2000, `scenario message debounce = ${ctx.scenarioDebounceMs} ms (want the minimum buffer window, ≤ 2000 ms)`);
  if (e.dimension_mode === 'PENDING_SITE_VISIT' && isQuoted(order)) {
    const fee = ctx.breakdown?.site_visit_idr ?? 0;
    check('site visit fee', fee > 0, `site-visit fee in quote = Rp ${fee.toLocaleString('id-ID')}`);
  }
  if (!e.escalation_reason && e.automation_mode === 'AI_COPILOT') check('quoted', isQuoted(order), `session_state = ${order.session_state}`);
  for (const c of e.design_checks ?? []) designCheck(c, order, ctx, check);
  if (ctx.timedOut) check('no timeout', false, `no reply within ${TIMEOUT_MS / 1000}s`);
  return out;
}

// --- Design Intelligence Layer v2 checks (CSV column expected_design_checks) -------------------------------------
/** Brand names must never appear as a customer-facing direction option. */
const BRANDS = /herm[eè]s|birkin|kelly|chanel|louis vuitton|\blv\b|goyard|bottega|loewe|celine|dior|gucci|prada|fendi|pol[eè]ne|demellier|the row|valextra|longchamp|jacquemus|mulberry/i;
const CRITIC_KEYS = ['premium_perception', 'originality', 'visual_identity', 'proportion_balance', 'material_harmony', 'craftsmanship_value', 'functional_credibility', 'view_consistency', 'commercial_appeal', 'production_feasibility'];
/** A direction-card message: numbered lines with a bold label ("1. *Kalem & Tanpa Logo* (rekomendasi): ..."). */
const CARD_LINE = /^\d+\.\s\*/m;
/** Client-facing card lines stay short: at most two sentences each. */
const sentences = (line) => line.replace(/^\d+\.\s/, '').split(/(?<=[.!?])\s+/).filter(Boolean).length;

function designCheck(token, order, ctx, check) {
  const [name, arg = ''] = token.split(/:(.*)/s);
  const spec = order.specifications;
  const review = order.design_review ?? { history: [] };
  const ai = (ctx.messages ?? []).filter((m) => m.sender === 'AI' || m.sender === 'SYSTEM' || m.sender === 'CRAFTER');
  const aiText = ai.map((m) => m.text ?? '').join('\n');
  const cardsAt = ai.findIndex((m) => CARD_LINE.test(m.text ?? ''));
  const cardsText = cardsAt >= 0 ? ai[cardsAt].text : '';
  const cardLines = cardsText.split('\n').filter((l) => /^\d+\.\s\*/.test(l));
  const images = ai.filter((m) => m.media_type === 'image');
  switch (name) {
    case 'DIRECTION_CARDS': {
      const proposed = order.intake?.proposed_directions ?? [];
      return check(name, cardsAt >= 0 && cardLines.length >= 1 && cardLines.length <= 3 && proposed.length === cardLines.length, `direction cards = ${cardLines.length} (${proposed.join(', ') || 'none proposed'}), want 1-3 before rendering`);
    }
    case 'CARDS_SHORT':
      return check(name, cardsAt >= 0 && cardLines.every((l) => sentences(l) <= 2 && l.length <= 160), `card lines (≤ 2 short sentences): ${cardLines.map((l) => `${sentences(l)} sentence(s), ${l.length} chars`).join(' / ') || '(no cards)'}`);
    case 'AUTO_DIRECTION':
      return check(
        name,
        cardsAt === -1 && spec.design_direction && spec.design_direction !== 'UNSPECIFIED' && images.length > 0,
        `no cards shown: ${cardsAt === -1}, direction = ${spec.design_direction}, images sent = ${images.length}`,
      );
    case 'CARDS_NO_BRANDS':
      return check(name, cardsAt >= 0 && !cardLines.some((l) => BRANDS.test(l)), `card options without brand names: ${cardLines.map((l) => l.replace(/^\d+\.\s\*|\*.*$/g, '')).join(' / ') || '(no cards)'}`);
    case 'NO_RENDER_BEFORE_DIRECTION': {
      const firstImage = ai.findIndex((m) => m.media_type === 'image');
      return check(name, cardsAt >= 0 && (firstImage === -1 || firstImage > cardsAt), `first image at AI message #${firstImage}, direction cards at #${cardsAt} (no picture before the cards)`);
    }
    case 'DIRECTION_CHOSEN':
      return check(name, spec.design_direction && spec.design_direction !== 'UNSPECIFIED', `design_direction = ${spec.design_direction}${spec.originality_feature ? `, original feature "${spec.originality_feature}"` : ''}`);
    case 'DIRECTION_TASTE': {
      const want = arg.split('|');
      const first = order.intake?.proposed_directions?.[0];
      return check(name, want.includes(first), `recommended direction = ${first ?? 'none'} (want one of ${want.join(', ')})`);
    }
    case 'ORIGINALITY_NOTICE':
      return check(name, /into an original design/i.test(aiText), `originality notice ${/into an original design/i.test(aiText) ? 'sent' : 'missing'}`);
    case 'DO_NOT_COPY':
      return check(name, spec.reference_likes?.length > 0 && spec.reference_do_not_copy?.length > 0, `likes: ${spec.reference_likes?.length ?? 0}, must-not-copy: ${spec.reference_do_not_copy?.join('; ') || 'none'}`);
    case 'RISK_FLAG':
      return check(name, (ctx.riskFlags ?? []).some((f) => norm(f).includes(norm(arg))), `risk flags: ${(ctx.riskFlags ?? []).join(' | ') || 'none'} (want ~"${arg}")`);
    case 'CLIENT_ADVISED':
      return check(name, norm(aiText).includes(norm(arg)), `client advice "${arg}" ${norm(aiText).includes(norm(arg)) ? 'sent' : 'missing'}`);
    case 'CRITIC_REVIEWED': {
      const last = review.history.at(-1);
      const scored = last && CRITIC_KEYS.every((k) => typeof last.critic_scores?.[k] === 'number');
      return check(name, !!scored, last ? `critic passes = ${review.critic_pass_count ?? review.history.length}, last ${last.decision} (${last.mode})` : 'no critic pass recorded');
    }
    case 'CRITIC_FAILED': {
      const hit = review.history.find((h) => h.failed?.includes(arg));
      return check(name, !!hit, hit ? `${arg} = ${hit.critic_scores[arg]} (< threshold), decision ${hit.decision}` : `no critic pass failed ${arg}`);
    }
    case 'CRITIC_REVISED': {
      const failedPass = review.history.find((h) => h.decision === 'REVISE');
      const revised = review.history.find((h) => h.revision_number >= 1);
      return check(name, !!failedPass && !!revised && !review.held_angles?.length, `REVISE pass: ${failedPass ? 'yes' : 'no'}, revised pass: ${revised ? `${revised.decision} at revision ${revised.revision_number}` : 'no'}, held: ${review.held_angles?.length ?? 0}`);
    }
    case 'REAL_RENDERS': {
      // every view is a real image-model render (no offline sketch) and the critic actually looked at the pictures
      const renders = order.media_assets?.mockup_angles ?? [];
      const offline = renders.filter((r) => r.engine === 'offline-svg');
      const last = review.history.at(-1);
      const gated = ['premium_perception', 'originality', 'visual_identity', 'proportion_balance', 'view_consistency'];
      const scores = last ? gated.map((k) => `${k.split('_')[0]} ${last.critic_scores[k]}`).join(', ') : 'no critic pass';
      return check(
        name,
        // (with the critic disabled there is no pass: the renders alone are checked)
        renders.length > 0 && !offline.length && (!last || last.mode === 'ai'),
        `${renders.length - offline.length}/${renders.length} real renders${offline[0]?.error ? ` (offline: ${offline[0].error.slice(0, 80)})` : ''}; critic ${last?.mode ?? '-'} ${last?.decision ?? ''}: ${scores}`,
      );
    }
    case 'APPROVAL_STAGED': {
      // the client first hears the draft is being reviewed; images only come from the crafter's approval
      const waitAt = ai.findIndex((m) => /giving it a quick review/i.test(m.text ?? ''));
      const aiImages = ai.filter((m) => m.sender === 'AI' && m.media_type === 'image').length;
      const firstImage = ai.findIndex((m) => m.media_type === 'image');
      const crafterImages = ai.filter((m) => m.sender === 'CRAFTER' && m.media_type === 'image').length;
      return check(
        name,
        waitAt >= 0 && aiImages === 0 && (firstImage === -1 || firstImage > waitAt),
        `review message at #${waitAt}, AI auto-sent images ${aiImages} (want 0), crafter-approved images ${crafterImages}`,
      );
    }
    case 'SPEC_EXPLICIT': {
      const a = spec.attributes ?? {};
      const set = (v) => (typeof v === 'number' ? v > 0 : typeof v === 'string' ? v.trim() !== '' && v !== 'UNSPECIFIED' : !!v);
      const keys = arg.split(/[|,]/);
      const missing = keys.filter((k) => !set(a[k]));
      return check(name, !missing.length, keys.map((k) => `${k}=${JSON.stringify(a[k])}`).join(', '));
    }
    case 'IMAGES_SENT':
      return check(name, images.length > 0, `${images.length} image(s) sent to the client`);
    case 'MULTI_ANGLE': {
      const n = order.media_assets?.mockup_angles?.length ?? 0;
      return check(name, n >= 2, `${n} angle(s) rendered`);
    }
    case 'CRAFTER_STATUS':
      return check(name, review.crafter_status === arg, `crafter_status = ${review.crafter_status ?? 'NOT_REVIEWED'} (want ${arg})`);
    case 'QUESTION_ANSWERED':
      return check(name, norm(ctx.scenarioReplies).includes(norm(arg)), `answer to the question mentions "${arg}": ${String(ctx.scenarioReplies ?? '').replace(/\n/g, ' ').slice(0, 90)}`);
    case 'NOT_LOCKED_ON_QUESTION':
      return check(name, ctx.stateAfterScenario === 'REQUIREMENT_GATHERING' || ctx.stateAfterScenario === 'IDLE', `session after the question turn = ${ctx.stateAfterScenario} (spec card not locked)`);
    case 'SOURCING_FEE': {
      const s = order.material_sourcing;
      return check(name, s.sourcing_fee_idr > 0 && s.additional_lead_days > 0, `sourcing fee Rp ${s.sourcing_fee_idr.toLocaleString('id-ID')}, +${s.additional_lead_days} days`);
    }
    case 'ANGLE_OVERRIDE': {
      const prompt = order.media_assets?.angle_prompts?.[arg];
      const render = order.media_assets?.mockup_angles?.find((r) => r.angle === arg);
      return check(name, !!prompt && render?.custom_prompt === prompt, `${arg} custom shot: ${prompt ? `"${prompt}"` : 'none'}${render?.custom_prompt ? ' (rendered)' : ''}`);
    }
    default:
      return check(name, false, `unknown design check "${token}"`);
  }
}

// The QA matrix covers every craft category (e.g. SCN-05 is furniture). Run it under a profile that allows everything,
// then restore the crafter's own profile, so domain-boundary refusals don't mask the behaviour under test.
const ALL_OFFERINGS = ['wallets', 'card_holders', 'bags', 'belts', 'watch_straps', 'shoes', 'furniture', 'apparel', 'jewelry', 'home_decor', 'sports_gear'];
const originalProfile = (await api('/api/crafter-profile')).profile;
const putProfile = (profile) => api('/api/crafter-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
if (originalProfile) await putProfile({ ...originalProfile, allowed_categories: ALL_OFFERINGS });

let failures = 0;
console.log(`Running ${scenarios.length} scenario(s) against ${BASE} (timeout ${TIMEOUT_MS / 1000}s per turn)\n`);

for (const sc of scenarios) {
  const phone = `+62812${String(Date.now()).slice(-8)}${sc.id.slice(-2)}`;
  console.log(`▶ ${sc.id}  ${sc.name}${sc.needs_attachment ? '  (CSV says text + sketch; runner sends text only)' : ''}`);
  const ctx = {};

  for (const step of sc.steps) {
    const order = (await session(phone)).order;
    // client follow-ups stop once quoted / taken over; crafter-dashboard follow-ups (approve) still run
    if (step.phase === 'followup' && step.as !== 'API' && (!aiActive(order) || isQuoted(order))) continue;
    if (step.if_not_quoted && isQuoted(order)) continue;
    if (PAUSE_MS && step.as !== 'API') await sleep(PAUSE_MS);
    const seen = step.phase === 'scenario' ? ((await session(phone)).messages?.length ?? 0) : 0;
    const { res, reply, timedOut } = await send(phone, step);
    if (timedOut) ctx.timedOut = true;
    if (step.phase === 'scenario') {
      // what the assistant said and where the session stood right after the turn under test
      const s = await session(phone);
      ctx.scenarioDebounceMs = res.debounce_ms;
      ctx.stateAfterScenario = s.order?.session_state;
      ctx.scenarioReplies = s.messages.slice(seen).filter((m) => m.sender !== 'CLIENT').map((m) => m.text ?? '').join('\n');
    }
    if (reply) ctx.lastReply = reply;
    const who = step.as === 'API' ? 'dashboard' : step.as === 'CRAFTER' ? 'crafter' : step.phase === 'scenario' ? 'CLIENT*' : 'client ';
    console.log(`   ${who}: ${step.text.slice(0, 100)}${step.phase === 'scenario' ? `   [${res.action}${res.debounce_ms !== undefined ? `, ${res.debounce_ms}ms` : ''}]` : ''}`);
    if (reply) console.log(`   bot:     ${reply.replace(/\n/g, ' ⏎ ').slice(0, 150)}`);
  }

  // concept renders + their design-critic loop run in the background (and so do the crafter's review angles): let them
  // finish before judging the order
  let detail = (await session(phone)).order ? await api(`/api/orders/${(await session(phone)).order.order_id}`) : null;
  // (with a real image model one concept job + its background angles can take ~10 minutes)
  for (let i = 0; detail?.rendering_angles && i < Math.max(TIMEOUT_MS / 1000, 900); i++) {
    await sleep(1000);
    detail = await api(`/api/orders/${detail.order.order_id}`);
  }
  const order = detail?.order ?? (await session(phone)).order;
  if (isQuoted(order)) ctx.breakdown = detail?.breakdown;
  ctx.riskFlags = detail?.risk_flags ?? [];
  ctx.messages = detail?.messages ?? [];
  const results = evaluate(sc, order, ctx);
  const ok = results.every((r) => r.pass);
  if (!ok) failures++;
  for (const r of results) console.log(`   ${r.skipped ? '–' : r.pass ? '✔' : '✘'} ${r.detail}`);
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${sc.id}  quote=${order.pattern_and_bom.suggested_quotation_idr || '-'}  sqft=${order.pattern_and_bom.estimated_material_sqft || '-'}  order=${order.order_id}\n`);
}

if (originalProfile) await putProfile(originalProfile);
console.log(failures ? `${failures} scenario(s) failed` : 'All scenarios passed');
process.exit(failures ? 1 : 0);
