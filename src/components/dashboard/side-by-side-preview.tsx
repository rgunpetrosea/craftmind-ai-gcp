/* eslint-disable @next/next/no-img-element -- media is data URLs or GCS objects */
import { ArrowRight, ImageOff, PenLine, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

function Pane({ label, icon, src, empty }: { label: string; icon: ReactNode; src?: string; empty: string }) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col">
      <figcaption className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
        {icon}
        {label}
      </figcaption>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200">
        {src ? (
          <img src={src} alt={label} className="h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-stone-400">
            <ImageOff className="h-6 w-6" />
            {empty}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Original client sketch vs AI studio mockup — the core "wow" moment of the review screen. */
export function SideBySidePreview({ sketchUrl, mockupUrl }: { sketchUrl?: string; mockupUrl?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Pane label="Client sketch" icon={<PenLine className="h-3.5 w-3.5" />} src={sketchUrl} empty="No sketch sent — rendered from chat only" />
      <ArrowRight className="mt-6 h-5 w-5 shrink-0 text-leather-500" />
      <Pane label="AI studio mockup" icon={<Sparkles className="h-3.5 w-3.5" />} src={mockupUrl} empty="Mockup appears once the spec is complete" />
    </div>
  );
}
