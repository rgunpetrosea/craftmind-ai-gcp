import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl bg-white ring-1 ring-stone-200 shadow-sm', className)} {...props} />;
}

export function CardHeader({ title, icon, action }: { title: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}
