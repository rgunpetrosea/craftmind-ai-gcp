// End-to-end scenario runner: plays each scenario from scenarios.csv against a running dev server
// as a real multi-turn WhatsApp chat and asserts on the resulting order.
//
//   npm run scenarios                         # all scenarios against http://localhost:3000
//   npm run scenarios -- --only SCN-01,SCN-10 # a subset
//   npm run scenarios -- --base http://localhost:3100 --timeout 120
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
const only = arg('only', '')?.split(',').filter(Boolean);
const scenarios = JSON.parse(readFileSync(new URL('../src/lib/data/scenarios.json', import.meta.url), 'utf8')).filter((s) => !only.length || only.includes(s.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

async function api(path, init) {
  const res = await fetch(BASE + path, init);
  return res.json();
}
const session = (phone) => api(`/api/webhook/whatsapp?phone=${encodeURIComponent(phone)}`);

/** Send one client message, then wait until the bot (AI or system) answers and is idle again. */
async function say(phone, text) {
  const before = (await session(phone)).messages?.filter((m) => m.sender !== 'CLIENT').length ?? 0;
  const res = await api('/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: phone, client_name_wa: 'Tester', text }),
  });
  if (res.error) throw new Error(res.error);
  const started = Date.now();
  // A message logged for the crafter (AI paused) never gets an AI reply, so don't wait for one.
  if (res.action === 'LOGGED_FOR_CRAFTER') return { res, reply: null };
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(1500);
    const s = await session(phone);
    const bot = s.messages.filter((m) => m.sender !== 'CLIENT');
    if (bot.length > before && !s.ai_pending) return { res, reply: bot.at(-1).text, state: s };
  }
  return { res, reply: null, timedOut: true };
}

const ORDER_ROOTS = ['automation_mode', 'escalation_reason', 'material_sourcing', 'session_state'];
/** Paths are relative to order.specifications unless they start with a top-level order field. */
const valueAt = (order, path) => get(order, ORDER_ROOTS.some((r) => path.startsWith(r)) ? path : `specifications.${path}`);

function check(order, path, expected, ctx) {
  if (path === 'height_plus_3') {
    const now = order.specifications.attributes.dimensions_cm.height;
    return [now === ctx.heightBefore + 3, `height ${ctx.heightBefore} → ${now} (want +3)`];
  }
  if (path.endsWith('~')) {
    const v = String(valueAt(order, path.slice(0, -1)) ?? '');
    return [new RegExp(expected, 'i').test(v), `${path.slice(0, -1)} = "${v}" (want ~${expected})`];
  }
  if (path.endsWith('>=')) {
    const v = valueAt(order, path.slice(0, -2));
    return [v >= expected, `${path.slice(0, -2)} = ${v} (want ≥ ${expected})`];
  }
  const v = valueAt(order, path);
  return [v === expected, `${path} = ${JSON.stringify(v)} (want ${JSON.stringify(expected)})`];
}

let failures = 0;
console.log(`Running ${scenarios.length} scenario(s) against ${BASE} (timeout ${TIMEOUT_MS / 1000}s per turn)\n`);

for (const sc of scenarios) {
  const phone = `+62812${String(Date.now()).slice(-8)}${sc.id.slice(-2)}`;
  console.log(`▶ ${sc.id}  ${sc.category} · ${sc.model}${sc.needs_attachment ? '  (original sends a photo/sketch; skipped here, text only)' : ''}`);
  const transcript = [];
  let timedOut = false;

  const play = async (text) => {
    const { reply, timedOut: t } = await say(phone, text);
    transcript.push([text, reply]);
    if (t) timedOut = true;
    console.log(`   client: ${text.slice(0, 90)}\n   bot:    ${(reply ?? '(no reply)').replace(/\n/g, ' ⏎ ').slice(0, 140)}`);
  };

  for (const turn of sc.client_turns) await play(turn);

  // Answer follow-up questions until the draft quotation is produced.
  const followups = [...sc.followup_turns];
  const isHandedOver = async () => (await session(phone)).order?.automation_mode === 'FULL_MANUAL';
  while (!timedOut && followups.length && !(await isHandedOver())) {
    const state = (await session(phone)).order?.session_state;
    if (state === 'PENDING_CRAFTER_APPROVAL') break;
    await play(followups.shift());
  }

  const ctx = { heightBefore: (await session(phone)).order?.specifications?.attributes?.dimensions_cm?.height ?? 0 };
  for (const turn of sc.post_quote_turns) await play(turn);

  const order = (await session(phone)).order;
  const results = Object.entries(sc.checks).map(([k, v]) => [k, ...check(order, k, v, ctx)]);
  if (sc.post_quote_turns.length === 0 && !sc.checks.automation_mode) results.push(['quoted', order.session_state === 'PENDING_CRAFTER_APPROVAL', `session_state = ${order.session_state}`]);
  if (timedOut) results.push(['no timeout', false, `no reply within ${TIMEOUT_MS / 1000}s`]);

  const ok = results.every(([, pass]) => pass);
  if (!ok) failures++;
  for (const [, pass, detail] of results) console.log(`   ${pass ? '✔' : '✘'} ${detail}`);
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${sc.id}  quote=${order.pattern_and_bom.suggested_quotation_idr || '-'}  sqft=${order.pattern_and_bom.estimated_material_sqft || '-'}  order=${order.order_id}\n`);
}

console.log(failures ? `${failures} scenario(s) failed` : 'All scenarios passed');
process.exit(failures ? 1 : 0);
