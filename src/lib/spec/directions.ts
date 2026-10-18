import type { CraftCategory, DesignDirection } from '@/lib/types';

/**
 * Abstract design-direction framework (Design Intelligence Layer v2, sections 6 and 8). These ten design languages are
 * the ONLY style options a client ever sees: never a designer brand name. Each card says what the direction feels like,
 * who it fits, its silhouette & material logic, one original feature, the practical benefit and the trade-off.
 * Customer-facing text is English; `dna` goes into the image prompt (abstract principles only). Clients may still answer
 * in Indonesian: `answer_words` and `words` match both languages.
 *
 * Client-safe (no server imports): the dashboard renders the same cards.
 */

export type DirectionFamily = 'BAG' | 'SMALL_GOODS' | 'FURNITURE' | 'GENERIC';

export const familyOf = (category: CraftCategory): DirectionFamily =>
  category === 'BAG' || category === 'SMALL_GOODS' || category === 'FURNITURE' ? category : 'GENERIC';

/** A catalog feature: `en` is shown to the client and prompted; `legacy_id` is the Indonesian text older specs stored. */
interface CatalogFeature {
  en: string;
  legacy_id: string;
}

export interface DirectionDef {
  id: Exclude<DesignDirection, 'UNSPECIFIED'>;
  /** Design-language name (dashboard, prompts); never a brand. */
  name: string;
  /** Customer-facing label: a practical visual feel in plain words ("Clean & Logo-Free"). */
  feel: string;
  /** One short sentence for the WhatsApp card. */
  pitch: string;
  /** How a client picks it in their own words when answering the cards ("the clean one", "yang kalem aja"). */
  answer_words: RegExp;
  personality: string;
  use_fit: string;
  benefit: string;
  trade_off: string;
  /** Abstract principles for the image prompt. */
  dna: string;
  silhouette: Record<'LEATHER' | 'FURNITURE' | 'GENERIC', string>;
  original_feature: Record<DirectionFamily, CatalogFeature>;
  /** Explicit mentions in the client's words (names only; loose adjectives like "classic" are not a choice). */
  words: RegExp;
}

