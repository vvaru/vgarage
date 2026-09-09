import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: 'implicit',
      persistSession: true,
      detectSessionInUrl: true,
      // No background token-refresh timer — nothing pings the server while the tab
      // is idle, so there's no live connection to go stale. The token is refreshed
      // deliberately at the start of a save (ensureFreshSession below) instead of
      // implicitly in the middle of one.
      autoRefreshToken: false,
      // No-op lock: empirically, removing this and using the default navigator
      // lock hung the app on the initial post-login load. Safe for a single-tab PWA.
      lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
    },
    global: {
      // Safety-net timeout only. This must be LONGER than the browser's own dead-
      // connection detection: after the tab idles, the browser holds a dead HTTP/2
      // connection and only *it* can notice and replace it (JS can't force a new
      // one). An overly aggressive abort fires first, cancels the request before
      // the browser gives up on the dead connection, and every retry reuses that
      // same dead connection. 20s gives the browser room to drop it so the retry
      // lands on a fresh one. Normal requests still return in well under a second.
      //
      // CRITICAL: the caller's own signal must be COMBINED with ours, not replaced.
      // supabase-js (auth-js especially) passes its own AbortSignal and relies on
      // it — clobbering it detaches their cancellation from the request they think
      // they control, and their token-refresh promise can then wait forever on work
      // they believe they aborted. That wedged refresh is exactly what a save
      // awaits when the token expired while a form was being filled in.
      fetch: (url, options) => {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          const timeout = AbortSignal.timeout(20_000)
          const theirs = (options as RequestInit | undefined)?.signal
          const signal = theirs && typeof AbortSignal.any === 'function'
            ? AbortSignal.any([theirs, timeout])
            : timeout
          return fetch(url, { ...options, signal })
        }
        return fetch(url, options)
      },
    },
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Token freshness, done on purpose instead of by accident.
//
// Access tokens live one hour. Filling in a receipt can take longer than the
// token has left, so the first write of a save used to trigger an implicit
// refresh deep inside auth-js — the single most wedge-prone moment of the whole
// stack, reached only after the user has already typed everything. A save now
// refreshes up front, bounded, where failure is visible and retryable.
// ─────────────────────────────────────────────────────────────────────────────

const bounded = <T>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('session check timed out')), ms)),
  ])

/** Seconds of token life below which a save refreshes before writing. */
const FRESH_MARGIN_S = 120

/**
 * Make sure the access token will outlive the save that is about to run.
 * Best-effort and always bounded: 'unknown' means "couldn't tell — write anyway
 * and let the write surface a real error", never "block the save".
 */
export async function ensureFreshSession(): Promise<'fresh' | 'refreshed' | 'unknown'> {
  try {
    const { data } = await bounded(supabase.auth.getSession(), 5_000)
    const s = data.session
    if (!s) return 'unknown'
    const secondsLeft = (s.expires_at ?? 0) - Math.floor(Date.now() / 1000)
    if (secondsLeft > FRESH_MARGIN_S) return 'fresh'
    // Bounded just above the 20s fetch abort, so a dead socket gets burned here
    // — on a request that matters less than the writes behind it.
    await bounded(supabase.auth.refreshSession(), 21_000)
    return 'refreshed'
  } catch {
    return 'unknown'
  }
}
