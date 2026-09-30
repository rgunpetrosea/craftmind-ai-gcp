import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import type { CategoryPreset } from '@/lib/types';

export async function GET() {
  return Response.json({ presets: await getStore().listPresets() });
}

/** Update a category master preset. */
export async function PUT(request: NextRequest) {
  const preset = (await request.json().catch(() => null)) as CategoryPreset | null;
  if (!preset?.category) return Response.json({ error: 'category is required' }, { status: 400 });
  await getStore().savePreset(preset);
  return Response.json({ preset });
}