export const DIRECTIONS: DirectionDef[] = [
  {
    id: 'QUIET_LUXURY',
    name: 'Quiet Luxury',
    feel: 'Clean & Logo-Free',
    pitch: 'clean and understated, the quality of the material does the talking',
    answer_words: /clean|logo[\s-]?free|no logo|understated|kalem|tanpa logo|polos/i,
    personality: 'calm and timeless, letting the material quality lead with very little ornament',
    use_fit: 'made to be used for years in any setting, from the office to evening events',
    benefit: 'never looks dated and gets more beautiful with age',
    trade_off: 'reads as calm, so it is not the pick for a loud statement',
    dna: 'material-led restraint: uninterrupted panels of fine material, tonal stitching, near-invisible hardware, softly radiused corners, no visible branding, timeless proportions',
    silhouette: {
      LEATHER: 'a clean silhouette of whole leather panels with minimal, tonal hardware',
      FURNITURE: 'a simple form with the continuous wood grain as the focal point',
      GENERIC: 'a simple form with an impeccably finished material surface',
    },
    original_feature: {
      BAG: { en: 'a softly folded flap with a concealed magnetic closure and no visible hardware', legacy_id: 'flap dengan lipatan lembut dan kunci magnet tersembunyi, tanpa hardware terlihat' },
      SMALL_GOODS: { en: 'a single seamless outer panel with tonal hand-stitching along the edge', legacy_id: 'panel luar satu lembar utuh tanpa sambungan, jahitan tangan senada di tepi' },
      FURNITURE: { en: 'continuous book-matched grain across the fronts with concealed finger-pull grips', legacy_id: 'serat kayu menyambung di semua bidang depan dengan pegangan tersembunyi' },
      GENERIC: { en: 'minimal detailing with an impeccably finished material surface', legacy_id: 'detail minimal dengan permukaan material yang sangat rapi' },
    },
    words: /quiet[\s-]?luxury|kemewahan (yang )?(tenang|kalem)/i,
  },
  {
    id: 'STRUCTURED_ELEGANCE',
    name: 'Structured Elegance',
    feel: 'Structured & Classic',
    pitch: 'crisp, solid lines that suit work and formal occasions',
    answer_words: /structured|classic|crisp|formal|tegas|kokoh|klasik/i,
    personality: 'neat, confident and professional, with precise geometry',
    use_fit: 'right for work, meetings and formal occasions',
    benefit: 'holds its shape and always looks sharp',
    trade_off: 'stiffer and slightly heavier than a soft design',
    dna: 'precise geometry: crisp straight edges, firm self-supporting panels, sharp folded or piped edges, symmetrical balance, confident proportion, restrained polished hardware',
    silhouette: {
      LEATHER: 'a firm, self-standing body with straight lines and crisp corners',
      FURNITURE: 'precise straight lines with symmetrical proportions',
      GENERIC: 'crisp lines with symmetrical proportions',
    },
    original_feature: {
      BAG: { en: 'a fine tonal piped edge tracing the body outline with a stepped gusset', legacy_id: 'lis tepi tipis yang menegaskan garis badan, dengan gusset bertingkat' },
      SMALL_GOODS: { en: 'razor-sharp turned edges with precise mitred corners', legacy_id: 'tepi dilipat tajam (turned edge) dengan sudut presisi' },
      FURNITURE: { en: 'a crisp frame with precise shadow-gap reveals around every panel', legacy_id: 'bingkai tegas dengan celah bayangan presisi di setiap panel' },
      GENERIC: { en: 'crisp lines with precise gaps and seams', legacy_id: 'garis tegas dengan celah dan sambungan yang presisi' },
    },
    words: /structured[\s-]?elegan\w*|elegan (yang )?terstruktur/i,
  },
  {
    id: 'CONTEMPORARY_ARTISAN',
    name: 'Contemporary Artisan',
    feel: 'Warm & Handmade',
    pitch: 'visible hand-stitching and the maker’s touch in every detail',
    answer_words: /warm|hand[\s-]?made|hand[\s-]?crafted|hangat|buatan tangan/i,
    personality: 'warm and handmade, the making process is visible and felt',
    use_fit: 'for people who love pieces with character and a story behind them',
    benefit: 'every stitch and edge shows the crafter’s handwork',
    trade_off: 'looks more casual than a formal style',
    dna: 'visible making: prominent hand saddle stitching, hand-burnished edges, warm natural tones, tactile grain, honest construction details as the decoration',
    silhouette: {
      LEATHER: 'a relaxed form that shows off hand-stitching and polished leather edges',
      FURNITURE: 'visible wood joinery used as a design element',
      GENERIC: 'handwork details shown on purpose',
    },
    original_feature: {
      BAG: { en: 'a contrast hand saddle-stitched frame around the front panel with hand-burnished edges', legacy_id: 'jahitan tangan kontras yang membingkai panel depan, tepi dipoles manual' },
      SMALL_GOODS: { en: 'contrast hand saddle stitching following softly curved corners', legacy_id: 'jahitan tangan kontras yang mengikuti sudut melengkung' },
      FURNITURE: { en: 'exposed dovetail or through-tenon joints celebrated as the main detail', legacy_id: 'sambungan ekor burung atau purus tembus yang sengaja diperlihatkan' },
      GENERIC: { en: 'deliberately visible handwork details', legacy_id: 'detail kerja tangan yang sengaja diperlihatkan' },
    },
    words: /contemporary[\s-]?artisan|artisan/i,
  },
  {
    id: 'MODERN_MINIMALISM',
    name: 'Modern Minimalism',
    feel: 'Simple & Modern',
    pitch: 'clean lines, light on the eye, easy to pair with anything',
    answer_words: /simple|modern|sleek|simpel/i,
    personality: 'clean, functional lines with nothing unnecessary',
    use_fit: 'suits a practical, modern lifestyle',
    benefit: 'light on the eye and easy to pair with anything',
    trade_off: 'very little decorative detail',
    dna: 'reduction: clean planar surfaces, minimal seams, flush or hidden closures, functional clarity, generous negative space, a calm monochrome palette',
    silhouette: {
      LEATHER: 'a simple geometric form with as few seams as possible',
      FURNITURE: 'clean flat surfaces with concealed grips',
      GENERIC: 'clean surfaces with concealed functional details',
    },
    original_feature: {
      BAG: { en: 'a body cut and folded from one leather piece with handles integrated without metal rings', legacy_id: 'badan dari satu potong kulit yang dilipat, handle menyatu tanpa ring logam' },
      SMALL_GOODS: { en: 'no visible outer stitching and flush-cut card slots', legacy_id: 'tanpa jahitan luar yang terlihat, slot kartu dipotong rata' },
      FURNITURE: { en: 'flush handle-less doors and drawers with a concealed top-edge grip', legacy_id: 'pintu dan laci rata tanpa handle, pegangan tersembunyi di tepi atas' },
      GENERIC: { en: 'clean surfaces with concealed functional details', legacy_id: 'bidang bersih dengan detail fungsional tersembunyi' },
    },
    words: /modern[\s-]?minimalis\w*|minimalis\w*|minimalist/i,
  },
  {
    id: 'ARCHITECTURAL',
    name: 'Architectural',
    feel: 'Bold & Distinctive Shape',
    pitch: 'a signature silhouette that is instantly recognisable',
    answer_words: /bold|distinctive|unique shape|different|bentuk(nya)? (yang )?unik|beda/i,
    personality: 'sculptural, with a shape that has its own character and proportion',
    use_fit: 'for those who want a design that stands apart and is easy to recognise',
    benefit: 'a strong visual identity',
    trade_off: 'a distinctive shape can give up a little capacity',
    dna: 'sculptural construction: controlled asymmetry, deliberate curves meeting straight planes, a distinctive cross-section, structural seams used as design lines, balanced visual weight',
    silhouette: {
      LEATHER: 'a sculptural silhouette with controlled curves and a touch of asymmetry',
      FURNITURE: 'a sculptural form with the legs or structure as the focal point',
      GENERIC: 'a sculptural form with a distinctive proportion',
    },
    original_feature: {
      BAG: { en: 'an asymmetric curved side profile where the structural seam becomes the design line', legacy_id: 'sisi samping melengkung asimetris dengan jahitan struktural sebagai garis desain' },
      SMALL_GOODS: { en: 'a diagonal fold with a distinctive curved edge cut', legacy_id: 'lipatan diagonal dengan potongan tepi melengkung yang khas' },
      FURNITURE: { en: 'sculpted angled legs flowing into the top frame', legacy_id: 'kaki miring berbentuk pahatan yang menyatu dengan rangka atas' },
      GENERIC: { en: 'a sculptural form with a distinctive proportion', legacy_id: 'bentuk sculptural dengan proporsi khas' },
    },
    words: /architectural|arsitektural|sculptural/i,
  },
  {
    id: 'HERITAGE_CRAFTSMANSHIP',
    name: 'Heritage Craftsmanship',
    feel: 'Traditional & Built to Last',
    pitch: 'sturdy traditional construction that ages beautifully',
    answer_words: /traditional|built to last|long[\s-]?lasting|durable|heirloom|awet|tradisional/i,
    personality: 'classic and sturdy, traditional construction with fine workmanship',
    use_fit: 'for pieces used for decades, even handed down',
    benefit: 'extremely durable and repairable',
    trade_off: 'heavier and takes longer to make',
    dna: 'traditional construction: fine-pitch hand saddle stitching, burnished edges, honest functional solid brass hardware, enduring classic form, reinforced stress points',
    silhouette: {
      LEATHER: 'a proven classic form with reinforced construction',
      FURNITURE: 'a classic form with traditional wood joinery',
      GENERIC: 'reinforced traditional construction',
    },
    original_feature: {
      BAG: { en: 'a functional solid brass buckle on a layered, hand-stitched leather tab', legacy_id: 'gesper kuningan solid yang benar-benar berfungsi di atas tab kulit berlapis jahitan tangan' },
      SMALL_GOODS: { en: 'wax-burnished edges with tight 3 mm hand saddle stitching', legacy_id: 'tepi dipoles lilin berlapis dengan jahitan pelana rapat 3 mm' },
      FURNITURE: { en: 'pegged mortise-and-tenon joints with visible wooden pegs', legacy_id: 'sambungan purus-lubang dengan pasak kayu yang terlihat' },
      GENERIC: { en: 'reinforced traditional construction', legacy_id: 'konstruksi tradisional yang diperkuat' },
    },
    words: /heritage/i,
  },
  {
    id: 'PRACTICAL_LUXURY',
    name: 'Practical Luxury',
    feel: 'Practical & Organized',
    pitch: 'light, neatly organized inside, comfortable to carry all day',
    answer_words: /practical|organi[sz]ed|lightweight|praktis|rapi di dalam|ringan/i,
    personality: 'light, versatile and neatly organized inside',
    use_fit: 'made for people on the move and for travel',
    benefit: 'everything has its place and it is comfortable all day',
    trade_off: 'puts function ahead of a statement shape',
    dna: 'versatile lightness: lightweight construction, smart interior organization, comfortable carry, refined but durable finishes, discreet functional hardware',
    silhouette: {
      LEATHER: 'a light, semi-structured body with smart interior organization',
      FURNITURE: 'a functional design with efficient storage',
      GENERIC: 'compact functional organization',
    },
    original_feature: {
      BAG: { en: 'a concealed quick-access side pocket and a padded adjustable strap', legacy_id: 'kantong samping tersembunyi untuk akses cepat dan strap berbantalan yang bisa diatur' },
      SMALL_GOODS: { en: 'an exterior quick-access slot for the most-used card', legacy_id: 'slot akses cepat di sisi luar untuk kartu yang paling sering dipakai' },
      FURNITURE: { en: 'modular storage behind the panels with adjustable inner fittings', legacy_id: 'penyimpanan modular di balik panel dengan aksesori dalam yang bisa diatur' },
      GENERIC: { en: 'compact functional organization', legacy_id: 'organisasi fungsional yang ringkas' },
    },
    words: /practical[\s-]?luxury/i,
  },
  {
    id: 'SOFT_CONTEMPORARY',
    name: 'Soft Contemporary',
    feel: 'Soft & Relaxed',
    pitch: 'rounded, soft shapes that are easy to use every day',
    answer_words: /soft|relaxed|casual|lembut|santai/i,
    personality: 'relaxed and modern, with soft geometry and materials that feel good to touch',
    use_fit: 'for everyday use with an effortless look',
    benefit: 'comfortable, light and modern',
    trade_off: 'the shape can slump a little when empty',
    dna: 'relaxed geometry: soft rounded volumes, supple material that drapes slightly, gathered or pleated details, tactile surfaces, modern ease',
    silhouette: {
      LEATHER: 'soft volume with rounded corners and naturally draping leather',
      FURNITURE: 'rounded corners and soft materials that invite touch',
      GENERIC: 'a softly rounded form',
    },
    original_feature: {
      BAG: { en: 'a softly gathered top edge that flows into the handle', legacy_id: 'tepi atas berkerut lembut yang mengalir menyatu ke handle' },
      SMALL_GOODS: { en: 'generous rounded corners in supple layered leather', legacy_id: 'sudut membulat lebar dengan kulit lembut berlapis' },
      FURNITURE: { en: 'fully rounded edges with softly stitched padded upholstery', legacy_id: 'tepi membulat penuh dengan jok empuk berjahit lembut' },
      GENERIC: { en: 'a softly rounded form', legacy_id: 'bentuk membulat yang lembut' },
    },
    words: /soft[\s-]?contemporary/i,
  },
  {
    id: 'EXPRESSIVE_CRAFT',
    name: 'Expressive Craft',
    feel: 'Artistic & Statement',
    pitch: 'a play of colour or texture that makes a statement',
    answer_words: /artistic|statement|colou?rful|seni|unik|berani/i,
    personality: 'bold, with material contrast or an artistic surface technique',
    use_fit: 'for those who want their piece to make a statement',
    benefit: 'very personal and unlike anything else',
    trade_off: 'less neutral to pair with every style',
    dna: 'bold craft: deliberate material or colour contrast, a surface technique (hand tooling, weaving, painted edge colour), artistic detail anchored by clean construction',
    silhouette: {
      LEATHER: 'a simple form as a canvas for material contrast or a surface technique',
      FURNITURE: 'a simple form with an inlay or artistic surface',
      GENERIC: 'material contrast or an artistic surface technique',
    },
    original_feature: {
      BAG: { en: 'a front panel of hand-woven or hand-tooled leather framed in smooth leather', legacy_id: 'panel depan dengan teknik anyam atau tooling tangan, dibingkai kulit polos' },
      SMALL_GOODS: { en: 'contrast-coloured painted edges with a two-tone textured panel', legacy_id: 'tepi dicat warna kontras dengan panel tekstur dua warna' },
      FURNITURE: { en: 'a contrasting wood inlay or carving framed by plain surfaces', legacy_id: 'inlay kayu kontras atau ukiran yang dibingkai bidang polos' },
      GENERIC: { en: 'a material contrast or an artistic surface technique', legacy_id: 'kontras material atau teknik permukaan artistik' },
    },
    words: /expressive[\s-]?craft|ekspresif/i,
  },
  {
    id: 'MODULAR_UTILITY',
    name: 'Modular Utility',
    feel: 'Flexible & Convertible',
    pitch: 'detachable straps or pockets you can swap as you need',
    answer_words: /flexible|convertible|detachable|adaptable|diubah|lepas[\s-]?pasang|fleksibel/i,
    personality: 'adaptable: straps, compartments or layout can change, and it stays neat',
    use_fit: 'for those who need one piece for many uses',
    benefit: 'adapts to what the day needs',
    trade_off: 'more parts to look after',
    dna: 'adaptable refinement: detachable straps, removable or reconfigurable compartments, clean attachment points, every module finished as carefully as the main body',
    silhouette: {
      LEATHER: 'a core body with neatly detachable modules',
      FURNITURE: 'modules that can be rearranged',
      GENERIC: 'components that can be reconfigured',
    },
    original_feature: {
      BAG: { en: 'a removable inner pouch and a strap that converts from shoulder to crossbody', legacy_id: 'pouch dalam yang bisa dilepas dan strap yang bisa diubah dari bahu ke selempang' },
      SMALL_GOODS: { en: 'a removable card insert that works on its own', legacy_id: 'insert slot kartu yang bisa dilepas dan dipakai sendiri' },
      FURNITURE: { en: 'reconfigurable modules joined by concealed connectors', legacy_id: 'modul yang bisa disusun ulang dengan pengunci tersembunyi' },
      GENERIC: { en: 'reconfigurable components', legacy_id: 'komponen yang bisa diubah konfigurasinya' },
    },
    words: /modular/i,
  },
];

