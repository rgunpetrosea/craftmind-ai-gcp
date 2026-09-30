import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import type { InventoryItem } from '@/lib/types';

export async function GET() {
  const items = await getStore().listInventory();
  return Response.json({ items: items.sort((a, b) => a.name.localeCompare(b.name)) });
}

/** Upsert a stock item. */
export async function PUT(request: NextRequest) {
  const item = (await request.json().catch(() => null)) as InventoryItem | null;
  if (!item?.stock_id || !item.name || !item.leather_type) {
    return Response.json({ error: 'stock_id, name and leather_type are required' }, { status: 400 });
  }
  await getStore().saveInventoryItem({
    ...item,
    leather_type: item.leather_type.toLowerCase(),
    color: item.color.toLowerCase(),
    thickness_mm: Number(item.thickness_mm),
    available_sqft: Number(item.available_sqft),
    price_idr_per_sqft: Number(item.price_idr_per_sqft),
  });
  return Response.json({ item });
}
