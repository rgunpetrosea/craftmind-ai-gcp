// Converts scenarios.csv (the QA matrix) into src/lib/data/scenarios.json for the simulator's scenario player and
// the end-to-end runner (scripts/run-scenarios.mjs).   Usage: npm run scenarios:build
//
// Each CSV row is ONE client message plus the expected outcome. Some rows assume prior context (a confused
// conversation, a crafter who already replied...), and most need a couple of answers before a quote exists, so this
// script adds, per scenario id:
//   setup     scripted turns played BEFORE the CSV message (client or crafter)
//   followups client answers played AFTER it, only while the AI is still gathering (stop once quoted / taken over)
// The CSV message itself is always sent verbatim and is the turn under test.
import { readFileSync, writeFileSync } from 'node:fs';

const csv = readFileSync(new URL('../scenarios.csv', import.meta.url), 'utf8');

/** Minimal RFC-4180 parser (quoted fields, doubled quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const CATEGORY = { bespoke_bag: 'BAG', bespoke_wallet: 'SMALL_GOODS', bespoke_shoes: 'FOOTWEAR', custom_furniture: 'FURNITURE', furniture: 'FURNITURE' };
const DONE = 'Terserah mas untuk detail lainnya. Itu saja kak';
const client = (text, extra = {}) => ({ as: 'CLIENT', text, ...extra });
const crafter = (text) => ({ as: 'CRAFTER', text });

const SCRIPT = {
  'SCN-01': { followups: [DONE, DONE] },
  'SCN-02': { followups: ['Kulitnya Epsom hitam aja mas', DONE, DONE] },
  'SCN-03': { followups: ['Kulitnya veg-tan coklat 1.6mm ya mas', DONE, DONE] },
  'SCN-04': { followups: ['Ukurannya 11.5 x 9 cm, tebal 1.2 cm ya mas', DONE, DONE] },
  'SCN-05': { followups: [DONE, DONE] },
  'SCN-06': { setup: [client('Mau bikin dompet bifold kulit ya mas')] },
  'SCN-07': {
    // three turns without progress before the CSV message → confusion strike limit (3) is reached on the CSV turn
    setup: [client('Mau bikin tas selempang kulit pake flap ya'), client('Bukan gitu mas maksudnya penutupnya'), client('Masih salah mas, bukan yang itu')],
  },
  'SCN-08': {
    setup: [
      client('Mau tas selempang 30x10x20 cm kulit veg-tan coklat 1.6mm'),
      client(DONE, { if_not_quoted: true }),
      client(DONE, { if_not_quoted: true }),
      crafter('Halo kak, saya Fendy crafternya. Penawarannya saya cek dulu ya'),
    ],
  },
  'SCN-09': { followups: [DONE, DONE] },
  'SCN-10': { setup: [client('Mau bikin tote bag kulit veg-tan coklat 1.6mm, yang muat laptop 14 inch')], followups: [DONE, DONE] },
};

const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const get = (r, k) => (r[col[k]] ?? '').trim();

const scenarios = rows.map((r) => {
  const id = get(r, 'id');
  const script = SCRIPT[id] ?? { followups: [DONE, DONE] };
  const refOrDim = get(r, 'expected_reference_or_dim');
  const dims = /^(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?\s*cm$/i.exec(refOrDim);
  const unspecified = !refOrDim || /^unspecified$/i.test(refOrDim);
  const escalation = get(r, 'expected_escalation_reason');
  const notes = get(r, 'notes');
  return {
    id,
    name: get(r, 'scenario_name'),
    category: CATEGORY[get(r, 'category')] ?? 'CUSTOM_GENERIC',
    input_type: get(r, 'client_input_type'),
    needs_attachment: /sketch|photo|foto/i.test(get(r, 'client_input_type')),
    message: get(r, 'client_raw_message'),
    notes,
    expected: {
      category: CATEGORY[get(r, 'category')] ?? 'CUSTOM_GENERIC',
      // the CSV fills dimension_mode even where the size is "Unspecified"; those rows don't assert it
      dimension_mode: unspecified ? null : get(r, 'expected_dimension_mode'),
      dims: dims ? [dims[1], dims[2], dims[3]].filter(Boolean).map((n) => Number(n.replace(',', '.'))) : null,
      reference: !unspecified && !dims && get(r, 'expected_dimension_mode') === 'REFERENCE_BASED' ? refOrDim : null,
      material_status: get(r, 'expected_material_status') || null,
      automation_mode: get(r, 'expected_automation_mode') || null,
      escalation_reason: !escalation || escalation === 'NONE' ? null : escalation,
      debounce_bypass: /bypass/i.test(notes) || /bypass/i.test(get(r, 'scenario_name')),
    },
    expected_summary: [get(r, 'expected_dimension_mode'), refOrDim, get(r, 'expected_material_status'), get(r, 'expected_automation_mode'), escalation].join(' · '),
    steps: [
      ...(script.setup ?? []).map((s) => ({ ...s, phase: 'setup' })),
      { as: 'CLIENT', text: get(r, 'client_raw_message'), phase: 'scenario' },
      ...(script.followups ?? []).map((t) => ({ as: 'CLIENT', text: t, phase: 'followup' })),
    ],
  };
});

writeFileSync(new URL('../src/lib/data/scenarios.json', import.meta.url), JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to src/lib/data/scenarios.json`);
for (const s of scenarios) console.log(`  ${s.id}  ${s.category.padEnd(12)} steps=${s.steps.length}  ${s.expected_summary}`);
