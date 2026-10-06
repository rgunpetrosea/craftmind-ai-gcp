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
  /** Short, client-friendly explanation in Bahasa Indonesia. */
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
      'Raw edge = pinggiran kulit dibiarkan apa adanya setelah dipotong, hanya dirapikan. Tampilannya natural dan minimalis, serat kulitnya kelihatan; cocok untuk veg-tan. Kekurangannya pinggiran bisa sedikit berbulu seiring pemakaian.',
  },
  {
    id: 'burnished',
    term: 'Burnished edge',
    match: /burnish/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation:
      'Burnished edge = pinggiran kulit diamplas lalu digosok dengan air/tokonole sampai licin dan mengilap. Hasilnya rapi, padat, dan makin bagus seiring waktu; paling cocok untuk kulit veg-tan.',
  },
  {
    id: 'edge_paint',
    term: 'Edge paint',
    match: /edge ?paint|cat pinggir|painted edge|pinggir(an)? di-?cat/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation:
      'Edge paint = pinggiran kulit dilapisi cat khusus beberapa lapis lalu diamplas halus. Hasilnya mulus, rata, dan warnanya bisa disamakan atau dikontraskan dengan kulit; cocok untuk kulit chrome-tan seperti Epsom atau Saffiano yang tidak bisa di-burnish.',
  },
  {
    id: 'turned_edge',
    term: 'Turned edge',
    match: /turned ?edge|lipat pinggir|pinggir(an)? dilipat/i,
    categories: LEATHER_GOODS,
    topic: 'edge',
    explanation: 'Turned edge = pinggiran kulit ditipiskan lalu dilipat ke dalam dan dijahit, sehingga ujung potongan tidak terlihat. Tampilannya halus dan mewah, sering dipakai di dompet dan tas fashion.',
  },
  // Stitching
  {
    id: 'saddle_stitch',
    term: 'Saddle stitch',
    match: /saddle ?stitch|jahit(an)? (tangan|manual)|hand ?stitch/i,
    categories: LEATHER_GOODS,
    topic: 'thread',
    explanation:
      'Saddle stitch = jahitan tangan dengan dua jarum yang saling mengunci di setiap lubang. Jauh lebih kuat dari jahitan mesin: kalau satu benang putus, jahitan tidak terurai.',
  },
  {
    id: 'diamond_stitch',
    term: 'Diamond stitch',
    match: /diamond ?stitch/i,
    categories: LEATHER_GOODS,
    topic: 'thread',
    explanation: 'Diamond stitch = saddle stitch dengan pahat berbentuk wajik sehingga jahitannya terlihat miring rapi seperti rantai. Kesannya klasik dan premium.',
  },
  // Leathers & textures
  {
    id: 'veg_tan',
    term: 'Veg-tan (kulit samak nabati)',
    match: /veg[\s-]?tan|nabati/i,
    categories: LEATHER,
    topic: 'material',
    explanation:
      'Veg-tan = kulit yang disamak dengan bahan nabati (tanin kulit kayu). Awalnya agak kaku, lalu warnanya makin gelap dan mengilap seiring pemakaian (patina). Bisa di-burnish dan di-emboss.',
  },
  {
    id: 'chrome_tan',
    term: 'Chrome-tan',
    match: /chrome[\s-]?tan/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Chrome-tan = kulit samak mineral (krom). Lebih lentur, tahan air, warnanya stabil dan pilihan warnanya banyak, tapi tidak membentuk patina dan pinggirannya biasanya di-edge paint.',
  },
  {
    id: 'epsom',
    term: 'Epsom',
    match: /epsom/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Epsom = kulit sapi ber-tekstur emboss butiran halus yang kaku dan ringan. Sangat tahan gores dan bentuknya tegas, jadi cocok untuk tas/dompet yang ingin tetap rapi.',
  },
  {
    id: 'saffiano',
    term: 'Saffiano',
    match: /saffiano/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Saffiano = kulit dengan tekstur garis silang yang dipres dan dilapisi wax. Sangat tahan gores dan air, mudah dibersihkan, tampilannya formal.',
  },
  {
    id: 'pull_up',
    term: 'Pull-up / crazy horse',
    match: /pull[\s-]?up|crazy[\s-]?horse/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Pull-up / crazy horse = kulit berminyak-wax yang warnanya memudar terang saat ditekuk atau digores, lalu bisa kembali saat digosok. Kesannya rugged dan vintage; goresan jadi karakter.',
  },
  {
    id: 'nappa',
    term: 'Nappa',
    match: /nappa|napa/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Nappa = kulit full-grain yang sangat lembut dan lemas. Nyaman disentuh, cocok untuk lining atau tas lembut, tapi lebih mudah tergores.',
  },
  {
    id: 'pebble',
    term: 'Pebble grain',
    match: /pebble|togo|clemence|tekstur (kulit|butir)/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Pebble grain (mis. Togo/Clemence) = kulit dengan butiran bulat yang lebih besar dan lembut. Menyamarkan goresan, terasa empuk, dan membuat tas sedikit melorot natural.',
  },
  {
    id: 'full_grain',
    term: 'Full grain / top grain',
    match: /full ?grain|top ?grain|genuine leather|split leather/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Full grain = lapisan kulit paling atas yang utuh (paling kuat dan bisa berpatina). Top grain = full grain yang permukaannya diamplas/dipres agar seragam. "Genuine/split" = lapisan bawah, kualitas paling rendah.',
  },
  {
    id: 'exotic',
    term: 'Kulit eksotis',
    match: /croc|buaya|python|ular|ostrich|burung unta|lizard|biawak|stingray|pari/i,
    categories: LEATHER,
    topic: 'material',
    explanation: 'Kulit eksotis (buaya, python, ostrich, dll.) didatangkan dari penyamak khusus bersertifikat CITES. Harganya jauh lebih tinggi dan butuh waktu sourcing tambahan sekitar 3–4 minggu.',
  },
  {
    id: 'lining',
    term: 'Lining',
    match: /\blining\b|furing|pelapis dalam/i,
    categories: LEATHER_GOODS,
    topic: 'lining',
    explanation: 'Lining = lapisan dalam produk. Bisa kulit tipis, suede (lembut, mewah) atau kanvas (ringan, kuat). Tanpa lining (unlined) membuat produk lebih tipis dan sisi dalam kulit terlihat.',
  },
  {
    id: 'emboss',
    term: 'Emboss / grafir',
    match: /emboss|grafir|engrav|ukir|hot ?stamp|debossed?/i,
    categories: LEATHER_GOODS,
    topic: 'personalization',
    explanation:
      'Emboss = huruf/logo dicetak timbul atau tenggelam di kulit dengan stamp panas (blind tanpa warna atau dengan foil emas/perak). Laser engraving = motif/teks dibakar laser, cocok untuk gambar detail seperti batik.',
  },
  // Footwear
  {
    id: 'goodyear',
    term: 'Goodyear welt',
    match: /goodyear|welt/i,
    categories: ['FOOTWEAR'],
    topic: 'sole',
    explanation: 'Goodyear welt = sol dijahit ke strip kulit (welt) yang dijahit ke upper. Sangat kokoh, tahan air, dan solnya bisa diganti (resole) berkali-kali.',
  },
  {
    id: 'blake',
    term: 'Blake stitch',
    match: /blake/i,
    categories: ['FOOTWEAR'],
    topic: 'sole',
    explanation: 'Blake stitch = sol dijahit langsung menembus insole. Lebih ramping dan lentur dari Goodyear, tapi kurang tahan air.',
  },
  // Furniture
  {
    id: 'mortise',
    term: 'Sambungan purus (mortise & tenon)',
    match: /mortise|tenon|purus/i,
    categories: ['FURNITURE'],
    topic: 'joinery',
    explanation: 'Purus (mortise & tenon) = ujung kayu dibentuk "lidah" yang masuk ke lubang pasangannya lalu dilem. Sambungan paling kuat dan awet untuk furnitur kayu solid, tapi tidak bisa dibongkar.',
  },
  {
    id: 'knock_down',
    term: 'Knock-down',
    match: /knock ?down|bongkar pasang/i,
    categories: ['FURNITURE'],
    topic: 'joinery',
    explanation: 'Knock-down = furnitur disambung dengan baut/fitting khusus sehingga bisa dibongkar-pasang. Mudah dikirim dan dipindah, sedikit kurang kaku dibanding purus.',
  },
  {
    id: 'finishing_wood',
    term: 'Finishing kayu',
    match: /natural oil|danish oil|pu varnish|politur|finishing kayu/i,
    categories: ['FURNITURE'],
    topic: 'finish',
    explanation:
      'Natural oil = minyak meresap ke serat, tampilan alami dan doff, perlu dirawat ulang berkala. PU = lapisan pernis yang keras dan tahan air/goresan. Duco = cat tertutup (warna solid, serat kayu tidak terlihat).',
  },
  {
    id: 'hpl',
    term: 'HPL',
    match: /\bhpl\b|high[\s-]?pressure laminat/i,
    categories: ['FURNITURE'],
    topic: 'board_finish',
    explanation:
      'HPL (high pressure laminate) = lembaran lapisan tipis yang dipres ke permukaan kabinet. Pilihan motif kayu, marmer atau warna solid; tahan gores dan mudah dibersihkan. Paling umum untuk kitchen set dan lemari built-in.',
  },
  {
    id: 'duco_melamic',
    term: 'Duco / melamic',
    match: /duco|melamic|melamin/i,
    categories: ['FURNITURE'],
    topic: 'board_finish',
    explanation:
      'Duco = cat semprot berlapis yang hasilnya mulus tanpa serat, warnanya bebas (doff atau glossy); lebih mahal dan perlu perawatan dari benturan. Melamic = pernis bening, serat kayu aslinya tetap terlihat; cocok kalau permukaannya veneer atau kayu.',
  },
  {
    id: 'board_core',
    term: 'Plywood vs blockboard',
    match: /plywood|multiplek\w*|block ?board|\bmdf\b/i,
    categories: ['FURNITURE'],
    topic: 'material',
    explanation:
      'Plywood (multipleks) = lembaran kayu tipis berlapis-lapis, kuat menahan sekrup dan lebih tahan lembap; cocok untuk kitchen set. Blockboard = inti potongan kayu yang dilapis, lebih ringan dan ekonomis, pas untuk lemari dan rak di area kering. MDF = serbuk kayu dipres, permukaan halus untuk duco tapi tidak tahan air.',
  },
  {
    id: 'soft_close',
    term: 'Soft-close',
    match: /soft[\s-]?clos\w*|slow ?motion|engsel hidrolik/i,
    categories: ['FURNITURE'],
    topic: 'hardware',
    explanation:
      'Soft-close = engsel pintu dan rel laci dengan peredam, jadi menutup pelan sendiri tanpa bunyi banting. Lebih awet untuk pemakaian harian; merek premium seperti Blum atau Hafele paling halus dan tahan lama.',
  },
  {
    id: 'countertop',
    term: 'Top table',
    match: /top ?table|solid ?surface|granit|marmer|sintered/i,
    categories: ['FURNITURE'],
    topic: 'countertop',
    explanation:
      'Top table = meja atas kitchen set. Granit paling tahan panas dan gores; marmer lebih mewah tapi mudah bernoda; solid surface mulus tanpa sambungan dan bisa dibentuk, tapi kurang tahan panas langsung.',
  },
];

