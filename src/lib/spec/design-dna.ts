import type { ViewScope } from '@/lib/spec/angles';
import { isBuiltInFurniture } from '@/lib/spec/categories/furniture';
import { directionDef, isDirectionSet, originalFeaturePrompt } from '@/lib/spec/directions';
import type { CraftCategory, DesignDirection, Specifications } from '@/lib/types';

/**
 * Design DNA research library + originality guardrail (Design Intelligence Layer v2, sections 3-5).
 *
 * The library works at the level of PRINCIPLES (silhouette families, proportion, material harmony, edges, closure
 * architecture, hardware restraint, craftsmanship signals). Brand names exist here only to read a client's reference as
 * a taste signal and to know what must NOT be copied; they never reach the image prompt as a style to imitate and are
 * never offered to the client as an option (the client sees the abstract directions in spec/directions.ts).
 */

/** Private research library (section 3). Read-only context for the team; never customer-facing, never prompted. */
export const DNA_RESEARCH_LIBRARY = [
  'Hermès', 'Loewe', 'Bottega Veneta', 'Celine', 'The Row', 'Valextra', 'Moynat', 'Delvaux', 'Goyard', 'Longchamp', 'Polène',
  'DeMellier', 'Toteme', 'Khaite', 'Jil Sander', 'Loro Piana', 'Brunello Cucinelli', 'Alaïa', 'Ferragamo', 'Mulberry',
  'Strathberry', 'Savette', 'Wandler', 'Aesther Ekme', 'Mansur Gavriel', 'Lemaire', 'Marni', 'Acne Studios', 'Jacquemus', 'Coach',
  'Tory Burch', 'Songmont', 'Hereu', 'Dragon Diffusion', 'Rodo', 'A.P.C.', 'Porter/Yoshida', 'Tumi', 'Rimowa', 'Carl Friedrik',
  'Peggy Hartanto',
] as const;

/** Category-level design principles injected into every concept prompt of that category. */
const CATEGORY_DNA: Record<CraftCategory, string[]> = {
  BAG: [
    'a deliberately chosen silhouette family with a reason to exist (never a default tote, bucket or shoulder bag)',
    'intentional proportion: height, width and gusset in a considered ratio, visual weight balanced over the base',
    'material harmony: at most two leathers and one hardware finish',
    'closure architecture integrated into the form, not added on',
    'handles and straps anchored at reinforced, intentional attachment points',
    'hardware restraint: few pieces, each one functional',
    'edges finished the same way everywhere (burnished or painted)',
    'believable interior organisation that matches the exterior volume',
  ],
  SMALL_GOODS: [
    'a compact, deliberate form where every fold and slot has a reason',
    'thin, flat profile: layers skived and arranged so the piece closes flat',
    'material harmony: one main leather, at most one accent',
    'edges finished the same way everywhere (burnished or painted)',
    'precise, even stitch spacing and slot alignment',
    'hardware only where it works (a zip, a snap), never decorative',
  ],
  FURNITURE: [
    'a clear silhouette family with deliberate proportions between top, frame and legs or plinth',
    'continuous grain matching across adjacent fronts and panels',
    'precise joinery and consistent gaps, the joints read as craftsmanship',
    'material harmony: one primary timber or board finish, at most one accent material',
    'hardware restraint: concealed or minimal pulls and hinges',
    'surfaces finished by hand (oiled, satin lacquer), no plastic-looking sheen',
  ],
  FOOTWEAR: [
    'a balanced last shape and toe spring, clean pattern lines',
    'material harmony between upper, lining and sole',
    'visible welt and stitching quality',
  ],
  CUSTOM_GENERIC: ['an intentional form with a clear purpose', 'coherent materials and finishing', 'visible craftsmanship quality'],
};

/** Built-in cabinetry is judged as interior architecture, not as a loose piece. */
const BUILT_IN_DNA = [
  'module divisions in a deliberate rhythm, door and drawer lines aligned across the whole run',
  'consistent shadow gaps and flush fronts',
  'continuous grain or colour across adjacent fronts',
  'integrated, minimal handles or push-to-open',
  'appliances set flush and aligned with the cabinet lines',
  'material harmony: one front finish, one countertop, at most one accent',
];

