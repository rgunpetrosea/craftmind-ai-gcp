import type { CraftCategory } from '@/lib/types';

/**
 * Crafting knowledge base. Grounds the assistant's answers when a client asks what a term means ("raw edge itu kayak
 * gimana?"), and defines what counts as a standard request: anything well outside these terms and the category schemas
 * is escalated to the crafter (see NON_STANDARD).
 *
 * `topic` links an entry to the category topic whose preference should be (re)asked after answering.
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  match: RegExp;
  categories: CraftCategory[];
  /** Topic id in the category schema to ask the preference for after explaining. */
  topic?: string;
  /** Short, client-friendly explanation in English (the reply language). */
  explanation: string;
}

const LEATHER: CraftCategory[] = ['SMALL_GOODS', 'BAG', 'FOOTWEAR', 'CUSTOM_GENERIC'];
const LEATHER_GOODS: CraftCategory[] = ['SMALL_GOODS', 'BAG'];

export const GLOSSARY: GlossaryEntry[] = [
  // Edge finishes
  {
    id: 'raw_edge',
    term: 'Raw edge',
    match: /raw ?edge|\braw\b|clean ?cut|potong rata/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation:
      'Raw edge = the leather edge is left as cut, just tidied. It looks natural and minimal, with the fibres visible; it suits veg-tan. The downside is that the edge can fray slightly with use.',
  },
  {
    id: 'burnished',
    term: 'Burnished edge',
    match: /burnish/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation:
      'Burnished edge = the leather edge is sanded, then rubbed with water or a burnishing gum until smooth and glossy. The result is neat and dense and gets better with time; it suits veg-tan leather best.',
  },
  {
    id: 'edge_paint',
    term: 'Edge paint',
    match: /edge ?paint|cat pinggir|painted edge|pinggir(an)? di-?cat/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation:
      'Edge paint = the leather edge gets several coats of special paint, sanded smooth between coats. The result is sleek and even, and the colour can match or contrast with the leather; it suits chrome-tanned leathers such as Epsom or Saffiano, which cannot be burnished.',
  },
  {
    id: 'turned_edge',
    term: 'Turned edge',
    match: /turned ?edge|lipat pinggir|pinggir(an)? dilipat/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation: 'Turned edge = the leather edge is thinned, folded inward and stitched, so the cut edge is hidden. It looks refined and luxurious and is common on wallets and fashion bags.',
  },
  // Stitching
  {
    id: 'saddle_stitch',
    term: 'Saddle stitch',
    match: /saddle ?stitch|jahit(an)? (tangan|manual)|hand ?stitch/i,
    categories: LEATHER_GOODS,
    topic: 'thread',
    explanation:
      'Saddle stitch = hand stitching with two needles that lock the thread in every hole. It is far stronger than machine stitching: if one thread breaks, the seam does not unravel.',
  },
  {
    id: 'diamond_stitch',
    term: 'Diamond stitch',
    match: /diamond ?stitch/i,
    categories: LEATHER_GOODS,
    topic: 'thread',
    explanation: 'Diamond stitch = saddle stitching made with diamond-shaped irons, so the stitches sit at a neat slant like a chain. It looks classic and premium.',
  },
  // Leathers & textures
  {
    id: 'veg_tan',
    term: 'Veg-tan (vegetable-tanned leather)',
    match: /veg[\s-]?tan|vegetable[\s-]?tann\w*|nabati/i,
    categories: LEATHER,
    topic: 'material',
    explanation:
      'Veg-tan = leather tanned with plant tannins from tree bark. It starts out fairly firm, then darkens and gains a glow with use (patina). It can be burnished and embossed.',
  },
  {
    id: 'chrome_tan',
    term: 'Chrome-tan',
    match: /chrome[\s-]?tan/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Chrome-tan = leather tanned with minerals (chromium). It is more supple and water-resistant, holds its colour and comes in many colours, but it does not develop a patina and its edges are usually painted.',
  },
  {
    id: 'epsom',
    term: 'Epsom',
    match: /epsom/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Epsom = calfskin embossed with a fine grain that is firm and light. It is very scratch-resistant and holds a crisp shape, so it suits bags and wallets that should always look neat.',
  },
  {
    id: 'saffiano',
    term: 'Saffiano',
    match: /saffiano/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Saffiano = leather pressed with a cross-hatch texture and finished with wax. It is highly scratch- and water-resistant, easy to clean, and looks formal.',
  },
  {
    id: 'pull_up',
    term: 'Pull-up / crazy horse',
    match: /pull[\s-]?up|crazy[\s-]?horse/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Pull-up / crazy horse = oil- and wax-rich leather that lightens where it is bent or scratched, and recovers when rubbed. It looks rugged and vintage; scratches become character.',
  },
  {
    id: 'nappa',
    term: 'Nappa',
    match: /nappa|napa/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Nappa = very soft, supple full-grain leather. It feels lovely to the touch and suits linings or soft bags, but scratches more easily.',
  },
  {
    id: 'pebble',
    term: 'Pebble grain',
    match: /pebble|togo|clemence|tekstur (kulit|butir)/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Pebble grain = leather with a larger, softer rounded grain. It hides scratches, feels plush, and lets a bag slouch slightly in a natural way.',
  },
  {
    id: 'full_grain',
    term: 'Full grain / top grain',
    match: /full ?grain|top ?grain|genuine leather|split leather/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Full grain = the complete top layer of the hide (the strongest, and it develops a patina). Top grain = full grain with the surface sanded or pressed for uniformity. "Genuine / split" = the lower layers, the lowest quality.',
  },
  {
    id: 'exotic',
    term: 'Exotic leather',
    match: /croc|alligator|exotic|buaya|python|ular|ostrich|burung unta|lizard|biawak|stingray|pari/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Exotic leathers (crocodile, python, ostrich and so on) come from specialist CITES-certified tanneries. They cost considerably more and need about 3-4 extra weeks of sourcing.',
  },
  {
    id: 'lining',
    term: 'Lining',
    match: /\blining\b|furing|pelapis dalam/i,
    categories: LEATHER_GOODS,
    topic: 'lining',
    explanation: 'Lining = the inner layer of the piece. It can be thin leather, suede (soft, luxurious) or canvas (light, strong). Unlined keeps the piece slimmer and shows the inside of the leather.',
  },
  {
    id: 'emboss',
    term: 'Emboss / engraving',
    match: /emboss|grafir|engrav|ukir|hot ?stamp|debossed?/i,
    categories: LEATHER_GOODS,
    topic: 'personalization',
    explanation:
      'Emboss = letters or a logo pressed raised or recessed into the leather with a heated stamp (blind, with no colour, or with gold / silver foil). Laser engraving = a pattern or text burned in by laser, good for detailed artwork such as batik.',
  },
  // Footwear
  {
    id: 'goodyear',
    term: 'Goodyear welt',
    match: /goodyear|welt/i,
    categories: ['FOOTWEAR'],
    topic: 'sole',
    explanation: 'Goodyear welt = the sole is stitched to a leather strip (the welt) that is stitched to the upper. It is very sturdy and water-resistant, and the sole can be replaced (resoled) many times.',
  },
  {
    id: 'blake',
    term: 'Blake stitch',
    match: /blake/i,
    categories: ['FOOTWEAR'],
    topic: 'sole',
    explanation: 'Blake stitch = the sole is stitched straight through to the insole. It is slimmer and more flexible than a Goodyear welt, but less water-resistant.',
  },
  // Furniture
  {
    id: 'mortise',
    term: 'Mortise & tenon joint',
    match: /mortise|tenon|purus/i,
    categories: ['FURNITURE'],
    topic: 'joinery',
    explanation: 'Mortise & tenon = the end of one piece of wood is shaped into a "tongue" that fits into a matching hole and is glued. It is the strongest, longest-lasting joint for solid-wood furniture, but it cannot be taken apart.',
  },
  {
    id: 'knock_down',
    term: 'Knock-down',
    match: /knock ?down|bongkar pasang/i,
    categories: ['FURNITURE'],
    topic: 'joinery',
    explanation: 'Knock-down = furniture joined with bolts or special fittings so it can be taken apart and reassembled. Easy to ship and move, slightly less rigid than mortise & tenon.',
  },
  {
    id: 'finishing_wood',
    term: 'Wood finishes',
    match: /natural oil|danish oil|pu varnish|politur|finishing kayu|wood finish\w*/i,
    categories: ['FURNITURE'],
    topic: 'finish',
    explanation:
      'Natural oil = oil soaks into the grain for a natural, matte look and needs re-oiling from time to time. PU = a hard varnish coat that resists water and scratches. Duco = opaque paint (a solid colour, the grain is not visible).',
  },
  {
    id: 'hpl',
    term: 'HPL',
    match: /\bhpl\b|high[\s-]?pressure laminat/i,
    categories: ['FURNITURE'],
    topic: 'board_finish',
    explanation:
      'HPL (high-pressure laminate) = a thin sheet pressed onto the cabinet surface. It comes in wood, marble or solid-colour patterns, resists scratches and is easy to clean. It is the most common finish for kitchens and built-in wardrobes.',
  },
  {
    id: 'duco_melamic',
    term: 'Duco / melamic',
    match: /duco|melamic|melamin/i,
    categories: ['FURNITURE'],
    topic: 'board_finish',
    explanation:
      'Duco = layered spray paint for a smooth, grain-free finish in any colour (matte or glossy); it costs more and needs protecting from knocks. Melamic = a clear lacquer that keeps the natural wood grain visible; it suits veneer or solid-wood surfaces.',
  },
  {
    id: 'board_core',
    term: 'Plywood vs blockboard',
    match: /plywood|multiplek\w*|block ?board|\bmdf\b/i,
    categories: ['FURNITURE'],
    topic: 'material',
    explanation:
      'Plywood = thin wood sheets layered together; it holds screws well and resists moisture better, so it suits kitchens. Blockboard = a core of wood strips with a veneer; lighter and more economical, good for wardrobes and shelving in dry areas. MDF = pressed wood fibre with a smooth surface for paint, but not water-resistant.',
  },
  {
    id: 'soft_close',
    term: 'Soft-close',
    match: /soft[\s-]?clos\w*|slow ?motion|engsel hidrolik/i,
    categories: ['FURNITURE'],
    topic: 'hardware',
    explanation:
      'Soft-close = door hinges and drawer rails with dampers, so they close slowly by themselves without slamming. They last longer in daily use; premium fittings such as Blum or Hafele are the smoothest and most durable.',
  },
  {
    id: 'countertop',
    term: 'Countertop',
    match: /top ?table|counter ?top|solid ?surface|granit\w*|marmer|marble|sintered/i,
    categories: ['FURNITURE'],
    topic: 'countertop',
    explanation:
      'Countertop = the work surface of the kitchen. Granite resists heat and scratches best; marble is more luxurious but stains easily; solid surface is seamless and can be shaped, but handles direct heat less well.',
  },
];

