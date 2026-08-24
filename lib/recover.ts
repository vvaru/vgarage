// ─────────────────────────────────────────────────────────────────────────────
// One request, one timeout.
//
// Supabase REST is already stateless — every call is a plain HTTPS request, and
// with autoRefreshToken off nothing touches the server while the tab idles. What
// goes stale is the BROWSER's keep-alive socket: after the machine sleeps or the
// network moves, the browser still holds an HTTP/2 connection that is dead but
// not yet known to be dead. Only the browser can notice and replace it; JS has no
// way to force a new one.
//
// So the rule is: give the browser time to work that out. lib/supabase.ts sets a
// 20s AbortSignal as the single timeout. Racing a shorter timer here abandons the
// request before the browser gives up on the dead socket, and every retry then
// lands on that same dead socket — which is why saves used to fail three times in
// a row and only a page refresh fixed it.
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * A write. No second timer — the global abort in lib/supabase.ts governs.
 * Exists as a named wrapper so the intent is legible at the call site and so
 * write behaviour has one place to change.
 */
export const write = <T>(promise: PromiseLike<T>): Promise<T> => Promise.resolve(promise)

/**
 * Bound a READ so a wedged attempt shows a fallback instead of an endless
 * spinner. Only for reads that have something cached to fall back to — never
 * for writes, where giving up early is how data gets lost.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('request timed out')), ms)),
  ])
}

/**
 * Retry an operation whose identifiers are stable, so a repeat writes the same
 * rows rather than new ones.
 *
 * Backoff matters more than the number of attempts: a dead socket only clears
 * once the browser has failed a request on it, so the pause between tries has to
 * be measured in seconds. The old 800ms retried while the socket was still dead
 * and simply failed again.
 */
export async function withRetry<T>(fn: () => PromiseLike<T>, retries = 1, delayMs = 2500): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(delayMs * attempt) // 2.5s, then 5s, then 7.5s…
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/**
 * Poke the server once before a long save.
 *
 * Filling in a receipt takes minutes, by which point the socket opened on page
 * load is usually dead. Discovering that on the first of twenty writes means the
 * batch dies half-done. A cheap warm-up spends the dead socket on a request that
 * costs nothing, so the writes that follow land on a live one.
 *
 * Returns false if it never got through; the caller should still try, because a
 * failed probe is not proof the writes will fail.
 */
export async function warmUp(probe: () => PromiseLike<{ error: unknown }>, attempts = 2): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1000)
    try {
      const { error } = await probe()
      if (!error) return true
    } catch { /* dead socket; the next try may find a fresh one */ }
  }
  return false
}
