import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/**
 * Workspace guard for /[workspace_id]/dashboard/*: only the crafter logged into this workspace gets in; a session for
 * another workspace is sent to its own dashboard, no session to /login.
 */
export default async function WorkspaceDashboardLayout({ children, params }: LayoutProps<'/[workspace_id]/dashboard'>) {
  const { workspace_id } = await params;
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  if (session !== workspace_id) redirect(`/${session}/dashboard`);
  return children;
}
