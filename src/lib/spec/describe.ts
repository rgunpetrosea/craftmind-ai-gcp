import { constructionLabel, describeFields, schemaOf } from '@/lib/spec/catalog';
import { dimensionNote } from '@/lib/spec/dimensions';
import type { Specifications } from '@/lib/types';

/** Client-facing text built from the active category's schema: only filled, relevant fields appear. */

/** Construction label, plus the client's own wording when it adds information. */
export function modelLine(s: Specifications): string {
  const label = constructionLabel(s.construction_type);
  const own = s.model_name.trim();
  const core = label.replace(/\s*\(.*\)$/, '').toLowerCase();
  if (!own || own.toLowerCase().includes(core) || label.toLowerCase().includes(own.toLowerCase())) return label;
  return `${label} — ${own}`;
}

/** "• Label: value" lines for every set field, then custom fields. */
export function specLines(s: Specifications, lang: 'id' | 'en' = 'id'): string[] {
  const fields = describeFields(s).map(({ key, field, text }) => {
    const note = key === 'dimensions_cm' && s.dimension_mode !== 'EXACT_CM' ? dimensionNote(s) : '';
    return `• ${lang === 'id' ? field.label_id : field.label}: ${text}${note ? ` (${note})` : ''}`;
  });
  // A size still to be measured on site has no value yet but must appear on the card.
  if (s.dimension_mode === 'PENDING_SITE_VISIT' && !describeFields(s).some((f) => f.key === 'dimensions_cm')) fields.unshift('• Ukuran: menunggu survei ukur di lokasi');
  const custom = s.custom_fields.map((f) => `• ${f.label}: ${f.value}`);
  return [...fields, ...custom];
}

/** WhatsApp spec card sent when the specification is locked. */
export function specCardText(clientName: string, s: Specifications, opts: { updated?: boolean } = {}): string {
  return [
    opts.updated ? `Siap kak ${clientName}, spesifikasi sudah kami perbarui ya ✨` : `Siap kak ${clientName}! ✨ Spesifikasi sudah lengkap:`,
    `• Model: ${modelLine(s)} (${schemaOf(s.category).label_id})`,
    ...specLines(s),
    'Crafter kami sedang meninjau desain & penawarannya, akan kami kirim segera ya 🙏',
  ].join('\n');
}

/** Primary material as written on the order (leather, wood, metal...). */
export function primaryMaterial(s: Specifications): string {
  return String((s.attributes as unknown as Record<string, unknown>)[schemaOf(s.category).material_field] ?? '');
}
