'use client';

import { AlertTriangle, ClipboardList, Eye, Loader2, RotateCcw, Calculator } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CONSTRUCTIONS, EDGE_LABEL, emptyPockets, getConstruction, normalizeSpecifications, requiredTopics, TOPICS } from '@/lib/spec/catalog';
import type { ConstructionType, CraftCategory, CustomizationType, EdgeTreatment, OrderPayload, PocketLayout, Specifications } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const CATEGORY_LABEL: Record<CraftCategory, string> = { bespoke_bag: 'Bags', bespoke_wallet: 'Wallets & card holders', bespoke_shoes: 'Shoes' };

const CUSTOMIZATION_OPTIONS: Array<[CustomizationType, string]> = [
  ['UNSPECIFIED', 'Not discussed'],
  ['NONE', 'None'],
  ['EMBOSS_INITIALS', 'Emboss initials'],
  ['EMBOSS_LOGO', 'Emboss logo'],
  ['LASER_ENGRAVING', 'Laser engraving'],
];

const POCKET_FIELDS: Array<[Exclude<keyof PocketLayout, 'id_window' | 'coin_zip_pocket'>, string]> = [
  ['front_slots', 'Front card slots'],
  ['back_slots', 'Back card slots'],
  ['central_pockets', 'Central pocket'],
  ['cash_compartments', 'Cash compartments'],
  ['interior_zip_pockets', 'Interior zip pockets'],
  ['exterior_pockets', 'Exterior pockets'],
];

const inputCls = 'mt-1 w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500 disabled:bg-stone-50 disabled:text-stone-500';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block text-sm', className)}>
      <span className="text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold text-leather-700">{title}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}

/**
 * The structured specification as an editable form. The crafter corrects whatever the AI got wrong
 * (e.g. Bifold → Flat card holder) and presses "Recalculate BOM & Price"; nothing is saved until then.
 */
