'use client';

import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import type { InventoryItem } from '@/lib/types';
import { formatIDR } from '@/lib/utils/format';

const LOW_STOCK_SQFT = 10;

const EMPTY: InventoryItem = {
  stock_id: '',
  name: '',
  leather_type: 'veg-tan',
  color: '',
  thickness_mm: 1.4,
  available_sqft: 0,
  price_idr_per_sqft: 0,
  supplier: '',
  origin: 'LOCAL',
};

export function InventoryTable() {
  const { data, refresh } = usePoll<{ items: InventoryItem[] }>('/api/inventory', 10_000);
  const [form, setForm] = useState<InventoryItem>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(item: InventoryItem) {
    setSaving(true);
    setError(null);
    try {
      await postJson('/api/inventory', item, 'PUT');
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const input = (key: keyof InventoryItem, placeholder: string, type = 'text') => (
    <input
      type={type}
      step="any"
      placeholder={placeholder}
      value={form[key] as string | number}
      onChange={(e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
      className="w-full rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
    />
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Leather stock" />
        {!data ? (
          <Loader2 className="m-6 h-5 w-5 animate-spin text-stone-400" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Material</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Supplier</th>
                  <th className="px-2 py-2 text-right font-medium">Price / sqft</th>
                  <th className="px-4 py-2 text-right font-medium">On shelf (sqft)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.items.map((item) => (
                  <tr key={item.stock_id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-stone-800">{item.name}</p>
                      <p className="font-mono text-[10px] text-stone-400">{item.stock_id}</p>
                    </td>
                    <td className="px-2 py-2 capitalize text-stone-600">
                      {item.leather_type} · {item.color} · {item.thickness_mm}mm
                    </td>
                    <td className="px-2 py-2 text-stone-600">
                      {item.supplier} <Badge tone={item.origin === 'IMPORT' ? 'blue' : 'neutral'}>{item.origin}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatIDR(item.price_idr_per_sqft)}</td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        step="0.5"
                        defaultValue={item.available_sqft}
                        onBlur={(e) => Number(e.target.value) !== item.available_sqft && save({ ...item, available_sqft: Number(e.target.value) })}
                        className="w-20 rounded px-2 py-1 text-right tabular-nums ring-1 ring-stone-200 focus:outline-none focus:ring-leather-500"
                      />
                      {item.available_sqft < LOW_STOCK_SQFT && (
                        <Badge tone="amber" className="ml-2">
                          low
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Add stock item" icon={<Plus className="h-4 w-4 text-leather-500" />} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save(form)) setForm(EMPTY);
          }}
          className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          {input('stock_id', 'Stock ID (e.g. STK-VT-BLK-16)')}
          {input('name', 'Display name (Veg-Tan Black 1.6mm)')}
          <select
            value={form.leather_type}
            onChange={(e) => setForm({ ...form, leather_type: e.target.value })}
            className="rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-stone-300"
          >
            {['veg-tan', 'epsom', 'pull-up', 'crazy horse', 'nappa', 'saffiano'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {input('color', 'Color (english, e.g. black)')}
          {input('thickness_mm', 'Thickness mm', 'number')}
          {input('available_sqft', 'Available sqft', 'number')}
          {input('price_idr_per_sqft', 'Price IDR/sqft', 'number')}
          {input('supplier', 'Supplier')}
          <select
            value={form.origin}
            onChange={(e) => setForm({ ...form, origin: e.target.value as InventoryItem['origin'] })}
            className="rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-stone-300"
          >
            <option>LOCAL</option>
            <option>IMPORT</option>
          </select>
          <Button disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</Button>
        </form>
        {error && <p className="px-4 pb-4 text-xs text-red-600">{error}</p>}
      </Card>
    </div>
  );
}
