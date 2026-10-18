'use client';

import { Boxes, LayoutDashboard, LogIn, LogOut, MessageCircle, Scissors, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DEMO_WORKSPACES } from '@/lib/workspaces';
import { cn } from '@/lib/utils/cn';

/** Workspace id of a /[workspace_id]/dashboard/* path. */
const workspaceOf = (pathname: string) => /^\/([^/]+)\/dashboard(\/|$)/.exec(pathname)?.[1];

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  // the client-facing gallery must not show the crafter's navigation
  if (pathname.startsWith('/gallery')) return null;
  const workspace = workspaceOf(pathname);
  const links = [
    { href: '/', label: 'Simulator', icon: MessageCircle },
    ...(workspace
      ? [
          { href: `/${workspace}/dashboard`, label: 'Draft Orders', icon: LayoutDashboard },
          { href: `/${workspace}/dashboard/presets`, label: 'Presets', icon: SlidersHorizontal },
          { href: `/${workspace}/dashboard/inventory`, label: 'Inventory', icon: Boxes },
        ]
      : [{ href: '/login', label: 'Crafter login', icon: LogIn }]),
  ];
  const label = DEMO_WORKSPACES.find((w) => w.id === workspace)?.label ?? workspace;

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-leather-800">
          <Scissors className="h-5 w-5" />
          CraftMind<span className="font-normal text-stone-400">AI</span>
        </Link>
        <div className="flex gap-1 overflow-x-auto">
          {links.map(({ href, label: text, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                pathname === href ? 'bg-leather-50 font-medium text-leather-800' : 'text-stone-600 hover:bg-stone-100',
              )}
            >
              <Icon className="h-4 w-4" />
              {text}
            </Link>
          ))}
        </div>
        {workspace && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full bg-leather-50 px-2.5 py-0.5 text-[11px] font-medium text-leather-800 ring-1 ring-leather-200 sm:inline">{label}</span>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                router.push('/login');
                router.refresh();
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
