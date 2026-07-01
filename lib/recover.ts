// Bound a promise so a wedged Supabase call (e.g. a token refresh stuck on a
// stale connection, which blocks the query before the fetch even starts) can
// never leave a page spinning forever.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = 'request'): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}

// Reload once to rebuild a wedged client — this is the "manual refresh that
// usually works", automated. Guarded via sessionStorage so a genuinely-down
// connection can't cause a reload loop: if we reloaded in the last 30s we give
// up and let the caller surface an error instead.
export function recoverStuck(): boolean {
  if (typeof window === 'undefined') return false
  const KEY = 'vgarage_recovered_at'
  const last = Number(sessionStorage.getItem(KEY) || '0')
  if (Date.now() - last < 30_000) return false
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  window.location.reload()
  return true
}
