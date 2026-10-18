import type { NextRequest } from 'next/server';
import { workspaceFromRequest } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import type { InventoryItem } from '@/lib/types';

/** The workspace's OWN stock (session workspace, else ?workspace_id=, else the default). */
export async function GET(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  const items = await getStore().listInventory(ws.workspaceId);
  return Response.json({ workspace_id: ws.workspaceId, items: items.sort((a, b) => a.name.localeCompare(b.name)) });
}

/** Upsert a stock item in the workspace's own inventory. */
export async function PUT(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  const item = (await request.json().catch(() => null)) as InventoryItem | null;
  if (!item?.stock_id || !item.name || !item.material_type) {
    return Response.json({ error: 'stock_id, name and material_type are required' }, { status: 400 });
  }
  const saved: InventoryItem = {
    ...item,
    material_type: item.material_type.toLowerCase(),
    color: item.color.toLowerCase(),
    thickness_mm: Number(item.thickness_mm),
    available_sqft: Number(item.available_sqft),
    price_idr_per_sqft: Number(item.price_idr_per_sqft),
  };
  await getStore().saveInventoryItem(saved, ws.workspaceId);
  return Response.json({ item: saved });
}
