import type { CraftCategory, DesignDirection } from '@/lib/types';

/**
 * Abstract design-direction framework (Design Intelligence Layer v2, sections 6 and 8). These ten design languages are
 * the ONLY style options a client ever sees: never a designer brand name. Each card says what the direction feels like,
 * who it fits, its silhouette & material logic, one original feature, the practical benefit and the trade-off.
 * Customer-facing text is Indonesian; `dna` and the `*_en` texts go into the image prompt (abstract principles only).
 *
 * Client-safe (no server imports): the dashboard renders the same cards.
 */

export type DirectionFamily = 'BAG' | 'SMALL_GOODS' | 'FURNITURE' | 'GENERIC';

export const familyOf = (category: CraftCategory): DirectionFamily =>
  category === 'BAG' || category === 'SMALL_GOODS' || category === 'FURNITURE' ? category : 'GENERIC';

interface Bilingual {
  id: string;
  en: string;
}

export interface DirectionDef {
  id: Exclude<DesignDirection, 'UNSPECIFIED'>;
  /** Design-language name (dashboard, prompts); never a brand. */
  name: string;
  /** Customer-facing label: a practical visual feel in plain Indonesian ("Kalem & Tanpa Logo"). */
  feel: string;
  /** One short sentence for the WhatsApp card. */
  pitch: string;
  /** How a client picks it in their own words when answering the cards ("yang kalem aja"). */
  answer_words: RegExp;
  personality: string;
  use_fit: string;
  benefit: string;
  trade_off: string;
  /** Abstract principles for the image prompt. */
  dna: string;
  silhouette: Record<'LEATHER' | 'FURNITURE' | 'GENERIC', string>;
  original_feature: Record<DirectionFamily, Bilingual>;
  /** Explicit mentions in the client's words (names only; loose adjectives like "klasik" are not a choice). */
  words: RegExp;
}

