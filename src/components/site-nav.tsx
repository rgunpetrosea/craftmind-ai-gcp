'use client';

import { Boxes, LayoutDashboard, MessageCircle, Scissors, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const LINKS = [
  { href: '/', label: 'Simulator', icon: MessageCircle },
  { href: '/dashboard', label: 'Draft Orders', icon: LayoutDashboard },
  { href: '/dashboard/configurator', label: 'Presets', icon: SlidersHorizontal },
  { href: '/dashboard/inventory', label: 'Inventory', icon: Boxes },
];

export function SiteNav() {
  const pathname = usePathname();
  // the client-facing gallery must not show the crafter's navigation
  if (pathname.startsWith('/gallery')) return null;
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-leather-800">
          <Scissors className="h-5 w-5" />
          CraftMind<span className="font-normal text-stone-400">AI</span>
        </Link>
        <div className="flex gap-1 overflow-x-auto">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                pathname === href ? 'bg-leather-50 font-medium text-leather-800' : 'text-stone-600 hover:bg-stone-100',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
