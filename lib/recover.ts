// Retry an idempotent operation (a read query) once. Paired with the aborting
// fetch in lib/supabase.ts: the first attempt aborts a request stuck on a dead
// keep-alive socket, which discards that socket, so the retry opens a fresh
// connection and succeeds — recovering the "stale connection after the tab
// idled" case without a page reload. Never use this for writes (could duplicate).
export async function withRetry<T>(fn: () => PromiseLike<T>, retries = 1): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}
