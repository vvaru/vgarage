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
      // No-op lock: empirically, removing this and using the default navigator
      // lock hung the app on the initial post-login load. Safe for a single-tab
      // PWA, and the abort+retry fetch below handles stale connections.
      lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
    },
    global: {
      // Abort a request pending longer than 8s. Aborting (not just racing a timer)
      // is the point: after the tab idles the browser can reuse a dead keep-alive
      // socket where the request is sent but no response returns. Aborting discards
      // that socket so the retry (withRetry) opens a fresh connection and succeeds.
      fetch: (url, options) => {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          return fetch(url, { ...options, signal: AbortSignal.timeout(8_000) })
        }
        return fetch(url, options)
      },
    },
  }
)
