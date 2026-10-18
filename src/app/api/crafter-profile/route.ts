import type { NextRequest } from 'next/server';
import { workspaceFromRequest } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import { OFFERING_IDS } from '@/lib/spec/offerings';
import type { CraftFamily, CrafterProfile } from '@/lib/types';
import { familiesOf, publicProfile } from '@/lib/workspaces';

const FAMILIES: CraftFamily[] = ['LEATHER', 'FURNITURE'];

/**
 * A crafter workspace profile (Firestore `crafter_workspaces/{crafter_id}`): branding for the greeting, the domain
 * boundary for the intake assistant, the craft families it covers and the WhatsApp number that routes chats to it.
 * GET is public branding (the simulator shows the workshop name), so ?workspace_id= may name any workspace; the login
 * is never returned. ?all=1 lists every workspace (public fields only).
 */
export async function GET(request: NextRequest) {
  const ws = workspaceFromRequest(request, { allowOverride: true });
  if ('error' in ws) return ws.error;
  const store = getStore();
  const profile = await store.getCrafterProfile(ws.workspaceId);
  return Response.json({
    profile: publicProfile(profile),
    // effective families (explicit, or derived from the offerings); not part of `profile`, so a PUT never freezes them
    craft_families: familiesOf(profile),
    offering_ids: OFFERING_IDS,
    ...(request.nextUrl.searchParams.get('all') && { workspaces: (await store.listWorkspaces()).map(publicProfile) }),
  });
}

/** Update the caller's own workspace (the session's, else ?workspace_id=, else the default). Body: CrafterProfile. */
export async function PUT(request: NextRequest) {
  const ws = workspaceFromRequest(request);
  if ('error' in ws) return ws.error;
  const body = (await request.json().catch(() => null)) as Partial<CrafterProfile> | null;
  const current = await getStore().getCrafterProfile(ws.workspaceId);
  const allowed = (body?.allowed_categories ?? current.allowed_categories).filter((id) => OFFERING_IDS.includes(id));
  if (!body?.workshop_name?.trim() || !allowed.length) {
    return Response.json({ error: 'workshop_name and at least one valid allowed_categories entry are required' }, { status: 400 });
  }
  const families = (body.craft_families ?? current.craft_families ?? []).filter((f) => FAMILIES.includes(f));
  const profile: CrafterProfile = {
    crafter_id: current.crafter_id,
    workshop_name: body.workshop_name.trim(),
    allowed_categories: allowed,
    primary_material: body.primary_material?.trim() || current.primary_material,
    contact_whatsapp: body.contact_whatsapp?.trim() ?? current.contact_whatsapp,
    crafter_name: body.crafter_name?.trim() || current.crafter_name || 'crafter kami',
    crafter_honorific: body.crafter_honorific?.trim() ?? current.crafter_honorific ?? '',
    ...(families.length && { craft_families: families }),
    ...((body.wa_phone_number_id ?? current.wa_phone_number_id) && { wa_phone_number_id: (body.wa_phone_number_id ?? current.wa_phone_number_id)!.trim() }),
  };
  await getStore().saveCrafterProfile(profile);
  return Response.json({ profile: publicProfile(profile) });
}
