import { constructionLabel, describeFields, schemaOf } from '@/lib/spec/catalog';
import { dimensionNote } from '@/lib/spec/dimensions';
import { directionDef, directionFeel, isDirectionSet, originalFeaturePrompt } from '@/lib/spec/directions';
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
export function specLines(s: Specifications, lang: 'id' | 'en' = 'en'): string[] {
  const fields = describeFields(s).map(({ key, field, text }) => {
    const note = key === 'dimensions_cm' && s.dimension_mode !== 'EXACT_CM' ? dimensionNote(s) : '';
    return `• ${lang === 'id' ? field.label_id : field.label}: ${text}${note ? ` (${note})` : ''}`;
  });
  // A size still to be measured on site has no value yet but must appear on the card.
  if (s.dimension_mode === 'PENDING_SITE_VISIT' && !describeFields(s).some((f) => f.key === 'dimensions_cm')) fields.unshift(lang === 'id' ? '• Ukuran: menunggu survei ukur di lokasi' : '• Size: awaiting on-site measurement');
  const custom = s.custom_fields.map((f) => `• ${f.label}: ${f.value}`);
  return [...fields, ...custom];
}

/** WhatsApp spec card sent when the specification is locked. */
export function specCardText(clientName: string, s: Specifications, opts: { updated?: boolean } = {}): string {
  return [
    opts.updated ? `Noted, ${clientName}. Here's the updated summary:` : `Noted, ${clientName}. Here's a summary of your order:`,
    '',
    [`• Model: ${modelLine(s)} (${schemaOf(s.category).label})`, ...designLines(s), ...specLines(s)].join('\n'),
    '',
    'Our crafter will review the design and pricing first, then we will send the quotation here.',
  ].join('\n');
}

/** "• Design feel: ..." / "• Signature detail: ..." lines of the spec card (only once a direction is chosen). */
export function designLines(s: Specifications): string[] {
  const d = directionDef(s.design_direction);
  if (!d) return [];
  const sec = isDirectionSet(s.secondary_direction) && s.secondary_direction !== s.design_direction ? directionFeel(s.secondary_direction) : '';
  return [`• Design feel: ${d.feel}${sec ? ` + ${sec}` : ''}`, ...(s.originality_feature.trim() ? [`• Signature detail: ${originalFeaturePrompt(s.originality_feature)}`] : [])];
}

/**
 * Concept presentation when the crafter releases a reviewed concept (Design Intelligence Layer v2, section 12): the
 * direction, the original feature, key materials, the practical benefit and what is still pending; never a guarantee.
 */
export function conceptPresentation(s: Specifications, pending: string[] = []): string {
  const d = directionDef(s.design_direction);
  return [
    '*Design concept reviewed by our crafter*',
    d ? `• Design feel: ${d.feel} (${d.pitch})` : null,
    s.originality_feature.trim() ? `• Signature detail: ${originalFeaturePrompt(s.originality_feature)}` : null,
    primaryMaterial(s) ? `• Main material: ${primaryMaterial(s)}` : null,
    s.functional_advantage.trim() ? `• Key benefit: ${s.functional_advantage.trim()}` : null,
    pending.length ? `• Still to confirm: ${pending.join(', ')}` : null,
    'These images are a visual concept, not a guarantee of the final production piece.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Primary material as written on the order (leather, wood, metal...). */
export function primaryMaterial(s: Specifications): string {
  return String((s.attributes as unknown as Record<string, unknown>)[schemaOf(s.category).material_field] ?? '');
}