export function findGlossary(text: string, category?: CraftCategory): GlossaryEntry[] {
  return GLOSSARY.filter((g) => g.match.test(text) && (!category || g.categories.includes(category)));
}

/**
 * Does the burst ask something the assistant should answer? "?" anywhere, or Indonesian question forms
 * ("kayak gimana", "apa itu", "bedanya apa", "apakah", "maksudnya").
 */
export const QUESTION =
  /\?|\b(gimana|bagaimana|kayak apa|seperti apa|apa itu|apa sih|apakah|bedanya|perbedaan|maksudnya|artinya|kenapa|mengapa|bisa ga|bisa nggak|bisa gak|mana yang|lebih bagus|rekomendasi(nya)?)\b/i;

/** "X itu kayak gimana?", "bedanya apa?": the client wants an explanation, NOT stating a choice. */
export const ASKS_EXPLANATION = /(kayak|seperti) (apa|gimana)|apa itu|apa sih|bedanya|perbedaan|maksudnya( apa)?\?|artinya|itu (gimana|bagaimana)|gimana (bentuk|hasil|tampilan)/i;

/** "Bisa bikin meja jati...?" is a request phrased as a question, not something to explain. */
export const REQUEST_AS_QUESTION = /^(?:(?:mas|kak|min|gan|sis|halo|hai|permisi|pak|bu)\b[\s,]*)*(?:apakah\s+)?(?:bisa|boleh|mau)\b[^?]{0,40}\b(bikin|buat|pesan|order|custom|request|minta)\b/i;

