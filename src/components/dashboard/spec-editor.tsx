'use client';

import { AlertTriangle, Calculator, ClipboardList, Eye, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  attrs,
  blankValue,
  CATEGORIES,
  changeCategory,
  constructionDef,
  isFieldRelevant,
  isFieldSet,
  missingRequired,
  normalizeSpecifications,
  schemaOf,
  topicsFor,
} from '@/lib/spec/catalog';
import { GROUP_LABEL, type AnyField, type FieldGroup } from '@/lib/spec/fields';
import type { AttributeValue, ConstructionType, CraftCategory, CustomField, DimensionMode, Dimensions, OrderPayload, Specifications } from '@/lib/types';

const DIMENSION_MODE_LABEL: Record<DimensionMode, string> = {
  UNSPECIFIED: '— not discussed —',
  EXACT_CM: 'Exact cm',
  REFERENCE_BASED: 'Inferred from a reference',
  PENDING_SITE_VISIT: 'Pending site visit',
};
import { cn } from '@/lib/utils/cn';

const inputCls =
  'mt-1 w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500 disabled:bg-stone-50 disabled:text-stone-500';
const GROUP_ORDER = Object.keys(GROUP_LABEL) as FieldGroup[];
const NOTES_KEY = '__notes';

function Label({ children, required, onRemove }: { children: ReactNode; required?: boolean; onRemove?: () => void }) {
  return (
    <span className="flex items-center justify-between text-[11px] uppercase tracking-wide text-stone-500">
      <span>
        {children}
        {required && <span className="text-amber-600"> *</span>}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Clear & hide this field" className="rounded p-0.5 text-stone-300 hover:bg-stone-100 hover:text-stone-600">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** One input for one schema field; the control is chosen by the field type. */
function FieldInput({ field, value, disabled, onChange }: { field: AnyField; value: AttributeValue; disabled: boolean; onChange: (v: AttributeValue) => void }) {
  switch (field.type) {
    case 'text':
      return <input className={inputCls} disabled={disabled} value={value as string} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <div className="relative">
          <input
            type="number"
            min={0}
            step={field.step ?? 1}
            className={cn(inputCls, field.unit && 'pr-12')}
            disabled={disabled}
            value={(value as number) || ''}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          />
          {field.unit && <span className="pointer-events-none absolute right-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-stone-400">{field.unit}</span>}
        </div>
      );
    case 'boolean':
      return (
        <label className="mt-2 flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" disabled={disabled} checked={value as boolean} onChange={(e) => onChange(e.target.checked)} /> Yes
        </label>
      );
    case 'enum':
      return (
        <select className={inputCls} disabled={disabled} value={value as string} onChange={(e) => onChange(e.target.value)}>
          <option value="UNSPECIFIED">— not chosen —</option>
          {Object.entries(field.options as Record<string, string>).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      );
    case 'dimensions': {
      const d = value as Dimensions;
      const axes: Array<[keyof Dimensions, string]> = [
        ['length', field.axis_labels?.length ?? 'L'],
        ['width', field.axis_labels?.width ?? 'W'],
        ['height', field.axis_labels?.height ?? 'H'],
      ];
      return (
        <div className="mt-1 grid grid-cols-3 gap-2">
          {axes.map(([axis, label]) => (
            <div key={axis} className="relative">
              <input
                type="number"
                min={0}
                step="0.1"
                aria-label={`${field.label} ${axis}`}
                className="w-full rounded-lg bg-white py-1.5 pl-7 pr-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500 disabled:bg-stone-50"
                disabled={disabled}
                value={d[axis] || ''}
                onChange={(e) => onChange({ ...d, [axis]: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400">{label}</span>
            </div>
          ))}
        </div>
      );
    }
  }
}

/**
 * Category-aware specification form. Only the active category's schema is rendered, and of that only fields that are
 * relevant to the form factor AND either filled or required; everything else is one click away under "+ Add field".
 * Free-form requests go into custom fields. Nothing is saved until "Recalculate BOM & Price".
 */
export function SpecEditor({
  order,
  busy,
  onRecalculate,
}: {
  order: OrderPayload;
  busy: boolean;
  onRecalculate: (spec: Specifications) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Specifications | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const spec = draft ?? normalizeSpecifications(order.specifications);
  const schema = schemaOf(spec.category);
  const locked = order.session_state === 'APPROVED';
  const dirty = draft !== null;

  const update = (fn: (s: Specifications) => Specifications | void) => {
    const next = structuredClone(spec);
    setDraft(fn(next) ?? next);
  };
  const setAttr = (key: string, value: AttributeValue) => update((s) => void (attrs(s)[key] = value));

  const missing = missingRequired(spec, order.intake);
  const requiredKeys = new Set(topicsFor(spec).filter((t) => t.required).flatMap((t) => t.fields));
  const visible = (key: string) => isFieldRelevant(spec, key) && (isFieldSet(spec, key) || requiredKeys.has(key) || pinned.has(key));
  const hidden = Object.entries(schema.fields).filter(([key]) => isFieldRelevant(spec, key) && !visible(key));
  const showNotes = spec.notes.trim() !== '' || pinned.has(NOTES_KEY);

  function switchCategory(category: CraftCategory) {
    setPinned(new Set());
    setDraft(changeCategory(spec, category));
  }

  function switchConstruction(id: ConstructionType) {
    update((s) => {
      s.construction_type = id as typeof s.construction_type;
      // pre-fill the form factor's typical values into fields that are still empty
      const defaults = (constructionDef(id)?.defaults ?? {}) as Record<string, AttributeValue>;
      for (const [k, v] of Object.entries(defaults)) if (!isFieldSet(s, k)) attrs(s)[k] = structuredClone(v);
    });
  }

  function removeField(key: string) {
    setPinned((p) => new Set([...p].filter((k) => k !== key)));
    if (key === NOTES_KEY) update((s) => void (s.notes = ''));
    else setAttr(key, blankValue(schema.fields[key]));
  }

  const setCustom = (i: number, patch: Partial<CustomField>) => update((s) => void (s.custom_fields[i] = { ...s.custom_fields[i], ...patch, source: 'CRAFTER' }));

  const groups = GROUP_ORDER.map((g) => ({ group: g, keys: Object.entries(schema.fields).filter(([k, f]) => f.group === g && visible(k)).map(([k]) => k) })).filter((g) => g.keys.length);

  return (
    <Card>
      <CardHeader
        title="Specification"
        icon={<ClipboardList className="h-4 w-4 text-leather-500" />}
        action={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setPinned(new Set());
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Discard
              </Button>
            )}
            <Button size="sm" disabled={busy || locked || missing.length > 0} onClick={async () => (await onRecalculate(spec)) && setDraft(null)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />} Recalculate BOM & Price
            </Button>
          </div>
        }
      />
      <div className="space-y-5 p-4">
        {order.intake?.vision_notes && (
          <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-200">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>AI vision notes:</b> {order.intake.vision_notes}
            </span>
          </p>
        )}
        {locked && <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">Approved orders are read-only.</p>}
        {!locked && missing.length > 0 && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" /> Fill these before recalculating: {missing.map((t) => t.label).join(', ')}
          </p>
        )}

        {/* Category & form factor */}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <Label required>Craft category</Label>
            <select className={inputCls} disabled={locked} value={spec.category} onChange={(e) => switchCategory(e.target.value as CraftCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {schemaOf(c).label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <Label required>Form factor</Label>
            <select className={inputCls} disabled={locked} value={spec.construction_type} onChange={(e) => switchConstruction(e.target.value as ConstructionType)}>
              <option value="UNSPECIFIED">— not identified —</option>
              {schema.constructions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <Label>Product name</Label>
            <input className={inputCls} disabled={locked} value={spec.model_name} placeholder="Client-facing name" onChange={(e) => update((s) => void (s.model_name = e.target.value))} />
          </label>
        </div>

        {/* Where the size comes from */}
        {'dimensions_cm' in schema.fields && (
          <div className="grid gap-3 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200 sm:grid-cols-3">
            <label className="block text-sm">
              <Label>Size basis</Label>
              <select
                className={inputCls}
                disabled={locked}
                value={spec.dimension_mode}
                onChange={(e) => update((s) => void (s.dimension_mode = e.target.value as DimensionMode))}
              >
                {(Object.keys(DIMENSION_MODE_LABEL) as DimensionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {DIMENSION_MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            {spec.dimension_mode === 'REFERENCE_BASED' && (
              <label className="block text-sm sm:col-span-2">
                <Label>Reference object</Label>
                <input
                  className={inputCls}
                  disabled={locked}
                  value={spec.reference_object}
                  placeholder="e.g. Hermès Birkin 30, iPad Air 11 inch"
                  onChange={(e) => update((s) => void (s.reference_object = e.target.value))}
                />
              </label>
            )}
            {spec.dimension_mode === 'PENDING_SITE_VISIT' && (
              <p className="self-end text-xs text-stone-600 sm:col-span-2">
                Size will be measured on site. The quote uses the form factor&apos;s typical size and includes the site-visit fee; update the
                dimensions after the visit and recalculate.
              </p>
            )}
          </div>
        )}

        {/* Category fields, grouped */}
        {groups.map(({ group, keys }) => (
          <fieldset key={group}>
            <legend className="mb-2 text-xs font-semibold text-leather-700">{GROUP_LABEL[group]}</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {keys.map((key) => {
                const field = schema.fields[key];
                const required = requiredKeys.has(key);
                return (
                  <label key={key} className={cn('block text-sm', field.type === 'dimensions' && 'col-span-2 sm:col-span-3')}>
                    <Label required={required} onRemove={!required && !locked ? () => removeField(key) : undefined}>
                      {field.label}
                      {field.type === 'dimensions' && field.unit ? ` (${field.unit})` : ''}
                    </Label>
                    <FieldInput
                      field={field}
                      value={attrs(spec)[key]}
                      disabled={locked}
                      onChange={(v) =>
                        update((s) => {
                          attrs(s)[key] = v;
                          // centimetres typed by the crafter are confirmed sizes
                          if (key === 'dimensions_cm') s.dimension_mode = 'EXACT_CM';
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {showNotes && (
          <label className="block text-sm">
            <Label onRemove={!locked ? () => removeField(NOTES_KEY) : undefined}>Notes</Label>
            <textarea rows={2} className={inputCls} disabled={locked} value={spec.notes} onChange={(e) => update((s) => void (s.notes = e.target.value))} />
          </label>
        )}

        {/* Custom fields */}
        {spec.custom_fields.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-leather-700">Custom fields</legend>
            <div className="space-y-2">
              {spec.custom_fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1.4fr_7rem_auto] items-center gap-2">
                  <input aria-label="Custom field name" className={cn(inputCls, 'mt-0')} disabled={locked} value={f.label} placeholder="Field" onChange={(e) => setCustom(i, { label: e.target.value })} />
                  <input aria-label="Custom field value" className={cn(inputCls, 'mt-0')} disabled={locked} value={f.value} placeholder="Value" onChange={(e) => setCustom(i, { value: e.target.value })} />
                  <input
                    aria-label="Surcharge (IDR)"
                    type="number"
                    min={0}
                    step={10000}
                    className={cn(inputCls, 'mt-0')}
                    disabled={locked}
                    value={f.surcharge_idr || ''}
                    placeholder="+ Rp"
                    title="Surcharge added to the quotation"
                    onChange={(e) => setCustom(i, { surcharge_idr: Number(e.target.value) || 0 })}
                  />
                  <div className="flex items-center gap-1">
                    <Badge tone={f.source === 'AI' ? 'blue' : 'leather'}>{f.source}</Badge>
                    {!locked && (
                      <button type="button" title="Remove" onClick={() => update((s) => void s.custom_fields.splice(i, 1))} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {/* Add more */}
        {!locked && (
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
            {(hidden.length > 0 || !showNotes) && (
              <select
                aria-label="Add a field from this category"
                value=""
                onChange={(e) => e.target.value && setPinned((p) => new Set([...p, e.target.value]))}
                className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-stone-700 ring-1 ring-stone-300"
              >
                <option value="">+ Add field ({schema.label.toLowerCase()})…</option>
                {hidden.map(([key, f]) => (
                  <option key={key} value={key}>
                    {GROUP_LABEL[f.group]} · {f.label}
                  </option>
                ))}
                {!showNotes && <option value={NOTES_KEY}>Other · Notes</option>}
              </select>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                update((s) => void s.custom_fields.push({ id: `cf-${Date.now().toString(36)}`, label: '', value: '', surcharge_idr: 0, source: 'CRAFTER' }))
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add Custom Field
            </Button>
            <span className="text-[11px] text-stone-400">
              {Object.keys(schema.fields).length} fields in the {schema.label} schema · {hidden.length} hidden (empty / optional)
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
