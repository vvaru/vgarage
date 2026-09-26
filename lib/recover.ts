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

import { ensureFreshSession } from '@/lib/supabase'

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
      // A refusal the server will repeat (duplicate key, missing column) is not
      // worth asking twice — only trouble on the way there is.
      if ((e as { permanent?: boolean })?.permanent) throw e
      lastErr = e
    }
  }
  throw lastErr
}

/** Trouble reaching the server, as opposed to the server saying no. */
function isTransient(message: string): boolean {
  return /timed out|timeout|abort|failed to fetch|fetch failed|network|socket|connection|502|503|504|gateway/i.test(message)
}

/** A read, bounded just above the fetch abort: a wedged one shows a fallback,
 *  never an endless spinner. */
export function read<T>(promise: PromiseLike<T>): Promise<T> {
  return withTimeout(promise, 21_000)
}

export type SaveOutcome = { ok: true } | { ok: false; message: string }

/**
 * What a save IS, in one place, so every form in the app behaves the same:
 * the token is refreshed up front, the body's writes are bounded by write(),
 * and an outcome always comes back. A spinner started before this call is
 * always cleared by the answer, and a failure says so instead of vanishing.
 *
 * Use `step()` for each write inside the body so errors are raised, not
 * ignored — a Supabase error is a returned value, not a thrown one, and that
 * is how failures used to disappear silently.
 */
export async function runSave(body: () => Promise<void>): Promise<SaveOutcome> {
  try {
    await ensureFreshSession()
    await body()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: saveMessage(e) }
  }
}

/**
 * One write inside a save: bounded, retried, and its error raised.
 *
 * Supabase reports failure by RETURNING an error, not by throwing — including
 * when the request never reached the server. So the error is raised here, which
 * is both what makes it impossible to ignore and what lets a lost connection be
 * retried. A refusal the server means (duplicate key, bad column) is marked
 * permanent and fails on the first go.
 */
export async function step<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>, retries = 1,
): Promise<T> {
  return withRetry(async () => {
    const res = await write(run())
    if (res.error) {
      const err = new Error(res.error.message) as Error & { permanent?: boolean }
      if (!isTransient(res.error.message)) err.permanent = true
      throw err
    }
    return res
  }, retries)
}

/** Plain words for the person looking at the form, not a stack trace. */
export function saveMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (/timed out|abort|Failed to fetch|NetworkError|network/i.test(raw)) {
    return 'Couldn’t reach the server — nothing was saved. Check your connection and try again.'
  }
  return `Couldn’t save${raw ? ` (${raw})` : ''}. Nothing was lost — try again.`
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