/** The quality language of a premium leather concept (the spec's own leather, colour and hardware finish win). */
const MATERIAL_QUALITY: Partial<Record<CraftCategory, string>> = {
  BAG: 'hand-stitched saddle stitching at even pitch, solid brass hardware in exactly the finish named in PRODUCT SPEC, crisp clean edges, premium craftsmanship',
  SMALL_GOODS: 'hand-stitched saddle stitching at even pitch, crisp clean edges, slim flat profile, premium craftsmanship',
  FURNITURE: 'solid timber or premium veneer with continuous grain, precise joinery, hand-rubbed oil or satin lacquer finish, restrained metal hardware, premium craftsmanship',
  FOOTWEAR: 'full-grain leather upper, refined stitching, clean welt, premium craftsmanship',
};

/**
 * How each leather must LOOK in the render, so the model draws the real material (an Epsom wallet is a fine embossed
 * cross-grain, never smooth calfskin). First match wins; unknown leathers get the generic full-grain look.
 */
const LEATHER_LOOK: Array<[RegExp, string]> = [
  [/croc|buaya|alligator/i, 'genuine crocodile leather with natural tile scales, polished sheen'],
  [/python|ular/i, 'genuine python leather with natural diamond scales'],
  [/ostrich/i, 'genuine ostrich leather with natural quill bumps'],
  [/epsom/i, 'Epsom leather: fine, tight embossed cross-grain, matte finish, firm and holds sharp crisp shape (never smooth)'],
  [/saffiano/i, 'saffiano leather: fine cross-hatch embossed texture, low sheen, firm'],
  [/togo|clemence|pebble/i, 'pebbled full-grain leather with a soft natural grain, matte'],
  [/veg[\s-]?tan|nabati/i, 'smooth vegetable-tanned full-grain leather with a soft natural sheen and visible fine grain'],
  [/pull[\s-]?up|crazy[\s-]?horse/i, 'waxy pull-up full-grain leather with subtle tonal colour variation'],
  [/nappa/i, 'soft smooth nappa leather with a gentle satin sheen'],
  [/calf/i, 'smooth full-grain calfskin with a refined satin finish and a very fine natural grain'],
  [/suede|nubuck/i, 'fine velvety suede nap'],
  [/sintetis|synthetic/i, 'synthetic leather rendered as finely as possible, matte, no plastic gloss'],
];

/** Leather look line for a leather good (the spec's own leather), '' when not a leather category. */
export function leatherLook(spec: Specifications): string {
  if (spec.category !== 'BAG' && spec.category !== 'SMALL_GOODS' && spec.category !== 'FOOTWEAR') return '';
  const a = spec.attributes as unknown as Record<string, unknown>;
  const leather = String(a.exterior_leather ?? a.upper_material ?? '');
  return LEATHER_LOOK.find(([re]) => re.test(leather))?.[1] ?? 'premium full-grain leather with a natural grain and satin finish';
}

/** Stitching thread as the image model must draw it ("Serasi dengan kulit" / "senada" → tonal). */
function threadLook(spec: Specifications): string {
  const t = String((spec.attributes as unknown as Record<string, unknown>).thread_color ?? '').trim();
  if (!t || /senada|serasi|sewarna|tonal|matching|same/i.test(t)) return 'tonal stitching thread in the same colour as the leather (not contrasting)';
  return `stitching thread: ${t}`;
}

/** Edge finish as drawn: painted edges are smooth, flat and colour-matched; burnished edges are rounded and glossy. */
function edgeLook(spec: Specifications): string {
  const e = String((spec.attributes as unknown as Record<string, unknown>).edge_finish ?? '');
  if (e === 'EDGE_PAINT') return 'edges finished with smooth, flat, colour-matched edge paint';
  if (e === 'BURNISHED') return 'hand-burnished rounded edges with a soft natural gloss';
  if (e === 'TURNED_EDGE') return 'turned (folded) edges with no raw edge visible';
  return '';
}

/** Section 5: what a concept must never look like. */
const ANTI_MARKETPLACE: Record<'LEATHER' | 'FURNITURE' | 'GENERIC', string> = {
  LEATHER:
    'generic default tote, bucket or shoulder-bag silhouette without a concept, random hardware placement, decorative details without function, weak or awkward proportions, too many unrelated materials, glossy cheap PU or synthetic-looking leather, distorted or wavy seams, impractical openings or straps, a generic marketplace catalogue look',
  FURNITURE:
    'generic flat-pack catalogue look, random handle placement, decorative trim without function, awkward proportions, too many unrelated materials, plastic-looking laminate sheen, misaligned doors or gaps, a generic marketplace look',
  GENERIC: 'generic catalogue look, random decoration, awkward proportions, too many unrelated materials, cheap synthetic-looking textures',
};

