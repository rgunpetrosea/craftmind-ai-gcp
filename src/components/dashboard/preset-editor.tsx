'use client';

import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import type { CategoryPreset } from '@/lib/types';

const NUMBER_FIELDS: Array<[keyof CategoryPreset, string, number]> = [
  ['base_labor_hours', 'Base labor hours', 0.5],
  ['labor_rate_idr_per_hour', 'Labor rate (IDR/h)', 5000],
  ['hardware_cost_idr_per_item', 'Hardware cost (IDR/item)', 1000],
  ['wastage_pct', 'Leather wastage (0–1)', 0.05],
  ['margin_pct', 'Margin (0–1)', 0.05],
  ['sourcing_price_idr_per_sqft', 'Special-sourcing price (IDR/sqft)', 5000],
];

const DEFAULT_FIELDS: Array<[keyof CategoryPreset['defaults'], string]> = [
  ['lining_material', 'Default lining'],
  ['structure_temper', 'Default structure'],
  ['stitching_method', 'Default stitching'],
  ['edge_finish', 'Default edge finish'],
];

function PresetForm({ initial }: { initial: CategoryPreset }) {
  const [preset, setPreset] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');

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
        {DEFAULT_FIELDS.map(([key, label]) => (
          <label key={key} className="text-sm">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
            <input
              value={preset.defaults[key]}
              onChange={(e) => {
                setPreset({ ...preset, defaults: { ...preset.defaults, [key]: e.target.value } });
                setState('idle');
              }}
              className="mt-1 w-full rounded-lg px-3 py-1.5 ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
            />
          </label>
        ))}
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