/** Drop "explain this term" sentences before parsing attributes, so asking about raw edge doesn't choose raw edge. */
export function withoutExplanationQuestions(text: string): string {
  return text
    .split(/(?<=[?.!])\s+|\n+/)
    .filter((t) => !(QUESTION.test(t) && ASKS_EXPLANATION.test(t)))
    .join('\n');
}

/** Asking for price / timeline only: answered by the crafter's quote, so it never blocks the spec card. */
export const PRICE_OR_TIMELINE = /\b(berapa|harga\w*|biaya\w*|ongkos|kapan (jadi|selesai)|berapa lama|estimasi waktu|lead time)\b/i;

/**
 * Requests outside what the workshop quotes from its schemas and glossary: electronics, safety certifications, regulated
 * materials... These go to a human (FULL_MANUAL, CLIENT_REQUEST) instead of being guessed at.
 */
export const NON_STANDARD =
  /\b(led|lampu(?! meja)|elektronik|baterai|battery|charger built[\s-]?in|usb (port|built)|wireless charg|gps|tracker built|chip|nfc|rfid chip|anti[\s-]?peluru|bullet ?proof|tahan api|fire ?proof|tahan peluru|sertifikat (sni|halal|medis)|kulit (manusia|harimau|gajah|penyu|trenggiling)|gading|ivory|bergerak sendiri|motor(ized)?|robot|sensor)\b/i;
