/**
 * Per-session mutex for webhook handling. Two messages from the same phone processed concurrently could each resolve
 * the session before the other saved it (two draft orders, two AI runs for one chat) or interleave their order writes.
 * Requests for the same key run one after another; different sessions stay parallel.
 *
 * In-process, like the debouncer: fine for `next dev` and a single Cloud Run instance. Multi-instance production needs a
 * Firestore transaction / lease on the conversation document instead.
 */

const globalForLocks = globalThis as unknown as { __craftmindSessionLocks?: Map<string, Promise<unknown>> };
const tails = (globalForLocks.__craftmindSessionLocks ??= new Map());

export async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    // last one out cleans up, so the map doesn't grow with every phone number ever seen
    if (tails.get(key) === tail) tails.delete(key);
  }
}
