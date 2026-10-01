'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import { schemaOf } from '@/lib/spec/catalog';
import type { CategoryPreset } from '@/lib/types';

const inputCls = 'mt-1 w-full rounded-lg bg-white px-3 py-1.5 ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500';

const NUMBER_FIELDS: Array<[keyof CategoryPreset, string, number]> = [
  ['base_labor_hours', 'Base labor hours', 0.5],
  ['labor_rate_idr_per_hour', 'Labor rate (IDR/h)', 5000],
  ['hardware_cost_idr_per_item', 'Hardware cost (IDR/item)', 1000],
  ['wastage_pct', 'Material wastage (0–1)', 0.05],
  ['margin_pct', 'Margin (0–1)', 0.05],
  ['sourcing_price_idr_per_sqft', 'Special-sourcing price (IDR/sqft)', 5000],
];

function PresetForm({ initial }: { initial: CategoryPreset }) {
  const [preset, setPreset] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const schema = schemaOf(preset.category);
  const addable = Object.entries(schema.fields).filter(([k, f]) => f.type !== 'dimensions' && !(k in preset.defaults));

  async function save() {
    setState('saving');
    try {
      await postJson('/api/presets', preset, 'PUT');
      setState('saved');
    } catch (err) {
      setState(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <Card>
      <CardHeader
        title={preset.label}
        action={
          <Button size="sm" onClick={save} disabled={state === 'saving'}>
            {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {state === 'saved' ? 'Saved' : 'Save'}
          </Button>
        }
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {NUMBER_FIELDS.map(([key, label, step]) => (
          <label key={key} className="text-sm">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
            <input
              type="number"
              step={step}
              value={preset[key] as number}
              onChange={(e) => {
                setPreset({ ...preset, [key]: Number(e.target.value) });
                setState('idle');
              }}
              className="mt-1 w-full rounded-lg px-3 py-1.5 ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
            />
          </label>
        ))}
      </div>
      <div className="border-t border-stone-100 p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Workshop defaults · used when the client says &ldquo;terserah&rdquo; ({schema.label} fields only)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(preset.defaults).map(([key, value]) => {
            const field = schema.fields[key];
            if (!field) return null;
            const set = (v: string | number | boolean) => {
              setPreset({ ...preset, defaults: { ...preset.defaults, [key]: v } });
              setState('idle');
            };
            return (
              <label key={key} className="text-sm">
                <span className="flex items-center justify-between text-[11px] uppercase tracking-wide text-stone-500">
                  {field.label}
                  <button
                    type="button"
                    title="Remove default"
                    className="text-stone-300 hover:text-red-600"
                    onClick={() => {
                      const { [key]: _removed, ...rest } = preset.defaults;
                      void _removed;
                      setPreset({ ...preset, defaults: rest });
                      setState('idle');
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
                {field.type === 'enum' ? (
                  <select value={String(value)} onChange={(e) => set(e.target.value)} className={inputCls}>
                    {Object.entries(field.options as Record<string, string>).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'boolean' ? (
                  <input type="checkbox" className="mt-2 block" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={String(value ?? '')}
                    onChange={(e) => set(field.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className={inputCls}
                  />
                )}
              </label>
            );
          })}
        </div>
        {addable.length > 0 && (
          <select
            aria-label="Add a workshop default"
            value=""
            onChange={(e) => {
              const field = schema.fields[e.target.value];
              if (!field) return;
              const first = field.type === 'enum' ? Object.keys(field.options)[0] : field.type === 'number' ? 0 : field.type === 'boolean' ? false : '';
              setPreset({ ...preset, defaults: { ...preset.defaults, [e.target.value]: first } });
              setState('idle');
            }}
            className="mt-3 rounded-lg bg-white px-2.5 py-1.5 text-xs text-stone-700 ring-1 ring-stone-300"
          >
            <option value="">+ Add default…</option>
            {addable.map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!['idle', 'saving', 'saved'].includes(state) && <p className="px-4 pb-4 text-xs text-red-600">{state}</p>}
    </Card>
  );
}

export function PresetEditor() {
  // Load once; each form owns its edits afterwards.
  const { data } = usePoll<{ presets: CategoryPreset[] }>('/api/presets', 60 * 60 * 1000);
  if (!data) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-stone-400" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.presets.map((p) => (
        <PresetForm key={p.category} initial={p} />
      ))}
    </div>
  );
}
