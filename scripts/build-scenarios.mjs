// Converts scenarios.csv (the QA matrix) into src/lib/data/scenarios.json for the simulator's scenario picker
// and the end-to-end runner (scripts/run-scenarios.mjs).   Usage: npm run scenarios:build
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

const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

/**
 * What the client types after the AI has asked for missing details, and scenario-specific assertions.
 * Where the CSV has the AI recommend a material and the client simply agrees ("iya", "sip"), the follow-up states that
 * material explicitly, so the scenario also passes on the offline parser (which cannot read the AI's own suggestion).
 */
const SUPPLEMENTS = {
  'SCN-01': { followups: ['Ukurannya sekitar 10x7 cm ya mas', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'customization.type': 'EMBOSS_INITIALS', 'exterior_leather~': 'epsom' } },
  'SCN-02': { followups: ['Ukuran ikut laptop 14 inch aja mas, kulit veg-tan coklat 1.6mm', 'Terserah mas untuk lainnya. Itu saja kak'] },
  'SCN-03': { followups: ['Ukurannya 11x9 cm', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'pocket_layout.id_window': true, 'finish.edge_treatment': 'BURNISHED' } },
  'SCN-04': { followups: ['Oke pakai Pull-Up tebal 2.0mm ya mas, ukuran 30x10x60 cm', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'material_sourcing.status': 'SPECIAL_SOURCING_NEEDED' } },
  'SCN-05': { followups: ['Ukuran 20x2.5x10 cm', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'pocket_layout.coin_zip_pocket': true, 'finish.zipper~': 'gold', 'exterior_leather~': 'navy' } },
  'SCN-06': { followups: ['Chrome-tan olive green 1.4mm ya mas, ukuran 38x14x32 cm', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'material_sourcing.status': 'SPECIAL_SOURCING_NEEDED' } },
  'SCN-07': {
    followups: ['Ukuran 18x8x14 cm, kulit veg-tan coklat 1.6mm', 'Terserah mas untuk lainnya. Itu saja kak'],
    // the CSV's second client turn is a correction that arrives after the first spec card
    postQuoteFrom: 1,
    checks: { height_plus_3: true, 'pocket_layout.exterior_pockets>=': 1 },
  },
  'SCN-08': { followups: ['Pakai veg-tan natural aja mas, ukuran 10x7 cm', 'Terserah mas untuk lainnya. Itu saja kak'], checks: { 'customization.type': 'LASER_ENGRAVING' } },
  'SCN-09': { followups: ['Epsom hitam 1.8mm ya mas, ukuran 42x10x31 cm', 'Terserah mas untuk lainnya. Itu saja kak'] },
  'SCN-10': { followups: [] },
};

const scenarios = rows.map((r) => {
  const id = r[col['ID']].trim();
  const flow = r[col['Ringkasan Alur Chat WA (End-to-End)']];
  const expectedRaw = r[col['Output Parsed Specs & Challenge']];
  const turns = [...flow.matchAll(/Client:\s*'(.*?)'\s*(?:\[[^\]]*\]\s*)?(?=->|$)/g)].map((m) => m[1].trim());
  const expected = Object.fromEntries(
    expectedRaw.split('|').map((kv) => kv.trim()).filter(Boolean).map((kv) => {
      const i = kv.indexOf(':');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const sup = SUPPLEMENTS[id] ?? { followups: [] };
  const split = sup.postQuoteFrom ?? turns.length;
  const checks = { ...(sup.checks ?? {}) };
  // When the scenario ends in a human takeover the AI is deliberately silent, so only the takeover state is asserted.
  if (expected['Automation State']) checks['automation_mode'] = expected['Automation State'];
  else if (expected['Form Factor']) checks['construction_type'] = expected['Form Factor'];
  if (expected['Escalation Trigger']) checks['escalation_reason'] = expected['Escalation Trigger'] === 'CLIENT_REQUESTED_HUMAN' ? 'CLIENT_REQUEST' : expected['Escalation Trigger'];
  return {
    id,
    category: r[col['Kategori Produk']].trim(),
    model: r[col['Model/Silhouette']].trim(),
    inbound_type: r[col['Tipe Inbound Client']].trim(),
    needs_attachment: /foto|sketsa/i.test(r[col['Tipe Inbound Client']]),
    client_turns: turns.slice(0, split),
    followup_turns: sup.followups,
    post_quote_turns: turns.slice(split),
    expected_summary: expectedRaw,
    checks,
  };
});

writeFileSync(new URL('../src/lib/data/scenarios.json', import.meta.url), JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to src/lib/data/scenarios.json`);
for (const s of scenarios) console.log(`  ${s.id}  turns=${s.client_turns.length}${s.post_quote_turns.length ? `+${s.post_quote_turns.length}` : ''}  ${s.checks.construction_type ?? ''}`);
