import type { PatternAndBom } from '@/lib/types';
import { CM2_PER_SQFT, componentAreaCm2, netExteriorAreaCm2, NON_EXTERIOR_PART } from '@/lib/utils/geometry';

/** 2D pattern component breakdown with per-piece area and the SqFt total. */
export function BomTable({ bom, wastagePct }: { bom: PatternAndBom; wastagePct?: number }) {
  if (!bom.components_breakdown.length) {
    return <p className="p-4 text-sm text-stone-500">Pattern breakdown is generated once the specification is complete.</p>;
  }
  const net = netExteriorAreaCm2(bom.components_breakdown);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Component</th>
            <th className="px-2 py-2 text-right font-medium">Qty</th>
            <th className="px-2 py-2 font-medium">Cut size (cm)</th>
            <th className="px-4 py-2 text-right font-medium">Area (cm²)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {bom.components_breakdown.map((c, i) => {
            const secondary = NON_EXTERIOR_PART.test(c.part_name);
            return (
              <tr key={`${c.part_name}-${i}`} className={secondary ? 'text-stone-400' : 'text-stone-800'}>
                <td className="px-4 py-1.5">
                  {c.part_name}
                  {secondary && <span className="ml-1.5 text-[10px] uppercase">(other material)</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.qty}</td>
                <td className="px-2 py-1.5 tabular-nums">{c.dimensions_cm}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{Math.round(componentAreaCm2(c)).toLocaleString('id-ID')}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-stone-200 text-stone-800">
          <tr>
            <td colSpan={3} className="px-4 py-2 text-xs text-stone-500">
              Net exterior leather {Math.round(net).toLocaleString('id-ID')} cm² ÷ {CM2_PER_SQFT} cm²/sqft
              {wastagePct !== undefined && ` × ${1 + wastagePct} wastage`}
            </td>
            <td className="px-4 py-2 text-right text-base font-bold text-leather-700 tabular-nums">{bom.estimated_leather_sqft} sqft</td>
          </tr>
        </tfoot>
      </table>
      <div className="grid gap-4 border-t border-stone-100 p-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Hardware</p>
          {bom.hardware_list.length ? (
            <ul className="list-inside list-disc text-sm text-stone-700">
              {bom.hardware_list.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">None</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Estimated labor</p>
          <p className="text-2xl font-bold text-stone-800">{bom.estimated_labor_hours} h</p>
        </div>
      </div>
    </div>
  );
}