// ---------------------------------------------------------------------------
// Reference analysis (section 4): likes vs must-not-copy vs original
// ---------------------------------------------------------------------------

interface ReferenceSignature {
  match: RegExp;
  label: string;
  /** What a client usually likes about it: mood, quality, utility (never the product itself). */
  likes: string[];
  /** Its protected identity: never reproduced. */
  do_not_copy: string[];
  /** The abstract directions this taste points to. */
  taste: Array<Exclude<DesignDirection, 'UNSPECIFIED'>>;
  /** Attribute values that ARE this reference's signature (e.g. a turn-lock flap): never filled in as a workshop default. */
  signature_values?: Record<string, string[]>;
}

/** Signature attribute values per reference (kept apart from the table above for readability). */
const SIGNATURE_VALUES: Record<string, Record<string, string[]>> = {
  'Hermès Birkin': { main_closure: ['TURN_LOCK_FLAP', 'BUCKLE_FLAP'] },
  'Hermès Kelly': { main_closure: ['TURN_LOCK_FLAP', 'BUCKLE_FLAP'] },
  Hermès: { main_closure: ['TURN_LOCK_FLAP'] },
  Chanel: { main_closure: ['TURN_LOCK_FLAP'] },
  Mulberry: { main_closure: ['BUCKLE_FLAP'] },
};

/** The client's own words for a signature value: only these make it an explicit choice (else it was inferred). */
const SIGNATURE_VALUE_WORDS: Record<string, RegExp> = {
  TURN_LOCK_FLAP: /kunci putar|turn[\s-]?lock|gembok|padlock|touret/i,
  BUCKLE_FLAP: /gesper|buckle|sabuk depan|tali pengunci/i,
};

/**
 * A reference's signature values that the model inferred from the reference ("persis Birkin" → turn-lock flap) but the
 * client never asked for in their own words are cleared, so defaults and the render use an original closure instead.
 */
export function withoutInferredSignatures(spec: Specifications, clientText: string): Specifications {
  const avoid = signatureDefaultsToAvoid(spec);
  const a = spec.attributes as unknown as Record<string, unknown>;
  const cleared = Object.entries(avoid).filter(([k, values]) => typeof a[k] === 'string' && values.includes(a[k] as string) && !SIGNATURE_VALUE_WORDS[a[k] as string]?.test(clientText));
  if (!cleared.length) return spec;
  const out = structuredClone(spec);
  for (const [k] of cleared) (out.attributes as unknown as Record<string, unknown>)[k] = 'UNSPECIFIED';
  return out;
}

/**
 * Attribute values a workshop default must not introduce because they are a cited reference's signature (a Birkin
 * request never gets the turn-lock flap the top-handle form factor would default to). The client's own explicit choice
 * is never overridden; this only steers defaults.
 */
export function signatureDefaultsToAvoid(spec: Pick<Specifications, 'reference_object' | 'reference_do_not_copy' | 'reference_likes' | 'model_name' | 'notes'>): Record<string, string[]> {
  const text = [spec.reference_object, spec.model_name, spec.notes, ...spec.reference_do_not_copy, ...spec.reference_likes].join('\n');
  const out: Record<string, string[]> = {};
  for (const label of analyzeReferences(text).references) {
    for (const [key, values] of Object.entries(SIGNATURE_VALUES[label] ?? {})) out[key] = [...new Set([...(out[key] ?? []), ...values])];
  }
  return out;
}

