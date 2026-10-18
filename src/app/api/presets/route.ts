import type { NextRequest } from 'next/server';
import { workspaceFromRequest } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import type { CategoryPreset } from '@/lib/types';

/** The workspace's OWN category presets (session workspace, else ?workspace_id=, else the default). */
export async function GET(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  return Response.json({ workspace_id: ws.workspaceId, presets: await getStore().listPresets(ws.workspaceId) });
}

/** Update one of the workspace's category presets. */
export async function PUT(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  const preset = (await request.json().catch(() => null)) as CategoryPreset | null;
  if (!preset?.category) return Response.json({ error: 'category is required' }, { status: 400 });
  await getStore().savePreset(preset, ws.workspaceId);
  return Response.json({ preset });
}
