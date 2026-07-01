import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: 'implicit',
      persistSession: true,
      detectSessionInUrl: true,
      autoRefreshToken: true,
      // (Uses the default navigator-lock, which already times out after 5s and
      // can't deadlock — an earlier no-op override here was unnecessary.)
    },
    global: {
      // Abort a request that's been pending too long. Aborting (vs just racing a
      // timeout) is the point: after the tab idles the browser can reuse a dead
      // keep-alive socket where the request is sent but no response ever returns.
      // Aborting discards that socket, so the retry (withRetry) opens a fresh one.
      // We combine with Supabase's own signal via AbortSignal.any so we never
      // clobber it (clobbering broke its error handling before).
      fetch: (url, options) => {
        let signal = options?.signal ?? undefined
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          const timeout = AbortSignal.timeout(8_000)
          signal = signal && typeof AbortSignal.any === 'function'
            ? AbortSignal.any([signal, timeout])
            : timeout
        }
        return fetch(url, signal ? { ...options, signal } : options)
      },
    },
  }
)