const SIGNATURES: ReferenceSignature[] = [
  {
    match: /birkin/i,
    label: 'Hermès Birkin',
    likes: ['structured top-handle carry', 'premium hand-stitched leather', 'roomy upright body'],
    do_not_copy: ['the Birkin trapezoid with its flap folded over the handles', 'turn-lock with strap-and-padlock (clochette) closure', 'brand stamping and signature hardware'],
    taste: ['STRUCTURED_ELEGANCE', 'HERITAGE_CRAFTSMANSHIP'],
  },
  {
    match: /\bkelly\b/i,
    label: 'Hermès Kelly',
    likes: ['ladylike structured flap bag', 'single top handle', 'refined proportions'],
    do_not_copy: ['the Kelly trapezoid with side straps (sangles) and turn-lock', 'padlock and clochette', 'its exact flap shape'],
    taste: ['STRUCTURED_ELEGANCE', 'HERITAGE_CRAFTSMANSHIP'],
  },
  {
    match: /herm[eè]s/i,
    label: 'Hermès',
    likes: ['heritage-level leather quality', 'saddle-stitched construction'],
    do_not_copy: ['Hermès signature closures and hardware', 'H logo and stamping', 'Birkin, Kelly and Constance silhouettes'],
    taste: ['HERITAGE_CRAFTSMANSHIP', 'QUIET_LUXURY'],
  },
  {
    match: /louis ?vuitton|\blv\b|speedy|neverfull/i,
    label: 'Louis Vuitton',
    likes: ['practical everyday carry', 'durable travel-ready build'],
    do_not_copy: ['LV monogram and Damier canvas', 'Speedy and Neverfull exact shapes', 'signature padlock and natural vachetta trims'],
    taste: ['PRACTICAL_LUXURY', 'HERITAGE_CRAFTSMANSHIP'],
  },
  {
    match: /chanel/i,
    label: 'Chanel',
    likes: ['elegant evening flap bag', 'refined small-scale proportion'],
    do_not_copy: ['diamond quilting with an interlaced chain strap', 'CC turn-lock', 'the Classic Flap silhouette'],
    taste: ['STRUCTURED_ELEGANCE', 'QUIET_LUXURY'],
  },
  {
    match: /goyard/i,
    label: 'Goyard',
    likes: ['lightweight practical tote'],
    do_not_copy: ['Goyardine chevron / Y-pattern canvas', 'painted stripe personalisation in its style', 'the Saint Louis tote silhouette'],
    taste: ['PRACTICAL_LUXURY'],
  },
  {
    match: /bottega|intrecciato/i,
    label: 'Bottega Veneta',
    likes: ['logo-free luxury', 'soft, tactile leather'],
    do_not_copy: ['the intrecciato woven-leather pattern', 'Cassette, Jodie and Pouch exact shapes'],
    taste: ['CONTEMPORARY_ARTISAN', 'SOFT_CONTEMPORARY'],
  },
  {
    match: /loewe|puzzle bag/i,
    label: 'Loewe',
    likes: ['geometric, sculptural construction'],
    do_not_copy: ['the Puzzle bag geometric panel layout', 'Anagram logo and hardware'],
    taste: ['ARCHITECTURAL', 'EXPRESSIVE_CRAFT'],
  },
  {
    match: /celine|c[ée]line|triomphe/i,
    label: 'Celine',
    likes: ['clean Parisian minimalism'],
    do_not_copy: ['Triomphe hardware and canvas', 'Luggage and Classic Box exact shapes'],
    taste: ['MODERN_MINIMALISM', 'QUIET_LUXURY'],
  },
  {
    match: /\bdior\b|cannage|saddle bag/i,
    label: 'Dior',
    likes: ['statement, curvy silhouette'],
    do_not_copy: ['Cannage quilting', 'the Saddle bag kidney shape', 'CD / Dior hardware'],
    taste: ['EXPRESSIVE_CRAFT', 'STRUCTURED_ELEGANCE'],
  },
  {
    match: /gucci|horsebit|\bgg\b/i,
    label: 'Gucci',
    likes: ['heritage equestrian mood'],
    do_not_copy: ['GG monogram', 'horsebit hardware', 'the web stripe'],
    taste: ['HERITAGE_CRAFTSMANSHIP', 'EXPRESSIVE_CRAFT'],
  },
  { match: /prada/i, label: 'Prada', likes: ['sleek modern utility'], do_not_copy: ['the triangle logo plaque', 'Re-Edition and Galleria exact shapes'], taste: ['MODERN_MINIMALISM', 'STRUCTURED_ELEGANCE'] },
  { match: /fendi|baguette|peekaboo/i, label: 'Fendi', likes: ['compact statement bag'], do_not_copy: ['FF monogram', 'Baguette and Peekaboo shapes'], taste: ['EXPRESSIVE_CRAFT', 'STRUCTURED_ELEGANCE'] },
  { match: /saint laurent|\bysl\b/i, label: 'Saint Laurent', likes: ['sleek evening mood'], do_not_copy: ['the YSL Cassandre logo', 'chevron quilting'], taste: ['STRUCTURED_ELEGANCE'] },
  {
    match: /pol[eè]ne/i,
    label: 'Polène',
    likes: ['sculptural curved leather', 'refined finish at an accessible level'],
    do_not_copy: ['the Numéro Un / Neuf / Dix sculpted silhouettes', 'its embossed signature stamp'],
    taste: ['ARCHITECTURAL', 'SOFT_CONTEMPORARY'],
  },
  {
    match: /de ?mellier/i,
    label: 'DeMellier',
    likes: ['understated structured classics', 'everyday professional carry'],
    do_not_copy: ['the exact Montreal, New York and Vancouver shapes', 'its logo stamping'],
    taste: ['QUIET_LUXURY', 'STRUCTURED_ELEGANCE'],
  },
  { match: /\bthe row\b|margaux/i, label: 'The Row', likes: ['extreme understatement', 'supple premium leather'], do_not_copy: ['the Margaux exact silhouette'], taste: ['QUIET_LUXURY', 'MODERN_MINIMALISM'] },
  { match: /valextra|iside/i, label: 'Valextra', likes: ['architectural precision'], do_not_copy: ['the Iside exact silhouette', 'its signature black painted edge'], taste: ['STRUCTURED_ELEGANCE', 'MODERN_MINIMALISM'] },
  { match: /longchamp|le pliage/i, label: 'Longchamp', likes: ['light, foldable practicality'], do_not_copy: ['the Le Pliage foldable tote with leather flap'], taste: ['PRACTICAL_LUXURY'] },
  { match: /rimowa|\btumi\b/i, label: 'Rimowa / Tumi', likes: ['travel-grade organisation'], do_not_copy: ['grooved aluminium shells', 'branded hardware'], taste: ['MODULAR_UTILITY', 'PRACTICAL_LUXURY'] },
  { match: /jacquemus|chiquito|bambino/i, label: 'Jacquemus', likes: ['playful sculptural proportion'], do_not_copy: ['Chiquito / Bambino exact proportions', 'its logo plaque'], taste: ['ARCHITECTURAL', 'EXPRESSIVE_CRAFT'] },
  { match: /mulberry|bayswater/i, label: 'Mulberry', likes: ['British heritage carry'], do_not_copy: ['the Bayswater postman-lock flap', 'tree logo'], taste: ['HERITAGE_CRAFTSMANSHIP'] },
  {
    match: /eames|wishbone|barcelona chair|egg chair|panton|tulip (chair|table)/i,
    label: 'iconic designer furniture',
    likes: ['refined mid-century proportions'],
    do_not_copy: ['the exact silhouette of the iconic piece', 'its signature shell, frame or base geometry'],
    taste: ['MODERN_MINIMALISM', 'ARCHITECTURAL'],
  },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Every brand / iconic product name we know (signatures + the research library). */
const BRAND_WORDS = new RegExp([...SIGNATURES.map((s) => s.match.source), ...DNA_RESEARCH_LIBRARY.map(escapeRe)].join('|'), 'gi');

/**
 * Text for the IMAGE model with brand and iconic-product names removed ("Tas tangan Birkin 30" → "Tas tangan 30").
 * Image models draw what they are told about, even in a "do not copy X" sentence, so a reference name never reaches the
 * render prompt; the critic still gets the full must-not-copy list to judge against.
 */
export function scrubReferences(text: string): string {
  return text
    .replace(BRAND_WORDS, '')
    .replace(/\b(ala|mirip|kayak|seperti|inspired by|in the style of)\s*(?=[,.;:)"]|$)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:)"])/g, '$1')
    .trim();
}