export const DIRECTION_IDS = DIRECTIONS.map((d) => d.id);

export function directionDef(id: DesignDirection | undefined): DirectionDef | undefined {
  return DIRECTIONS.find((d) => d.id === id);
}

export const directionName = (id: DesignDirection | undefined) => directionDef(id)?.name ?? '';

/** The client-facing label ("Clean & Logo-Free"). */
export const directionFeel = (id: DesignDirection | undefined) => directionDef(id)?.feel ?? '';

/**
 * Directions picked by their everyday feel in an answer to the cards ("the clean one", "yang kalem aja"), in the order
 * mentioned. The cards that were shown are matched first, so "bold" means the shown card it describes.
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

/** The catalog's original feature for a direction and category (client-facing and prompt text: `en`). */
export function defaultOriginalFeature(direction: DesignDirection, category: CraftCategory): CatalogFeature | undefined {
  return directionDef(direction)?.original_feature[familyOf(category)];
}

/**
 * Features that assume a flap don't fit an OPEN-TOP bag (a tote would have to wrap a flap around its handles, which the
 * renders show as handles passing through holes in the flap): open-top bags use these variants instead.
 */
export const OPEN_TOP_BAG_FEATURE: Partial<Record<DirectionDef['id'], CatalogFeature>> = {
  QUIET_LUXURY: {
    en: 'a cleanly folded top edge with no visible hardware, handles stitched seamlessly into the body panels, a concealed magnetic tab inside the opening',
    legacy_id: 'tepi atas dilipat rapi tanpa hardware terlihat, pegangan dijahit menyatu ke panel badan, tab magnet tersembunyi di bagian dalam',
  },
  HERITAGE_CRAFTSMANSHIP: {
    en: 'layered leather handle bases with hand-stitched box-stitch reinforcement and solid brass rivets',
    legacy_id: 'pangkal pegangan berlapis kulit dengan jahitan tangan berbentuk kotak, diperkuat paku kuningan solid',
  },
};

/** Every catalog feature (direction cards + open-top variants). */
function catalogFeatures(): CatalogFeature[] {
  return [...DIRECTIONS.flatMap((d) => Object.values(d.original_feature)), ...Object.values(OPEN_TOP_BAG_FEATURE).filter((v): v is CatalogFeature => !!v)];
}

const findCatalogFeature = (feature: string) => {
  const f = feature.trim();
  return catalogFeatures().find((v) => v.en === f || v.legacy_id === f);
};

/** Is this feature text one the catalog wrote (not the client's own idea)? Older Indonesian catalog texts count too. */
export const isCatalogFeature = (feature: string) => !!findCatalogFeature(feature);

/** Prompt / display text for a stored originality feature (an older Indonesian catalog text → its English form). */
export function originalFeaturePrompt(feature: string): string {
  return findCatalogFeature(feature)?.en ?? feature.trim();
}

export const silhouetteLogic = (d: DirectionDef, category: CraftCategory) =>
  d.silhouette[category === 'BAG' || category === 'SMALL_GOODS' ? 'LEATHER' : category === 'FURNITURE' ? 'FURNITURE' : 'GENERIC'];
