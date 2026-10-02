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

/** Send one message; for a client message the AI is expected to answer, wait until it has answered and is idle. */
async function send(phone, step) {
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
  if (e.debounce_bypass) check('debounce bypass', ctx.scenarioDebounceMs !== undefined && ctx.scenarioDebounceMs <= 1000, `scenario message debounce = ${ctx.scenarioDebounceMs} ms (want immediate, ≤ 1000 ms)`);
  if (e.dimension_mode === 'PENDING_SITE_VISIT' && isQuoted(order)) {
    const fee = ctx.breakdown?.site_visit_idr ?? 0;
    check('site visit fee', fee > 0, `site-visit fee in quote = Rp ${fee.toLocaleString('id-ID')}`);
  }
  if (!e.escalation_reason && e.automation_mode === 'AI_COPILOT') check('quoted', isQuoted(order), `session_state = ${order.session_state}`);
  if (ctx.timedOut) check('no timeout', false, `no reply within ${TIMEOUT_MS / 1000}s`);
  return out;
}

let failures = 0;
console.log(`Running ${scenarios.length} scenario(s) against ${BASE} (timeout ${TIMEOUT_MS / 1000}s per turn)\n`);

for (const sc of scenarios) {
  const phone = `+62812${String(Date.now()).slice(-8)}${sc.id.slice(-2)}`;
  console.log(`▶ ${sc.id}  ${sc.name}${sc.needs_attachment ? '  (CSV says text + sketch; runner sends text only)' : ''}`);
  const ctx = {};

  for (const step of sc.steps) {
    const order = (await session(phone)).order;
    if (step.phase === 'followup' && (!aiActive(order) || isQuoted(order))) continue;
    if (step.if_not_quoted && isQuoted(order)) continue;
    if (PAUSE_MS) await sleep(PAUSE_MS);
    const { res, reply, timedOut } = await send(phone, step);
    if (timedOut) ctx.timedOut = true;
    if (step.phase === 'scenario') ctx.scenarioDebounceMs = res.debounce_ms;
    if (reply) ctx.lastReply = reply;
    const who = step.as === 'CRAFTER' ? 'crafter' : step.phase === 'scenario' ? 'CLIENT*' : 'client ';
    console.log(`   ${who}: ${step.text.slice(0, 100)}${step.phase === 'scenario' ? `   [${res.action}${res.debounce_ms !== undefined ? `, ${res.debounce_ms}ms` : ''}]` : ''}`);
    if (reply) console.log(`   bot:     ${reply.replace(/\n/g, ' ⏎ ').slice(0, 150)}`);
  }

  const order = (await session(phone)).order;
  if (isQuoted(order)) ctx.breakdown = (await api(`/api/orders/${order.order_id}`)).breakdown;
  const results = evaluate(sc, order, ctx);
  const ok = results.every((r) => r.pass);
  if (!ok) failures++;
  for (const r of results) console.log(`   ${r.skipped ? '–' : r.pass ? '✔' : '✘'} ${r.detail}`);
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${sc.id}  quote=${order.pattern_and_bom.suggested_quotation_idr || '-'}  sqft=${order.pattern_and_bom.estimated_material_sqft || '-'}  order=${order.order_id}\n`);
}

console.log(failures ? `${failures} scenario(s) failed` : 'All scenarios passed');
process.exit(failures ? 1 : 0);