/** "bikin yang persis / plek / replika / KW / 1:1" (but not "ga mau persis"). */
const COPY_WORDS = /persis|plek(\s?ketiplek)?|replika|replica|\bkw\b|tiruan|kembaran|\b1\s?:\s?1\b|identik|exact copy|sama banget/i;
const NEGATED_COPY = /(ga|gak|nggak|enggak|tidak|jangan|bukan|tanpa)\s+(mau\s+|perlu\s+|harus\s+|usah\s+|terlalu\s+)?(sama\s+)?(persis|plek|identik|sama banget|replika|kw|tiruan)/i;

export interface ReferenceAnalysis {
  /** Brand / product references found ("Hermès Birkin"). */
  references: string[];
  likes: string[];
  do_not_copy: string[];
  /** Directions the references point to, strongest first. */
  taste: Array<Exclude<DesignDirection, 'UNSPECIFIED'>>;
  /** The client asked for an exact copy / replica. */
  exact_copy_requested: boolean;
}

export function analyzeReferences(text: string): ReferenceAnalysis {
  // the most specific signature wins: "Hermès Birkin" is the Birkin, not Hermès in general
  const hits = SIGNATURES.filter((s) => s.match.test(text));
  const specific = hits.filter((s) => !(s.label === 'Hermès' && hits.some((h) => h.label.startsWith('Hermès '))));
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    references: specific.map((s) => s.label),
    likes: uniq(specific.flatMap((s) => s.likes)),
    do_not_copy: uniq(specific.flatMap((s) => s.do_not_copy)),
    taste: uniq(specific.flatMap((s) => s.taste)),
    exact_copy_requested: COPY_WORDS.test(text) && !NEGATED_COPY.test(text) && (specific.length > 0 || /\b(tas|dompet|bag|wallet|model|desain)\b/i.test(text)),
  };
}

