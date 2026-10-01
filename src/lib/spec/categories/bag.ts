import type { CategorySchema } from '@/lib/spec/fields';
import { bagDimensionsForLaptop, parseColor, parseCount, parseDimensions, parseLaptopInch, parseLining } from '@/lib/spec/parsers';
import type { BagAttributes, BagClosure, BagStrap, BagStructure } from '@/lib/types';
import { dimensionsField, embossingFields, leatherEdgeField, leatherField, stitchingMethodField, threadColorField } from './common';

function parseStructure(t: string): BagStructure | undefined {
  if (/kaku|tegap|rigid|structured|terstruktur/i.test(t)) return 'RIGID';
  if (/semi/i.test(t)) return 'SEMI_STRUCTURED';
  if (/lemas|slouchy|soft|lembut/i.test(t)) return 'SOFT';
  return undefined;
}

function parseClosure(t: string): BagClosure | undefined {
  if (/kunci putar|turn.?lock/i.test(t)) return 'TURN_LOCK_FLAP';
  if (/flap[^.]{0,15}(magnet|magnetic)|magnet[^.]{0,15}flap/i.test(t)) return 'MAGNETIC_FLAP';
  if (/flap[^.]{0,15}(gesper|buckle)|buckle/i.test(t)) return 'BUCKLE_FLAP';
  if (/tutup(an)? (sleting|zipper)|top ?zip|(sleting|zipper) (atas|utama)/i.test(t)) return 'ZIPPER';
  if (/serut|drawstring/i.test(t)) return 'DRAWSTRING';
  if (/tanpa tutup|open ?top|terbuka/i.test(t)) return 'OPEN_TOP';
  return undefined;
}

function parseStrap(t: string): BagStrap | undefined {
  if (/tanpa (tali|strap)|no strap/i.test(t)) return 'NONE';
  if (/webbing/i.test(t)) return 'WEBBING';
  if (/(tali|strap|selempang)[^.?!]{0,30}(lepas|detach|copot)|lepas[\s-]?pasang/i.test(t)) return 'DETACHABLE_LEATHER';
  if (/convertible|bisa jadi ransel|2 ?in ?1/i.test(t)) return 'CONVERTIBLE';
  if (/full kulit|(tali|strap)[^.?!]{0,15}kulit/i.test(t)) return 'FIXED_LEATHER';
  return undefined;
}

const STRAPPED: BagAttributes['strap_type'][] = ['FIXED_LEATHER', 'DETACHABLE_LEATHER', 'WEBBING', 'CONVERTIBLE', 'BACKPACK_STRAPS'];

