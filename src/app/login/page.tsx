'use client';

import { Armchair, Loader2, LogIn, Scissors } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Demo workspaces (mock auth). The password is the same for both demo accounts. */
const DEMO_ACCOUNTS = [
  { username: 'leather_artisan', label: 'Leather Studio', hint: 'Wallets, bags, belts, shoes', icon: Scissors },
  { username: 'wood_artisan', label: 'Wood Studio', hint: 'Furniture & built-ins', icon: Armchair },
];
const DEMO_PASSWORD = 'craft123';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login(u = username, p = password) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      const data = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) throw new Error(data.error ?? 'Login failed');
      router.push(data.redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="space-y-1 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-leather-500">CraftMind AI · Crafter workspace</p>
        <h1 className="text-2xl font-bold text-stone-900">Sign in to your workshop</h1>
        <p className="text-sm text-stone-500">Each workshop sees only its own orders, stock and presets.</p>
      </div>

      <form
        className="space-y-3 rounded-xl bg-white p-5 ring-1 ring-stone-200"
        onSubmit={(e) => {
          e.preventDefault();
          void login();
        }}
      >
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-stone-500">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-stone-500">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 focus:outline-none focus:ring-leather-500"
          />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{error}</p>}
        <Button className="w-full" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
        </Button>
      </form>

      <div className="space-y-2">
        <p className="text-center text-[11px] uppercase tracking-wide text-stone-500">Demo workspaces (password {DEMO_PASSWORD})</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map(({ username: u, label, hint, icon: Icon }) => (
            <button
              key={u}
              type="button"
              disabled={busy}
              onClick={() => {
                setUsername(u);
                setPassword(DEMO_PASSWORD);
                void login(u, DEMO_PASSWORD);
              }}
              className="rounded-xl bg-white p-3 text-left ring-1 ring-stone-200 transition hover:ring-leather-400 disabled:opacity-50"
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
                <Icon className="h-4 w-4 text-leather-600" /> {label}
              </p>
              <p className="mt-0.5 text-[11px] text-stone-500">{hint}</p>
              <p className="mt-1 font-mono text-[10px] text-stone-400">{u}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