/** Section 4, last rule: the client asked for a copy → we keep what they like and develop an original design. */
export function originalityNotice(references: string[]): string {
  const ref = references.length ? ` ${references[0]}` : '';
  return `Untuk referensi${ref}-nya, kami ambil kesan, kualitas, dan fungsi yang kakak suka, tapi desainnya kami kembangkan jadi original (tanpa logo, motif, atau ciri khas brand-nya) ya kak.`;
}

// ---------------------------------------------------------------------------
// Concept prompt lines (section 9)
// ---------------------------------------------------------------------------

const familyKey = (c: CraftCategory) => (c === 'BAG' || c === 'SMALL_GOODS' ? 'LEATHER' : c === 'FURNITURE' ? 'FURNITURE' : 'GENERIC');

/**
 * DESIGN DIRECTION / DESIGN DNA / CONCEPT / MATERIAL QUALITY / ORIGINALITY / AVOID lines of a concept prompt. A macro
 * (DETAIL) view gets the craftsmanship and quality lines, not the silhouette ones. The spec's own values win where they
 * differ from the quality language (a crocodile wallet with a silver zip stays exactly that).
 */
export function designPromptLines(spec: Specifications, scope: ViewScope): string[] {
  const primary = directionDef(spec.design_direction);
  const secondary = isDirectionSet(spec.secondary_direction) && spec.secondary_direction !== spec.design_direction ? directionDef(spec.secondary_direction) : undefined;
  const detail = scope === 'DETAIL';
  const concept = [
    primary && `proposition: a ${primary.name} concept${secondary ? ` blended with ${secondary.name}` : ''}`,
    spec.originality_feature.trim() && `original feature (must be clearly visible where this view allows): ${originalFeaturePrompt(spec.originality_feature)}`,
    !detail && spec.functional_advantage.trim() && `functional advantage: ${spec.functional_advantage.trim()}`,
    spec.craftsmanship_detail.trim() && `craftsmanship: ${spec.craftsmanship_detail.trim()}`,
  ].filter(Boolean);
  return [
    primary ? `DESIGN DIRECTION: ${primary.name}: ${primary.dna}${secondary ? `; blended with ${secondary.name}: ${secondary.dna}` : ''}.` : '',
    !detail
      ? `DESIGN DNA (abstract principles only, not any existing product): ${(spec.category === 'FURNITURE' && isBuiltInFurniture(spec.construction_type) ? BUILT_IN_DNA : CATEGORY_DNA[spec.category]).join('; ')}.`
      : '',
    concept.length ? `CONCEPT: ${concept.join('; ')}.` : '',
    MATERIAL_QUALITY[spec.category]
      ? `MATERIAL QUALITY: ${[...(leatherLook(spec) ? [leatherLook(spec), threadLook(spec), edgeLook(spec)] : []), MATERIAL_QUALITY[spec.category]].filter(Boolean).join('; ')}; the material, colour and hardware finish in PRODUCT SPEC take precedence where they differ. The leather colour is identical in every view.`
      : '',
    // the must-not-copy list stays with the critic: naming those features here would make the image model draw them
    `ORIGINALITY (mandatory): an original design with its own identity, built around the original feature above; its silhouette, closure and hardware are clearly different from any famous designer product. No logos, no monograms, no brand patterns, no text.`,
    `AVOID: ${ANTI_MARKETPLACE[familyKey(spec.category)]}.`,
  ].filter(Boolean);
}

/** Instruction for an attached client reference image when it shows someone else's product. */
export const REFERENCE_IMAGE_RULE =
  'The attached client image is a TASTE reference only: keep its mood, quality level and practical intent, but do NOT reproduce its exact silhouette, closure, hardware, logo, monogram or pattern; the result must be an original design.';

/** Bump when the design prompt lines change, so earlier renders of the same spec are not reused. */
export const DESIGN_PROMPT_VERSION = 4;
