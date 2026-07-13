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
      // is idle, so there's no live connection to go stale. The token is instead
      // refreshed on demand: __loadSession() refreshes an expired token the moment
      // a query/write actually needs one (works even with this off — see auth-js),
      // so opening a days-old tab and hitting Save just reconnects then.
      autoRefreshToken: false,
      // No-op lock: empirically, removing this and using the default navigator
      // lock hung the app on the initial post-login load. Safe for a single-tab PWA.
      lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
    },
    global: {
      // Safety-net timeout only. This must be LONGER than the browser's own dead-
      // connection detection: after the tab idles, the browser holds a dead HTTP/2
      // connection and only *it* can notice and replace it (JS can't force a new
      // one). An overly aggressive abort (we had 8s) fires first, cancels the request
      // before the browser gives up on the dead connection, and every retry reuses
      // that same dead connection — so nothing ever recovers without a full reload.
      // 20s gives the browser room to drop the dead connection so the retry lands on
      // a fresh one. Normal requests still return in well under a second.
      fetch: (url, options) => {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          return fetch(url, { ...options, signal: AbortSignal.timeout(20_000) })
        }
        return fetch(url, options)
      },
    },
  }
)
