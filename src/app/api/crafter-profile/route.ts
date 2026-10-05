import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/gcp/firestore';
import { OFFERING_IDS } from '@/lib/spec/offerings';
import type { CrafterProfile } from '@/lib/types';

/** The host crafter's profile: branding for the greeting and the domain boundary for the intake assistant. */
export async function GET() {
  return Response.json({ profile: await getStore().getCrafterProfile(), offering_ids: OFFERING_IDS });
}

/** Update the profile. Body: CrafterProfile (allowed_categories must be offering ids). */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<CrafterProfile> | null;
  const current = await getStore().getCrafterProfile();
  const allowed = (body?.allowed_categories ?? current.allowed_categories).filter((id) => OFFERING_IDS.includes(id));
  if (!body?.workshop_name?.trim() || !allowed.length) {
    return Response.json({ error: 'workshop_name and at least one valid allowed_categories entry are required' }, { status: 400 });
  }
  const profile: CrafterProfile = {
    crafter_id: current.crafter_id,
    workshop_name: body.workshop_name.trim(),
    allowed_categories: allowed,
    primary_material: body.primary_material?.trim() || current.primary_material,
    contact_whatsapp: body.contact_whatsapp?.trim() ?? current.contact_whatsapp,
    crafter_name: body.crafter_name?.trim() || current.crafter_name || 'crafter kami',
    crafter_honorific: body.crafter_honorific?.trim() ?? current.crafter_honorific ?? '',
  };
  await getStore().saveCrafterProfile(profile);
  return Response.json({ profile });
}
