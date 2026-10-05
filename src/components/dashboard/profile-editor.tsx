'use client';

import { Loader2, Save, Store } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import { greetingBubble, mismatchMessage, mockupCapMessage, PRODUCT_QUESTION, refusalMessage, sessionCapMessage } from '@/lib/spec/guardrails';
import { OFFERINGS } from '@/lib/spec/offerings';
import type { CrafterProfile } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

const inputCls = 'mt-1 w-full rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500';

function ProfileForm({ initial }: { initial: CrafterProfile }) {
  const [profile, setProfile] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const set = (patch: Partial<CrafterProfile>) => {
    setProfile({ ...profile, ...patch });
    setState('idle');
  };
  const toggle = (id: string) =>
    set({ allowed_categories: profile.allowed_categories.includes(id) ? profile.allowed_categories.filter((c) => c !== id) : [...profile.allowed_categories, id] });
  const firstNotAllowed = OFFERINGS.find((o) => !profile.allowed_categories.includes(o.id));

  async function save() {
    setState('saving');
    try {
      const res = await postJson<{ profile: CrafterProfile }>('/api/crafter-profile', profile, 'PUT');
      setProfile(res.profile);
      setState('saved');
    } catch (err) {
      setState(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <Card>
      <CardHeader
        title="Workshop profile"
        icon={<Store className="h-4 w-4 text-leather-500" />}
        action={
          <Button size="sm" onClick={save} disabled={state === 'saving' || !profile.workshop_name.trim() || !profile.allowed_categories.length}>
            {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {state === 'saved' ? 'Saved' : 'Save'}
          </Button>
        }
      />
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">Workshop name</span>
            <input className={inputCls} value={profile.workshop_name} onChange={(e) => set({ workshop_name: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">Primary material</span>
            <input className={inputCls} value={profile.primary_material} placeholder="genuine leather / leathergoods" onChange={(e) => set({ primary_material: e.target.value })} />
          </label>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wide text-stone-500">Honorific</span>
              <input className={inputCls} value={profile.crafter_honorific} placeholder="Mas / Mbak" onChange={(e) => set({ crafter_honorific: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-[11px] uppercase tracking-wide text-stone-500">Crafter name (takes over handed-off chats)</span>
              <input className={inputCls} value={profile.crafter_name} placeholder="Fendy" onChange={(e) => set({ crafter_name: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">Contact WhatsApp</span>
            <input className={inputCls} value={profile.contact_whatsapp} placeholder="+62…" onChange={(e) => set({ contact_whatsapp: e.target.value })} />
          </label>
          <fieldset>
            <legend className="text-[11px] uppercase tracking-wide text-stone-500">Allowed categories (everything else is politely declined)</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {OFFERINGS.map((o) => {
                const on = profile.allowed_categories.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(o.id)}
                    className={cn('rounded-full px-3 py-1 text-xs ring-1', on ? 'bg-leather-700 text-white ring-leather-700' : 'bg-white text-stone-600 ring-stone-300 hover:bg-stone-50')}
                  >
                    {o.label_id} <span className="opacity-60">· {o.id}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {!['idle', 'saving', 'saved'].includes(state) && <p className="text-xs text-red-600">{state}</p>}
        </div>

        <div className="space-y-2 rounded-xl bg-wa-wallpaper p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">What clients will see</p>
          {[
            ['First message', greetingBubble(profile)],
            ['', PRODUCT_QUESTION],
            ['Off-topic / prompt injection', refusalMessage(profile)],
            ['3rd mockup request', mockupCapMessage(profile)],
            ['AI turn budget used up', sessionCapMessage(profile)],
            ...(firstNotAllowed ? [[`Asks for ${firstNotAllowed.label_id}`, mismatchMessage(profile, firstNotAllowed.label_id)]] : []),
          ].map(([label, text], i) => (
            <div key={i}>
              {label && <p className="mb-0.5 mt-2 text-[10px] uppercase tracking-wide text-stone-500">{label}</p>}
              <p className="w-fit max-w-[90%] rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-stone-800 shadow-sm">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function ProfileEditor() {
  const { data } = usePoll<{ profile: CrafterProfile }>('/api/crafter-profile', 60 * 60 * 1000);
  if (!data) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-stone-400" />;
  return <ProfileForm initial={data.profile} />;
}
