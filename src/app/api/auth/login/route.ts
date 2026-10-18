import type { NextRequest } from 'next/server';
import { passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE, sessionValue } from '@/lib/auth';
import { getStore } from '@/lib/gcp/firestore';
import { familiesOf } from '@/lib/workspaces';

/**
 * Mock crafter login. Body: { username, password }. Credentials live on the workspace document
 * (`crafter_workspaces/{id}.login`). Success sets the signed session cookie and returns the workspace's dashboard path.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim().toLowerCase() ?? '';
  const password = body?.password ?? '';
  if (!username || !password) return Response.json({ error: 'Username and password are required' }, { status: 400 });

  const workspace = await getStore().findWorkspaceByUsername(username);
  if (!workspace?.login || !passwordMatches(username, password, workspace.login.password_hash)) {
    return Response.json({ error: 'Wrong username or password' }, { status: 401 });
  }
  const response = Response.json({
    workspace_id: workspace.crafter_id,
    workshop_name: workspace.workshop_name,
    craft_families: familiesOf(workspace),
    redirect: `/${workspace.crafter_id}/dashboard`,
  });
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionValue(workspace.crafter_id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return response;
}