export const BAG: CategorySchema<'BAG'> = {
  id: 'BAG',
  label: 'Bags',
  label_id: 'Tas',
  noun: 'leather bag',
  scope: 'Any bag: sling, crossbody, messenger/laptop, tote, backpack, briefcase, clutch, sport/racket bags.',
  detect: /\btas\b|bag|tote|ransel|backpack|briefcase|clutch|pouch/i,
  material_field: 'exterior_leather',
  material_label: 'Leather',
  constructions: [
    {
      id: 'PADEL_RACKET_BAG',
      label: 'Padel racket bag',
      detect: /padel|raket|racket|racquet/i,
      vision_cue: 'Tall narrow sleeve-style bag sized for a padel/tennis racket, usually zipped along one side with a carry strap.',
      defaults: { dimensions_cm: { length: 30, width: 10, height: 60 }, strap_type: 'DETACHABLE_LEATHER', main_closure: 'ZIPPER', exterior_pockets: 1 },
      labor_factor: 1,
    },
    {
      id: 'EXECUTIVE_BRIEFCASE',
      label: 'Executive briefcase',
      detect: /briefcase|tas kerja|tas kantor|attache|executive/i,
      vision_cue: 'Rigid rectangular business case with top handle(s), a flap or zipper top, and often reinforced corners.',
      defaults: { dimensions_cm: { length: 42, width: 10, height: 31 }, structure: 'RIGID', main_closure: 'BUCKLE_FLAP', strap_type: 'DETACHABLE_LEATHER', interior_zip_pockets: 1 },
      labor_factor: 1.45,
    },
    {
      id: 'HYBRID_BACKPACK_TOTE',
      label: 'Hybrid backpack-tote',
      detect: /hybrid|campuran|backpack.{0,25}tote|tote.{0,25}backpack|ransel.{0,25}tote|tote.{0,25}ransel/i,
      vision_cue: 'Tote body with convertible backpack straps.',
      defaults: { dimensions_cm: { length: 32, width: 14, height: 40 }, strap_type: 'CONVERTIBLE', main_closure: 'ZIPPER', interior_zip_pockets: 1 },
      labor_factor: 1.3,
    },
    {
      id: 'BACKPACK',
      label: 'Backpack',
      detect: /backpack|ransel/i,
      vision_cue: 'Bag worn on the back with two shoulder straps and a top handle.',
      defaults: { dimensions_cm: { length: 30, width: 13, height: 40 }, strap_type: 'BACKPACK_STRAPS', main_closure: 'ZIPPER', interior_zip_pockets: 1, exterior_pockets: 1 },
      labor_factor: 1.4,
    },
    {
      id: 'CROSSBODY_CAMERA_BAG',
      label: 'Crossbody camera bag',
      detect: /kamera|camera|mirrorless|dslr/i,
      vision_cue: 'Small boxy crossbody bag with a padded interior sized for a camera body.',
      defaults: { dimensions_cm: { length: 18, width: 8, height: 14 }, strap_type: 'DETACHABLE_LEATHER', main_closure: 'ZIPPER', padding: 'Foam 5mm' },
      labor_factor: 0.8,
    },
    {
      id: 'MESSENGER_BAG',
      label: 'Messenger / laptop bag',
      detect: /messenger|tas laptop|laptop bag|satchel/i,
      vision_cue: 'Wide, shallow bag with a long front flap, a crossbody strap and a padded laptop compartment.',
      defaults: { dimensions_cm: { length: 38, width: 10, height: 28 }, main_closure: 'MAGNETIC_FLAP', strap_type: 'DETACHABLE_LEATHER', interior_zip_pockets: 1 },
      labor_factor: 0.85,
    },
    {
      id: 'SLOUCHY_TOTE',
      label: 'Slouchy shoulder tote',
      detect: /slouchy|lemas.{0,25}tote|tote.{0,25}lemas|soft tote|hobo/i,
      vision_cue: 'Soft, unstructured open-top tote that slumps; two shoulder handles.',
      defaults: { dimensions_cm: { length: 38, width: 14, height: 32 }, structure: 'SOFT', main_closure: 'OPEN_TOP', strap_type: 'TOP_HANDLE_ONLY', interior_zip_pockets: 1 },
      labor_factor: 0.8,
    },
    {
      id: 'STRUCTURED_TOTE',
      label: 'Structured tote',
      detect: /tote/i,
      vision_cue: 'Rigid open-top tote that holds its shape, two top handles.',
      defaults: { dimensions_cm: { length: 35, width: 14, height: 28 }, structure: 'RIGID', main_closure: 'OPEN_TOP', strap_type: 'TOP_HANDLE_ONLY', interior_zip_pockets: 1 },
      labor_factor: 0.9,
    },
    {
      id: 'SLING_BAG',
      label: 'Sling / shoulder bag',
      detect: /sling|selempang|crossbody|shoulder bag/i,
      vision_cue: 'Medium bag with a single adjustable shoulder strap, usually with a front flap.',
      defaults: { dimensions_cm: { length: 30, width: 10, height: 22 }, main_closure: 'MAGNETIC_FLAP', strap_type: 'DETACHABLE_LEATHER' },
      labor_factor: 1,
    },
    {
      id: 'CLUTCH',
      label: 'Clutch',
      detect: /clutch/i,
      vision_cue: 'Small handheld flat bag with no straps.',
      defaults: { dimensions_cm: { length: 25, width: 4, height: 16 }, strap_type: 'NONE', main_closure: 'MAGNETIC_FLAP' },
      labor_factor: 0.6,
    },
    {
      id: 'OTHER_BAG',
      label: 'Other bag',
      detect: /(?!)/,
      vision_cue: 'Any other bag.',
      defaults: { dimensions_cm: { length: 30, width: 12, height: 25 } },
      labor_factor: 1,
    },
  ],
  fields: {
    dimensions_cm: {
      ...dimensionsField<BagAttributes>('Outer body size L (front width) x W (depth) x H. May be derived from a named object, e.g. 14-inch laptop ≈ 37 x 10 x 26 cm.'),
      parse: (t) => parseDimensions(t) ?? (parseLaptopInch(t) ? bagDimensionsForLaptop(parseLaptopInch(t)!) : undefined),
    },
    gusset_depth_cm: {
      type: 'number',
      label: 'Gusset depth',
      label_id: 'Lebar samping (gusset)',
      group: 'size',
      unit: 'cm',
      step: 0.5,
      description: 'Side gusset depth if the client specifies it separately from the body width; otherwise 0.',
      parse: (t) => {
        const m = /(gusset|samping|lebar samping)\D{0,10}(\d+(?:[.,]\d+)?)\s*cm/i.exec(t);
        return m ? Number(m[2].replace(',', '.')) : undefined;
      },
    },
    laptop_size_inch: {
      type: 'number',
      label: 'Laptop size',
      label_id: 'Ukuran laptop',
      group: 'size',
      unit: 'inch',
      description: 'Laptop the bag must fit, in inches (0 if none).',
      parse: parseLaptopInch,
    },
    target_capacity: {
      type: 'text',
      label: 'Must fit',
      label_id: 'Muat',
      group: 'size',
      description: 'What the bag must hold, e.g. "iPad mini, dompet, HP" or "dokumen A4".',
      parse: (t) => /(?:muat|fit|kapasitas|capacity|buat|untuk)\s+([^.!?\n]{3,50})/i.exec(t)?.[1]?.trim(),
    },
    exterior_leather: leatherField(),
    color: { type: 'text', label: 'Color', label_id: 'Warna', group: 'material', description: 'Leather color as the client calls it.', parse: parseColor },
    structure: {
      type: 'enum',
      label: 'Structure',
      label_id: 'Struktur',
      group: 'construction',
      options: { RIGID: 'Rigid / structured', SEMI_STRUCTURED: 'Semi-structured', SOFT: 'Soft / slouchy' },
      description: '"kaku/tegap" = RIGID, "lemas" = SOFT.',
      parse: parseStructure,
    },
    main_closure: {
      type: 'enum',
      label: 'Main closure',
      label_id: 'Penutup utama',
      group: 'construction',
      options: {
        MAGNETIC_FLAP: 'Flap with magnetic snap',
        TURN_LOCK_FLAP: 'Flap with turn-lock',
        BUCKLE_FLAP: 'Flap with buckle',
        ZIPPER: 'Top zipper',
        DRAWSTRING: 'Drawstring',
        OPEN_TOP: 'Open top',
      },
      description: 'How the main compartment closes.',
      parse: parseClosure,
    },
    strap_type: {
      type: 'enum',
      label: 'Strap',
      label_id: 'Tali / strap',
      group: 'construction',
      options: {
        NONE: 'No strap',
        TOP_HANDLE_ONLY: 'Top handle(s) only',
        FIXED_LEATHER: 'Fixed full-leather strap',
        DETACHABLE_LEATHER: 'Detachable leather strap',
        WEBBING: 'Webbing strap',
        BACKPACK_STRAPS: 'Backpack straps',
        CONVERTIBLE: 'Convertible (shoulder / backpack)',
      },
      description: 'Strap configuration. "lepas pasang" = DETACHABLE_LEATHER; "full kulit" = FIXED_LEATHER unless detachable is mentioned.',
      parse: parseStrap,
    },
    hardware: {
      type: 'text',
      label: 'Hardware',
      label_id: 'Hardware',
      group: 'construction',
      placeholder: 'e.g. Solid brass, gold finish',
      description: 'Metal hardware material / finish and reinforcement, e.g. "solid brass buckles, salpa 1.2mm".',
      parse: (t) => /(solid brass|kuningan|nikel|nickel|antique brass|gold|emas|silver)[^.?!,]{0,30}/i.exec(t)?.[0]?.trim(),
      relevant: (a) => a.strap_type !== 'NONE' || a.main_closure !== 'OPEN_TOP',
    },
    interior_zip_pockets: {
      type: 'number',
      label: 'Interior zip pockets',
      label_id: 'Saku zipper dalam',
      group: 'layout',
      description: 'Zippered pockets inside.',
      parse: (t) => (/(saku|kantong|pocket)\s*(zipper|zip|sleting)/i.test(t) ? (parseCount(t, 'saku zipper|saku zip|kantong zipper') ?? 1) : undefined),
    },
    exterior_pockets: {
      type: 'number',
      label: 'Exterior pockets',
      label_id: 'Saku luar',
      group: 'layout',
      description: 'Open slip pockets on the outside (front/back/side).',
      parse: (t) => (/saku depan|kantong depan|front pocket|saku luar/i.test(t) ? 1 : undefined),
    },
    lining: { type: 'text', label: 'Lining', label_id: 'Lining', group: 'material', description: 'Interior lining material.', parse: parseLining },
    padding: {
      type: 'text',
      label: 'Padding',
      label_id: 'Busa / padding',
      group: 'material',
      description: 'Protective padding, e.g. "EVA foam 5mm" for laptops, cameras or rackets.',
      parse: (t) => /(busa|foam|eva|padding)[^.?!,]{0,20}/i.exec(t)?.[0]?.trim(),
    },
    edge_finish: leatherEdgeField(),
    stitching_method: stitchingMethodField(),
    thread_color: threadColorField(),
    ...embossingFields<BagAttributes>(),
  },
  topics: [
    { id: 'construction', label: 'Model', ask: 'model tas yang diinginkan (mis. sling bag, messenger laptop, tote, ransel, briefcase)', required: true, fields: [], deferrable: false, is_filled: (s) => s.construction_type !== 'UNSPECIFIED' },
    {
      id: 'size',
      label: 'Ukuran',
      ask: 'ukuran perkiraan (P x L x T cm) atau barang yang harus muat (mis. laptop 14 inch)',
      required: true,
      fields: ['dimensions_cm', 'laptop_size_inch'],
      deferrable: false,
      is_filled: (s) => (s.attributes.dimensions_cm.length > 0 && s.attributes.dimensions_cm.height > 0) || s.attributes.laptop_size_inch > 0,
    },
    { id: 'material', label: 'Kulit', ask: 'jenis & warna kulit (mis. Veg-Tan coklat 1.6mm, Pull-Up, Epsom)', required: true, fields: ['exterior_leather'], deferrable: false },
    { id: 'strap', label: 'Strap', ask: 'tali/strap: full kulit atau webbing, lepas-pasang atau permanen', required: false, fields: ['strap_type'], deferrable: true },
    { id: 'closure', label: 'Penutup', ask: 'penutup utama: flap magnet, kunci putar, gesper, atau sleting', required: false, fields: ['main_closure'], applies_to: ['SLING_BAG', 'MESSENGER_BAG', 'EXECUTIVE_BRIEFCASE', 'CROSSBODY_CAMERA_BAG', 'CLUTCH', 'BACKPACK'], deferrable: true },
    { id: 'hardware', label: 'Hardware', ask: 'hardware yang diinginkan (mis. solid brass, nikel, gold) dan apakah perlu penguat', required: false, fields: ['hardware'], applies_to: ['EXECUTIVE_BRIEFCASE', 'PADEL_RACKET_BAG', 'MESSENGER_BAG'], deferrable: true },
    { id: 'lining', label: 'Lining', ask: 'bahan lining dalam (suede, kanvas, kulit) atau tanpa lining', required: false, fields: ['lining'], deferrable: true },
    { id: 'personalization', label: 'Emboss', ask: 'apakah mau emboss inisial/logo (kalau iya, tulisan dan posisinya)', required: false, fields: ['embossing_type'], deferrable: true },
  ],
};

export const bagHasStrap = (a: BagAttributes) => STRAPPED.includes(a.strap_type);