export const DIRECTIONS: DirectionDef[] = [
  {
    id: 'QUIET_LUXURY',
    name: 'Quiet Luxury',
    feel: 'Kalem & Tanpa Logo',
    pitch: 'bersih dan kalem, kualitas bahannya yang menonjol',
    answer_words: /kalem|tanpa logo|polos/i,
    personality: 'kalem dan timeless, menonjolkan kualitas material tanpa banyak ornamen',
    use_fit: 'cocok dipakai lama di banyak suasana, dari kantor sampai acara',
    benefit: 'nggak cepat ketinggalan zaman dan makin cantik seiring waktu',
    trade_off: 'kesannya tenang, kurang pas kalau mau tampil mencolok',
    dna: 'material-led restraint: uninterrupted panels of fine material, tonal stitching, near-invisible hardware, softly radiused corners, no visible branding, timeless proportions',
    silhouette: {
      LEATHER: 'siluet bersih dengan panel kulit utuh, hardware minim dan senada',
      FURNITURE: 'bentuk sederhana dengan serat kayu utuh sebagai pusat perhatian',
      GENERIC: 'bentuk sederhana dengan finishing material yang sangat rapi',
    },
    original_feature: {
      BAG: { id: 'flap dengan lipatan lembut dan kunci magnet tersembunyi, tanpa hardware terlihat', en: 'a softly folded flap with a concealed magnetic closure and no visible hardware' },
      SMALL_GOODS: { id: 'panel luar satu lembar utuh tanpa sambungan, jahitan tangan senada di tepi', en: 'a single seamless outer panel with tonal hand-stitching along the edge' },
      FURNITURE: { id: 'serat kayu menyambung di semua bidang depan dengan pegangan tersembunyi', en: 'continuous book-matched grain across the fronts with concealed finger-pull grips' },
      GENERIC: { id: 'detail minimal dengan permukaan material yang sangat rapi', en: 'minimal detailing with an impeccably finished material surface' },
    },
    words: /quiet[\s-]?luxury|kemewahan (yang )?(tenang|kalem)/i,
  },
  {
    id: 'STRUCTURED_ELEGANCE',
    name: 'Structured Elegance',
    feel: 'Bentuk Tegas & Klasik',
    pitch: 'garis rapi dan kokoh, pas buat kerja dan acara formal',
    answer_words: /tegas|kokoh|formal/i,
    personality: 'rapi, tegas, dan profesional dengan geometri yang presisi',
    use_fit: 'pas untuk kerja, meeting, dan acara formal',
    benefit: 'bentuknya tetap tegak dan terlihat rapi setiap saat',
    trade_off: 'lebih kaku dan sedikit lebih berat dibanding model lembut',
    dna: 'precise geometry: crisp straight edges, firm self-supporting panels, sharp folded or piped edges, symmetrical balance, confident proportion, restrained polished hardware',
    silhouette: {
      LEATHER: 'badan kaku yang berdiri sendiri dengan garis lurus dan sudut tegas',
      FURNITURE: 'garis lurus presisi dengan proporsi simetris',
      GENERIC: 'garis tegas dengan proporsi simetris',
    },
    original_feature: {
      BAG: { id: 'lis tepi tipis yang menegaskan garis badan, dengan gusset bertingkat', en: 'a fine tonal piped edge tracing the body outline with a stepped gusset' },
      SMALL_GOODS: { id: 'tepi dilipat tajam (turned edge) dengan sudut presisi', en: 'razor-sharp turned edges with precise mitred corners' },
      FURNITURE: { id: 'bingkai tegas dengan celah bayangan presisi di setiap panel', en: 'a crisp frame with precise shadow-gap reveals around every panel' },
      GENERIC: { id: 'garis tegas dengan celah dan sambungan yang presisi', en: 'crisp lines with precise gaps and seams' },
    },
    words: /structured[\s-]?elegan\w*|elegan (yang )?terstruktur/i,
  },
  {
    id: 'CONTEMPORARY_ARTISAN',
    name: 'Contemporary Artisan',
    feel: 'Hangat & Handmade',
    pitch: 'jahitan tangan dan detail pengerjaannya kelihatan',
    answer_words: /hangat|handmade|buatan tangan/i,
    personality: 'hangat dan handmade, proses pembuatannya terlihat dan terasa',
    use_fit: 'untuk yang suka barang berkarakter dengan cerita di baliknya',
    benefit: 'setiap jahitan dan tepi menunjukkan kerja tangan crafter',
    trade_off: 'tampilannya lebih kasual dibanding gaya formal',
    dna: 'visible making: prominent hand saddle stitching, hand-burnished edges, warm natural tones, tactile grain, honest construction details as the decoration',
    silhouette: {
      LEATHER: 'bentuk santai yang memperlihatkan jahitan tangan dan tepi kulit yang dipoles',
      FURNITURE: 'sambungan kayu terlihat sebagai elemen desain',
      GENERIC: 'detail kerja tangan yang sengaja diperlihatkan',
    },
    original_feature: {
      BAG: { id: 'jahitan tangan kontras yang membingkai panel depan, tepi dipoles manual', en: 'a contrast hand saddle-stitched frame around the front panel with hand-burnished edges' },
      SMALL_GOODS: { id: 'jahitan tangan kontras yang mengikuti sudut melengkung', en: 'contrast hand saddle stitching following softly curved corners' },
      FURNITURE: { id: 'sambungan ekor burung atau purus tembus yang sengaja diperlihatkan', en: 'exposed dovetail or through-tenon joints celebrated as the main detail' },
      GENERIC: { id: 'detail kerja tangan yang sengaja diperlihatkan', en: 'deliberately visible handwork details' },
    },
    words: /contemporary[\s-]?artisan|artisan/i,
  },
  {
    id: 'MODERN_MINIMALISM',
    name: 'Modern Minimalism',
    feel: 'Simpel & Modern',
    pitch: 'garis bersih, ringan dilihat, gampang dipadukan',
    answer_words: /simpel|simple|modern/i,
    personality: 'garis bersih dan fungsional, tanpa elemen yang tidak perlu',
    use_fit: 'cocok untuk gaya hidup modern yang praktis',
    benefit: 'ringan dilihat dan gampang dipadukan dengan apa saja',
    trade_off: 'detail dekoratifnya sangat sedikit',
    dna: 'reduction: clean planar surfaces, minimal seams, flush or hidden closures, functional clarity, generous negative space, a calm monochrome palette',
    silhouette: {
      LEATHER: 'bentuk geometris sederhana dengan sambungan seminimal mungkin',
      FURNITURE: 'bidang datar bersih dengan pegangan tersembunyi',
      GENERIC: 'bidang bersih dengan detail fungsional tersembunyi',
    },
    original_feature: {
      BAG: { id: 'badan dari satu potong kulit yang dilipat, handle menyatu tanpa ring logam', en: 'a body cut and folded from one leather piece with handles integrated without metal rings' },
      SMALL_GOODS: { id: 'tanpa jahitan luar yang terlihat, slot kartu dipotong rata', en: 'no visible outer stitching and flush-cut card slots' },
      FURNITURE: { id: 'pintu dan laci rata tanpa handle, pegangan tersembunyi di tepi atas', en: 'flush handle-less doors and drawers with a concealed top-edge grip' },
      GENERIC: { id: 'bidang bersih dengan detail fungsional tersembunyi', en: 'clean surfaces with concealed functional details' },
    },
    words: /modern[\s-]?minimalis\w*|minimalis\w*|minimalist/i,
  },
  {
    id: 'ARCHITECTURAL',
    name: 'Architectural',
    feel: 'Bentuk Unik & Beda',
    pitch: 'siluetnya khas, gampang dikenali',
    answer_words: /bentuk(nya)? (yang )?unik|beda/i,
    personality: 'seperti karya pahat, bentuknya punya karakter dan proporsi yang khas',
    use_fit: 'untuk yang ingin desain berbeda dan mudah dikenali',
    benefit: 'punya identitas visual yang kuat',
    trade_off: 'bentuk yang unik kadang mengorbankan sedikit kapasitas',
    dna: 'sculptural construction: controlled asymmetry, deliberate curves meeting straight planes, a distinctive cross-section, structural seams used as design lines, balanced visual weight',
    silhouette: {
      LEATHER: 'siluet sculptural dengan lengkung terkontrol dan sedikit asimetri',
      FURNITURE: 'bentuk sculptural dengan kaki atau struktur sebagai pusat perhatian',
      GENERIC: 'bentuk sculptural dengan proporsi khas',
    },
    original_feature: {
      BAG: { id: 'sisi samping melengkung asimetris dengan jahitan struktural sebagai garis desain', en: 'an asymmetric curved side profile where the structural seam becomes the design line' },
      SMALL_GOODS: { id: 'lipatan diagonal dengan potongan tepi melengkung yang khas', en: 'a diagonal fold with a distinctive curved edge cut' },
      FURNITURE: { id: 'kaki miring berbentuk pahatan yang menyatu dengan rangka atas', en: 'sculpted angled legs flowing into the top frame' },
      GENERIC: { id: 'bentuk sculptural dengan proporsi khas', en: 'a sculptural form with a distinctive proportion' },
    },
    words: /architectural|arsitektural|sculptural/i,
  },
  {
    id: 'HERITAGE_CRAFTSMANSHIP',
    name: 'Heritage Craftsmanship',
    feel: 'Klasik & Awet',
    pitch: 'konstruksi tradisional yang kokoh, makin lama makin cantik',
    answer_words: /klasik|awet|tradisional/i,
    personality: 'klasik dan kokoh, konstruksi tradisional dengan pengerjaan halus',
    use_fit: 'untuk barang yang dipakai puluhan tahun, bahkan diwariskan',
    benefit: 'sangat awet dan bisa diperbaiki',
    trade_off: 'lebih berat dan pengerjaannya lebih lama',
    dna: 'traditional construction: fine-pitch hand saddle stitching, burnished edges, honest functional solid brass hardware, enduring classic form, reinforced stress points',
    silhouette: {
      LEATHER: 'bentuk klasik yang teruji dengan konstruksi diperkuat',
      FURNITURE: 'bentuk klasik dengan sambungan kayu tradisional',
      GENERIC: 'konstruksi tradisional yang diperkuat',
    },
    original_feature: {
      BAG: { id: 'gesper kuningan solid yang benar-benar berfungsi di atas tab kulit berlapis jahitan tangan', en: 'a functional solid brass buckle on a layered, hand-stitched leather tab' },
      SMALL_GOODS: { id: 'tepi dipoles lilin berlapis dengan jahitan pelana rapat 3 mm', en: 'wax-burnished edges with tight 3 mm hand saddle stitching' },
      FURNITURE: { id: 'sambungan purus-lubang dengan pasak kayu yang terlihat', en: 'pegged mortise-and-tenon joints with visible wooden pegs' },
      GENERIC: { id: 'konstruksi tradisional yang diperkuat', en: 'reinforced traditional construction' },
    },
    words: /heritage/i,
  },
  {
    id: 'PRACTICAL_LUXURY',
    name: 'Practical Luxury',
    feel: 'Praktis & Rapi di Dalam',
    pitch: 'ringan, isinya tertata, enak dibawa seharian',
    answer_words: /praktis|rapi di dalam|ringan/i,
    personality: 'ringan, serbaguna, dan rapi di dalam',
    use_fit: 'pas untuk mobilitas tinggi dan traveling',
    benefit: 'isinya tertata dan nyaman dibawa seharian',
    trade_off: 'lebih fokus ke fungsi daripada bentuk yang statement',
    dna: 'versatile lightness: lightweight construction, smart interior organization, comfortable carry, refined but durable finishes, discreet functional hardware',
    silhouette: {
      LEATHER: 'badan semi-terstruktur yang ringan dengan organisasi interior yang cerdas',
      FURNITURE: 'rancangan fungsional dengan penyimpanan yang efisien',
      GENERIC: 'organisasi fungsional yang ringkas',
    },
    original_feature: {
      BAG: { id: 'kantong samping tersembunyi untuk akses cepat dan strap berbantalan yang bisa diatur', en: 'a concealed quick-access side pocket and a padded adjustable strap' },
      SMALL_GOODS: { id: 'slot akses cepat di sisi luar untuk kartu yang paling sering dipakai', en: 'an exterior quick-access slot for the most-used card' },
      FURNITURE: { id: 'penyimpanan modular di balik panel dengan aksesori dalam yang bisa diatur', en: 'modular storage behind the panels with adjustable inner fittings' },
      GENERIC: { id: 'organisasi fungsional yang ringkas', en: 'compact functional organization' },
    },
    words: /practical[\s-]?luxury/i,
  },
  {
    id: 'SOFT_CONTEMPORARY',
    name: 'Soft Contemporary',
    feel: 'Lembut & Santai',
    pitch: 'bentuk membulat dan lembut, enak dipakai sehari-hari',
    answer_words: /lembut|santai/i,
    personality: 'santai dan modern, geometrinya lembut dan materialnya enak disentuh',
    use_fit: 'untuk dipakai sehari-hari dengan gaya yang effortless',
    benefit: 'nyaman, ringan, dan terasa modern',
    trade_off: 'bentuknya bisa sedikit melandai saat kosong',
    dna: 'relaxed geometry: soft rounded volumes, supple material that drapes slightly, gathered or pleated details, tactile surfaces, modern ease',
    silhouette: {
      LEATHER: 'volume lembut dengan sudut membulat dan kulit yang jatuh natural',
      FURNITURE: 'sudut membulat dan material lembut yang mengundang disentuh',
      GENERIC: 'bentuk membulat yang lembut',
    },
    original_feature: {
      BAG: { id: 'tepi atas berkerut lembut yang mengalir menyatu ke handle', en: 'a softly gathered top edge that flows into the handle' },
      SMALL_GOODS: { id: 'sudut membulat lebar dengan kulit lembut berlapis', en: 'generous rounded corners in supple layered leather' },
      FURNITURE: { id: 'tepi membulat penuh dengan jok empuk berjahit lembut', en: 'fully rounded edges with softly stitched padded upholstery' },
      GENERIC: { id: 'bentuk membulat yang lembut', en: 'a softly rounded form' },
    },
    words: /soft[\s-]?contemporary/i,
  },
  {
    id: 'EXPRESSIVE_CRAFT',
    name: 'Expressive Craft',
    feel: 'Seni & Unik',
    pitch: 'ada permainan warna atau tekstur yang jadi statement',
    answer_words: /seni|unik|statement|berani/i,
    personality: 'berani, dengan kontras material atau teknik permukaan yang artistik',
    use_fit: 'untuk yang ingin barangnya jadi statement',
    benefit: 'sangat personal dan berbeda dari yang lain',
    trade_off: 'kurang netral untuk dipadukan dengan semua gaya',
    dna: 'bold craft: deliberate material or colour contrast, a surface technique (hand tooling, weaving, painted edge colour), artistic detail anchored by clean construction',
    silhouette: {
      LEATHER: 'bentuk sederhana sebagai kanvas untuk kontras material atau teknik permukaan',
      FURNITURE: 'bentuk sederhana dengan inlay atau permukaan yang artistik',
      GENERIC: 'kontras material atau teknik permukaan artistik',
    },
    original_feature: {
      BAG: { id: 'panel depan dengan teknik anyam atau tooling tangan, dibingkai kulit polos', en: 'a front panel of hand-woven or hand-tooled leather framed in smooth leather' },
      SMALL_GOODS: { id: 'tepi dicat warna kontras dengan panel tekstur dua warna', en: 'contrast-coloured painted edges with a two-tone textured panel' },
      FURNITURE: { id: 'inlay kayu kontras atau ukiran yang dibingkai bidang polos', en: 'a contrasting wood inlay or carving framed by plain surfaces' },
      GENERIC: { id: 'kontras material atau teknik permukaan artistik', en: 'a material contrast or an artistic surface technique' },
    },
    words: /expressive[\s-]?craft|ekspresif/i,
  },
  {
    id: 'MODULAR_UTILITY',
    name: 'Modular Utility',
    feel: 'Bisa Diubah-ubah',
    pitch: 'strap atau kantongnya bisa dilepas-pasang sesuai kebutuhan',
    answer_words: /diubah|lepas[s-]?pasang|fleksibel/i,
    personality: 'adaptif: strap, kompartemen, atau konfigurasinya bisa diubah, tetap rapi',
    use_fit: 'untuk yang butuh satu barang untuk banyak fungsi',
    benefit: 'bisa disesuaikan dengan kebutuhan hari itu',
    trade_off: 'lebih banyak komponen yang perlu dirawat',
    dna: 'adaptable refinement: detachable straps, removable or reconfigurable compartments, clean attachment points, every module finished as carefully as the main body',
    silhouette: {
      LEATHER: 'badan inti dengan modul yang bisa dilepas-pasang secara rapi',
      FURNITURE: 'modul yang bisa disusun ulang',
      GENERIC: 'komponen yang bisa diubah konfigurasinya',
    },
    original_feature: {
      BAG: { id: 'pouch dalam yang bisa dilepas dan strap yang bisa diubah dari bahu ke selempang', en: 'a removable inner pouch and a strap that converts from shoulder to crossbody' },
      SMALL_GOODS: { id: 'insert slot kartu yang bisa dilepas dan dipakai sendiri', en: 'a removable card insert that works on its own' },
      FURNITURE: { id: 'modul yang bisa disusun ulang dengan pengunci tersembunyi', en: 'reconfigurable modules joined by concealed connectors' },
      GENERIC: { id: 'komponen yang bisa diubah konfigurasinya', en: 'reconfigurable components' },
    },
    words: /modular/i,
  },
];

