// Bound a query so a wedged attempt (a request sitting on a half-dead keep-alive
// socket, which can block before the fetch's own timeout even applies) fails fast
// instead of hanging the page on a spinner.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('request timed out')), ms)),
  ])
}

// Retry an idempotent read once, with a short pause between tries. Pair with
// withTimeout: the first attempt fails fast on a dead socket, the brief pause lets
// a fresh connection come up, and the retry succeeds. Never use this for writes.
export async function withRetry<T>(fn: () => PromiseLike<T>, retries = 1, delayMs = 600): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && delayMs) await new Promise(r => setTimeout(r, delayMs))
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}
