import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { OrderPayload } from '@/lib/types';
import { DEFAULT_CRAFTER_ID } from '@/lib/workspaces';

/**
 * Mock crafter authentication (demo-grade, not production auth). A login sets an HMAC-signed session cookie holding the
 * workspace id; dashboard pages and the crafter APIs take their workspace from it, so a crafter only ever sees their
 * own orders, inventory and presets. Requests without a session (the WhatsApp simulator, the scenario runner, webhooks)
 * name the workspace explicitly (`workspace_id` / `crafter_id`) or use the default workspace. A session that asks for
 * another workspace's data is refused.
 */

export const SESSION_COOKIE = 'cm_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const secret = () => process.env.AUTH_SECRET ?? 'craftmind-dev-session-secret';
const sign = (workspaceId: string) => createHmac('sha256', secret()).update(workspaceId).digest('base64url');

/** sha256("<username>:<password>"), the format of `CrafterProfile.login.password_hash`. */
export const passwordHash = (username: string, password: string) => createHash('sha256').update(`${username}:${password}`).digest('hex');

export function passwordMatches(username: string, password: string, hash: string): boolean {
  const a = Buffer.from(passwordHash(username, password), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const sessionValue = (workspaceId: string) => `${workspaceId}.${sign(workspaceId)}`;

/** The workspace id in a session cookie value, or null when it is missing / tampered with. */
export function verifySession(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  return mac.length === expected.length && timingSafeEqual(mac, expected) ? id : null;
}

export type WorkspaceResolution = { workspaceId: string; session: string | null } | { error: Response };

/**
 * The workspace a request acts on: the session's, else the explicit `workspace_id` / `crafter_id` query parameter, else
 * the default workspace. With `allowOverride` (public reads such as the simulator's workshop name) an explicit
 * parameter wins even over a session; otherwise a session asking for another workspace gets 403.
 */
export function workspaceFromRequest(request: NextRequest, opts: { allowOverride?: boolean } = {}): WorkspaceResolution {
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const param = request.nextUrl.searchParams.get('workspace_id') ?? request.nextUrl.searchParams.get('crafter_id');
  if (param && session && param !== session && !opts.allowOverride) {
    return { error: Response.json({ error: 'This workspace belongs to another crafter' }, { status: 403 }) };
  }
  return { workspaceId: (opts.allowOverride ? param : null) ?? session ?? param ?? DEFAULT_CRAFTER_ID, session };
}

/** An order a logged-in crafter may not see behaves as missing (no cross-workspace leaks). */
export function orderHidden(request: NextRequest, order: Pick<OrderPayload, 'crafter_id'>): boolean {
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  return Boolean(session && order.crafter_id !== session);
}