export function findGlossary(text: string, category?: CraftCategory): GlossaryEntry[] {
  return GLOSSARY.filter((g) => g.match.test(text) && (!category || g.categories.includes(category)));
}

/**
 * Does the burst ask something the assistant should answer? "?" anywhere, or English / Indonesian question forms
 * ("what is", "difference between", "kayak gimana", "apa itu", "bedanya apa", "apakah", "maksudnya").
 */
export const QUESTION =
  /\?|\b(gimana|bagaimana|kayak apa|seperti apa|apa itu|apa sih|apakah|bedanya|perbedaan|maksudnya|artinya|kenapa|mengapa|bisa ga|bisa nggak|bisa gak|mana yang|lebih bagus|rekomendasi(nya)?|what(?:'s| is| are| does)|how (?:does|do|would|is)|difference between|which (?:one|is better)|explain)\b/i;

/** "X itu kayak gimana?", "bedanya apa?": the client wants an explanation, NOT stating a choice. */
export const ASKS_EXPLANATION = /(kayak|seperti) (apa|gimana)|apa itu|apa sih|bedanya|perbedaan|maksudnya( apa)?\?|artinya|itu (gimana|bagaimana)|gimana (bentuk|hasil|tampilan)|what(?:'s| is| are) (?:a |an |the )?\w|what does .{1,30} mean|difference between|how does .{1,30} look|what .{1,20} look like|explain/i;

/** "Bisa bikin meja jati...?" is a request phrased as a question, not something to explain. */
export const REQUEST_AS_QUESTION = /^(?:(?:mas|kak|min|gan|sis|halo|hai|permisi|pak|bu)\b[\s,]*)*(?:apakah\s+)?(?:bisa|boleh|mau)\b[^?]{0,40}\b(bikin|buat|pesan|order|custom|request|minta)\b|^(?:(?:hi|hello|hey)\b[\s,!]*)*(?:can|could|would|do) you\b[^?]{0,40}\b(make|craft|build|do|create)\b/i;

/** Drop "explain this term" sentences before parsing attributes, so asking about raw edge doesn't choose raw edge. */
export function withoutExplanationQuestions(text: string): string {
  return text
    .split(/(?<=[?.!])\s+|\n+/)
    .filter((t) => !(QUESTION.test(t) && ASKS_EXPLANATION.test(t)))
    .join('\n');
}

/** Asking for price / timeline only: answered by the crafter's quote, so it never blocks the spec card. */
export const PRICE_OR_TIMELINE = /\b(berapa|harga\w*|biaya\w*|ongkos|kapan (jadi|selesai)|berapa lama|estimasi waktu|lead time|how much|price|pricing|cost\w*|how long|when (will|can) it be (ready|done)|turnaround)\b/i;

/**
 * Requests outside what the workshop quotes from its schemas and glossary: electronics, safety certifications, regulated
 * materials... These go to a human (FULL_MANUAL, CLIENT_REQUEST) instead of being guessed at.
 */
export const NON_STANDARD =
  /\b(led|lampu(?! meja)|elektronik|baterai|battery|charger built[\s-]?in|usb (port|built)|wireless charg|gps|tracker built|chip|nfc|rfid chip|anti[\s-]?peluru|bullet ?proof|tahan api|fire ?proof|tahan peluru|sertifikat (sni|halal|medis)|kulit (manusia|harimau|gajah|penyu|trenggiling)|gading|ivory|bergerak sendiri|motor(ized)?|robot|sensor)\b/i;
