import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/** Old /dashboard links: to the logged-in crafter's workspace dashboard, or to the login. */
export default async function DashboardRedirect() {
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  redirect(session ? `/${session}/dashboard` : '/login');
}
