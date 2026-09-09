// ─────────────────────────────────────────────────────────────────────────────
// Every await settles. That is the one rule here.
//
// Supabase REST is stateless — each call is a plain HTTPS request; nothing holds
// a connection open between them. Two different things go stale while a form is
// being filled in, and they need different handling:
//
//   1. The browser's keep-alive socket dies. Only the browser can notice and
//      replace it, so the global 20s abort in lib/supabase.ts must fire FIRST —
//      any shorter timer cancels the request before the browser gives up on the
//      dead socket, and every retry then reuses it. (That was the original
//      three-failed-retries bug.)
//
//   2. The auth layer wedges BEFORE any fetch is issued (an expired token being
//      refreshed by machinery that never settles). The fetch abort cannot see
//      this, so without an outer deadline the save hangs forever on "Saving…"
//      with no error. (That was the stuck-save bug.)
//
// So: writes carry an outer deadline of 25s — ABOVE the 20s fetch abort, so
// rule 1 is preserved, but nothing can await forever, so rule 2 is closed.
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Above the 20s fetch abort by design — see the header comment. */
export const SAVE_DEADLINE_MS = 25_000

/**
 * A write: bounded so it can never hang the UI, but never bounded tighter than
 * the browser-level abort that actually recovers dead sockets.
 */
export function write<T>(promise: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('save attempt timed out')), SAVE_DEADLINE_MS)),
  ])
}

/**
 * Bound a READ so a wedged attempt shows a fallback instead of an endless
 * spinner. For reads with something cached to fall back on; writes use write().
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('request timed out')), ms)),
  ])
}

/**
 * Retry an operation whose identifiers are stable, so a repeat writes the same
 * rows rather than new ones. Backoff escalates in seconds, not milliseconds —
 * a dead socket only clears once the browser has failed a request on it.
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
 * Poke the server once before a batch save, so a dead socket is spent on a
 * request that costs nothing instead of on the first of twenty writes.
 * Bounded just above the fetch abort: by the time it gives up, the browser has
 * discarded the dead socket and the writes land on a fresh one. A false return
 * is not a reason to skip the save — it's a reason the save's own retries exist.
 */
export async function warmUp(probe: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  try {
    const { error } = await withTimeout(probe(), 21_000)
    return !error
  } catch {
    return false
  }
}
