'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Fetch JSON from `url` now and every `intervalMs`; `refresh()` forces an immediate reload. */
export function usePoll<T>(url: string | null, intervalMs = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);

  const load = useCallback(async () => {
    const target = urlRef.current;
    if (!target) return;
    try {
      const res = await fetch(target, { cache: 'no-store' });
      const json = await res.json();
      if (urlRef.current !== target) return; // url changed while in flight
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json as T);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    urlRef.current = url;
    if (!url) return;
    const first = setTimeout(load, 0);
    const timer = setInterval(load, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [url, intervalMs, load]);

  return { data: url ? data : null, error, refresh: load };
}

export async function postJson<T = unknown>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}
