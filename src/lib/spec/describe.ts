import { getConstruction } from '@/lib/spec/catalog';
import type { CustomizationType, PocketLayout, Specifications } from '@/lib/types';

/** Value written when the client says "terserah / ikut standar"; replaced by the preset default at finalize. */
export const DEFER_VALUE = 'ikut standar workshop';

const CUSTOMIZATION_LABEL: Record<CustomizationType, string> = {
  UNSPECIFIED: 'belum dibahas',
  NONE: 'tanpa kustomisasi',
  EMBOSS_INITIALS: 'emboss inisial',
  EMBOSS_LOGO: 'emboss logo',
  LASER_ENGRAVING: 'laser engraving',
};

export function describePockets(p: PocketLayout): string {
  const parts = [
    p.front_slots > 0 && `${p.front_slots} slot depan`,
    p.back_slots > 0 && `${p.back_slots} slot belakang`,
    p.central_pockets > 0 && `${p.central_pockets} kantong tengah`,
    p.cash_compartments > 0 && `${p.cash_compartments} kompartemen uang`,
    p.id_window && 'jendela ID transparan',
    p.coin_zip_pocket && 'saku koin ber-zipper',
    p.interior_zip_pockets > 0 && `${p.interior_zip_pockets} saku zipper dalam`,
    p.exterior_pockets > 0 && `${p.exterior_pockets} saku luar`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

export function describeCustomization(s: Specifications): string {
  const c = s.customization;
  if (c.type === 'UNSPECIFIED' || c.type === 'NONE') return CUSTOMIZATION_LABEL[c.type];
  return [CUSTOMIZATION_LABEL[c.type], c.detail && `"${c.detail}"`, c.placement && `(${c.placement})`].filter(Boolean).join(' ');
}

/** Construction label, plus the client's own wording when it adds information. */
function modelLine(s: Specifications): string {
  const label = getConstruction(s.construction_type).label;
  const own = s.silhouette.trim();
  const core = label.replace(/\s*\(.*\)$/, '').toLowerCase();
  if (!own || own.toLowerCase().includes(core) || label.toLowerCase().includes(own.toLowerCase())) return label;
  return `${label} — ${own}`;
}

/** WhatsApp spec card sent when the specification is locked. */
export function specCardText(clientName: string, s: Specifications, opts: { updated?: boolean } = {}): string {
  const d = s.dimensions_cm;
  const dims = [d.length, d.width, d.height].filter((n) => n > 0).join(' x ');
  const pockets = describePockets(s.pocket_layout);
  const thread = [s.finish.thread_material, s.finish.thread_color, s.finish.stitch_pattern].filter(Boolean).join(', ');
  const lines = [
    opts.updated ? `Siap kak ${clientName}, spesifikasi sudah kami perbarui ya ✨` : `Siap kak ${clientName}! ✨ Spesifikasi sudah lengkap:`,
    `• Model: ${modelLine(s)}`,
    `• Ukuran: ${dims} cm`,
    `• Kulit: ${s.exterior_leather}${s.finish.color_finish && !s.exterior_leather.toLowerCase().includes(s.finish.color_finish.toLowerCase()) ? `, ${s.finish.color_finish}` : ''}`,
    pockets && `• Slot & saku: ${pockets}`,
    s.lining_material && `• Lining: ${s.lining_material}`,
    `• Jahitan: ${[s.stitching_method, thread].filter(Boolean).join(' · ')}`,
    `• Finishing pinggir: ${s.edge_finish}`,
    s.finish.zipper && `• Sleting: ${s.finish.zipper}`,
    s.finish.strap && `• Strap: ${s.finish.strap}`,
    s.finish.hardware_notes && `• Hardware: ${s.finish.hardware_notes}`,
    s.customization.type !== 'UNSPECIFIED' && s.customization.type !== 'NONE' && `• Kustomisasi: ${describeCustomization(s)}`,
    'Crafter kami sedang meninjau desain & penawarannya, akan kami kirim segera ya 🙏',
  ];
  return lines.filter(Boolean).join('\n');
}
