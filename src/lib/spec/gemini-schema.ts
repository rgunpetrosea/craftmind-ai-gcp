import { Type, type Schema } from '@google/genai';
import { ALL_CONSTRUCTIONS, CATEGORIES, schemaOf } from '@/lib/spec/catalog';
import type { AnyField } from '@/lib/spec/fields';
import type { CraftCategory } from '@/lib/types';

/**
 * Gemini responseSchemas generated from the category registry (server-only: imports @google/genai).
 *
 *   classificationSchema()      stage 1: which category / form factor is this conversation about?
 *   extractionSchema(category)  stage 2: ONLY that category's attributes, so the model cannot return
 *                               wallet card slots for a table or straps for a shoe.
 */

const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: Type.OBJECT,
  properties,
  required: Object.keys(properties),
  ...(description && { description }),
});

function fieldSchema(field: AnyField): Schema {
  const description = `${field.label}${field.unit ? ` (${field.unit})` : ''}. ${field.description}`;
  switch (field.type) {
    case 'text':
      return { type: Type.STRING, description: `${description} Empty string if not stated.` };
    case 'number':
      return { type: Type.NUMBER, description: `${description} 0 if not stated.` };
    case 'boolean':
      return { type: Type.BOOLEAN, description: `${description} false if not stated.` };
    case 'enum':
      return { type: Type.STRING, enum: ['UNSPECIFIED', ...Object.keys(field.options)], description: `${description} UNSPECIFIED if not stated.` };
    case 'dimensions':
      return obj({ length: { type: Type.NUMBER }, width: { type: Type.NUMBER }, height: { type: Type.NUMBER } }, `${description} 0 for unknown axes.`);
  }
}

export function classificationSchema(): Schema {
  return obj({
    vision_notes: {
      type: Type.STRING,
      description: 'What you SEE in any attached photo/sketch that decides the form factor (fold lines, slots, straps, legs...). Empty if no image.',
    },
    craft_category: { type: Type.STRING, enum: [...CATEGORIES] },
    construction_type: {
      type: Type.STRING,
      enum: ['UNSPECIFIED', ...ALL_CONSTRUCTIONS.map((c) => c.id)],
      description: 'Must belong to craft_category. UNSPECIFIED when the client has not said what product yet.',
    },
    confidence: { type: Type.NUMBER, description: '0..1' },
  });
}

export function extractionSchema(category: CraftCategory): Schema {
  const schema = schemaOf(category);
  const attributes = Object.fromEntries(Object.entries(schema.fields).map(([key, f]) => [key, fieldSchema(f)]));
  const topics = schema.topics.filter((t) => t.deferrable).map((t) => t.id);
  return obj({
    vision_notes: { type: Type.STRING, description: 'What the attached photo/sketch shows that matters for this product. Empty if no image.' },
    construction_type: {
      type: Type.STRING,
      enum: ['UNSPECIFIED', ...schema.constructions.map((c) => c.id)],
      description: `Form factor within ${schema.label}.`,
    },
    model_name: { type: Type.STRING, description: 'Short product name in the client\'s words, e.g. "Dompet kartu pipih". Empty if unknown.' },
    attributes: obj(attributes, `${schema.label} attributes only.`),
    custom_fields: {
      type: Type.ARRAY,
      description: 'Client requests that NO attribute above covers (e.g. "hidden AirTag pocket", "ring size 7"). Empty array if none.',
      items: obj({ label: { type: Type.STRING }, value: { type: Type.STRING } }),
    },
    deferred_topics: {
      type: Type.ARRAY,
      description: 'Topics the client explicitly left to the workshop ("terserah", "ikut standar", "bebas").',
      items: { type: Type.STRING, enum: topics.length ? topics : ['none'] },
    },
    client_finished: { type: Type.BOOLEAN, description: 'True only if the client says they have nothing more to add ("itu saja", "udah segitu").' },
  });
}