export function SpecEditor({
  order,
  busy,
  onRecalculate,
}: {
  order: OrderPayload;
  busy: boolean;
  onRecalculate: (spec: Specifications, category: CraftCategory) => Promise<boolean>;
}) {
  const server = normalizeSpecifications(order.specifications);
  const [draft, setDraft] = useState<Specifications | null>(null);
  const spec = draft ?? server;
  const locked = order.session_state === 'APPROVED';
  const dirty = draft !== null;

  const patch = (fn: (s: Specifications) => void) => {
    const next = structuredClone(spec);
    fn(next);
    setDraft(next);
  };

  const missing = requiredTopics(spec).filter((t) => !TOPICS[t].isFilled(spec));
  const category = getConstruction(spec.construction_type).category;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  const text = (label: string, get: (s: Specifications) => string, set: (s: Specifications, v: string) => void, className?: string) => (
    <Field label={label} className={className}>
      <input className={inputCls} disabled={locked} value={get(spec)} onChange={(e) => patch((s) => set(s, e.target.value))} />
    </Field>
  );

  const dimension = (label: string, key: keyof Specifications['dimensions_cm']) => (
    <Field label={label}>
      <input
        type="number"
        min={0}
        step="0.1"
        className={inputCls}
        disabled={locked}
        value={spec.dimensions_cm[key] || ''}
        onChange={(e) => patch((s) => void (s.dimensions_cm[key] = num(e.target.value)))}
      />
    </Field>
  );

  return (
    <Card>
      <CardHeader
        title="Structured specification (editable)"
        icon={<ClipboardList className="h-4 w-4 text-leather-500" />}
        action={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                <RotateCcw className="h-3.5 w-3.5" /> Discard
              </Button>
            )}
            <Button size="sm" disabled={busy || locked || missing.length > 0} onClick={async () => (await onRecalculate(spec, category)) && setDraft(null)}>
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
            <AlertTriangle className="h-3.5 w-3.5" /> Fill these before recalculating: {missing.join(', ')}
          </p>
        )}

        <Group title="Form factor">
          <Field label="Construction type" className="col-span-2">
            <select
              className={inputCls}
              disabled={locked}
              value={spec.construction_type}
              onChange={(e) =>
                patch((s) => {
                  const def = getConstruction(e.target.value as ConstructionType);
                  const wasLabel = getConstruction(s.construction_type).label;
                  s.construction_type = def.id;
                  if (!s.silhouette.trim() || s.silhouette === wasLabel) s.silhouette = def.id === 'UNSPECIFIED' ? '' : def.label;
                  // a new form factor starts from its usual layout unless pockets were already described
                  const empty = emptyPockets();
                  if (JSON.stringify(s.pocket_layout) === JSON.stringify(empty)) Object.assign(s.pocket_layout, def.default_pockets);
                  if (!s.dimensions_cm.length && !s.dimensions_cm.height) s.dimensions_cm = { ...def.default_dimensions };
                })
              }
            >
              <option value="UNSPECIFIED">— not identified —</option>
              {(Object.keys(CATEGORY_LABEL) as CraftCategory[]).map((cat) => (
                <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                  {CONSTRUCTIONS.filter((c) => c.category === cat).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {text('Silhouette / name', (s) => s.silhouette, (s, v) => void (s.silhouette = v))}
          {text('Capacity / fits', (s) => s.target_capacity, (s, v) => void (s.target_capacity = v), 'col-span-2 sm:col-span-3')}
        </Group>

        <Group title="Dimensions (cm)">
          {dimension('Length', 'length')}
          {dimension('Width / depth', 'width')}
          {dimension('Height', 'height')}
        </Group>

        <Group title="Leather & structure">
          {text('Exterior leather', (s) => s.exterior_leather, (s, v) => void (s.exterior_leather = v), 'col-span-2')}
          {text('Color finish', (s) => s.finish.color_finish, (s, v) => void (s.finish.color_finish = v))}
          {text('Surface finish', (s) => s.finish.surface_finish, (s, v) => void (s.finish.surface_finish = v))}
          {text('Lining', (s) => s.lining_material, (s, v) => void (s.lining_material = v))}
          {text('Structure / temper', (s) => s.structure_temper, (s, v) => void (s.structure_temper = v))}
        </Group>

        <Group title="Pocket layout">
          {POCKET_FIELDS.map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min={0}
                className={inputCls}
                disabled={locked}
                value={spec.pocket_layout[key]}
                onChange={(e) => patch((s) => void (s.pocket_layout[key] = num(e.target.value)))}
              />
            </Field>
          ))}
          {(['id_window', 'coin_zip_pocket'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 pt-5 text-sm text-stone-700">
              <input type="checkbox" disabled={locked} checked={spec.pocket_layout[key]} onChange={(e) => patch((s) => void (s.pocket_layout[key] = e.target.checked))} />
              {key === 'id_window' ? 'ID / photo window' : 'Coin zip pocket'}
            </label>
          ))}
        </Group>

        <Group title="Stitching & edge">
          {text('Stitching method', (s) => s.stitching_method, (s, v) => void (s.stitching_method = v))}
          {text('Stitch pattern', (s) => s.finish.stitch_pattern, (s, v) => void (s.finish.stitch_pattern = v))}
          {text('Thread material', (s) => s.finish.thread_material, (s, v) => void (s.finish.thread_material = v))}
          {text('Thread color', (s) => s.finish.thread_color, (s, v) => void (s.finish.thread_color = v))}
          <Field label="Edge treatment">
            <select
              className={inputCls}
              disabled={locked}
              value={spec.finish.edge_treatment}
              onChange={(e) =>
                patch((s) => {
                  const t = e.target.value as EdgeTreatment;
                  s.finish.edge_treatment = t;
                  s.edge_finish = t === 'UNSPECIFIED' ? '' : EDGE_LABEL[t];
                })
              }
            >
              <option value="UNSPECIFIED">— not chosen —</option>
              {(Object.entries(EDGE_LABEL) as Array<[Exclude<EdgeTreatment, 'UNSPECIFIED'>, string]>).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </Group>

        <Group title="Customization & hardware">
          <Field label="Customization">
            <select className={inputCls} disabled={locked} value={spec.customization.type} onChange={(e) => patch((s) => void (s.customization.type = e.target.value as CustomizationType))}>
              {CUSTOMIZATION_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {text('Text / artwork', (s) => s.customization.detail, (s, v) => void (s.customization.detail = v))}
          {text('Placement', (s) => s.customization.placement, (s, v) => void (s.customization.placement = v))}
          {text('Zipper', (s) => s.finish.zipper, (s, v) => void (s.finish.zipper = v))}
          {text('Strap', (s) => s.finish.strap, (s, v) => void (s.finish.strap = v))}
          {text('Hardware / reinforcement', (s) => s.finish.hardware_notes, (s, v) => void (s.finish.hardware_notes = v))}
        </Group>
      </div>
    </Card>
  );
}