export const DIRECTION_IDS = DIRECTIONS.map((d) => d.id);

export function directionDef(id: DesignDirection | undefined): DirectionDef | undefined {
  return DIRECTIONS.find((d) => d.id === id);
}

export const directionName = (id: DesignDirection | undefined) => directionDef(id)?.name ?? '';

/** The client-facing label ("Kalem & Tanpa Logo"). */
export const directionFeel = (id: DesignDirection | undefined) => directionDef(id)?.feel ?? '';

/**
 * Directions picked by their everyday feel in an answer to the cards ("yang kalem aja", "yang simpel"), in the order
 * mentioned. The cards that were shown are matched first, so "unik" means the shown card it describes.
 */
export function directionsByFeel(text: string, shown: DesignDirection[]): Array<DirectionDef['id']> {
  const hits = (pool: DirectionDef[]) =>
    pool.map((d) => ({ id: d.id, at: text.search(d.answer_words) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);
  const fromShown = hits(DIRECTIONS.filter((d) => shown.includes(d.id)));
  return fromShown.length ? fromShown : hits(DIRECTIONS);
}

/** Categories whose concepts must have an approved direction before the first mockup. */
export const DIRECTION_CATEGORIES: CraftCategory[] = ['BAG', 'SMALL_GOODS', 'FURNITURE'];

export const isDirectionSet = (d: DesignDirection | undefined) => !!d && d !== 'UNSPECIFIED';

/** Directions the client named explicitly ("quiet luxury", "yang modular", "minimalis"), in the order they appear. */
export function directionsNamed(text: string): Array<DirectionDef['id']> {
  return DIRECTIONS.map((d) => ({ id: d.id, at: text.search(d.words) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.id);
}

/** The original feature's client-facing text, and its English prompt form when it came from the catalog. */
export function defaultOriginalFeature(direction: DesignDirection, category: CraftCategory): Bilingual | undefined {
  return directionDef(direction)?.original_feature[familyOf(category)];
}

/**
 * Features that assume a flap don't fit an OPEN-TOP bag (a tote would have to wrap a flap around its handles, which the
 * renders show as handles passing through holes in the flap): open-top bags use these variants instead.
 */
export const OPEN_TOP_BAG_FEATURE: Partial<Record<DirectionDef['id'], Bilingual>> = {
  QUIET_LUXURY: {
    id: 'tepi atas dilipat rapi tanpa hardware terlihat, pegangan dijahit menyatu ke panel badan, tab magnet tersembunyi di bagian dalam',
    en: 'a cleanly folded top edge with no visible hardware, handles stitched seamlessly into the body panels, a concealed magnetic tab inside the opening',
  },
  HERITAGE_CRAFTSMANSHIP: {
    id: 'pangkal pegangan berlapis kulit dengan jahitan tangan berbentuk kotak, diperkuat paku kuningan solid',
    en: 'layered leather handle bases with hand-stitched box-stitch reinforcement and solid brass rivets',
  },
};

/** Every catalog feature text with its English form (direction cards + open-top variants). */
function catalogFeatures(): Bilingual[] {
  return [...DIRECTIONS.flatMap((d) => Object.values(d.original_feature)), ...Object.values(OPEN_TOP_BAG_FEATURE).filter((v): v is Bilingual => !!v)];
}

/** Is this feature text one the catalog wrote (not the client's own idea)? */
export const isCatalogFeature = (feature: string) => catalogFeatures().some((v) => v.id === feature.trim());

/** English prompt text for a stored originality feature (catalog text → its English form; the client's own idea as is). */
export function originalFeaturePrompt(feature: string): string {
  const f = feature.trim();
  return catalogFeatures().find((v) => v.id === f)?.en ?? f;
}

export const silhouetteLogic = (d: DirectionDef, category: CraftCategory) =>
  d.silhouette[category === 'BAG' || category === 'SMALL_GOODS' ? 'LEATHER' : category === 'FURNITURE' ? 'FURNITURE' : 'GENERIC'];
