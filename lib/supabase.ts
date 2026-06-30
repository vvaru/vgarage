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
      // Replace the default navigator.locks-based lock with a no-op. The default
      // can deadlock when the browser suspends a backgrounded tab while it holds
      // the lock — on return, getSession() and every authed query wait forever on
      // a lock that never releases, and only a full reload clears it. A no-op is
      // safe for this single-user PWA (one active tab) and eliminates the hang.
      lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
    },
    global: {
      // Every request is bounded by a timeout so a dead/stale connection can't
      // leave a fetch pending forever. After the tab idles, the browser may reuse
      // a stale keep-alive socket: the request hangs (the server might even
      // process it) but the response never returns. The fix is to retry — a fresh
      // fetch opens a new connection. We only retry idempotent READS (GET/HEAD):
      // retrying a write could duplicate a row that actually succeeded, and
      // retrying an auth refresh could rotate the refresh token twice. A
      // successful read also warms the connection for the writes that follow.
      fetch: async (url, options) => {
        const href = typeof url === 'string'
          ? url
          : url instanceof URL ? url.href
          : url instanceof Request ? url.url
          : ''
        const method = (options?.method ?? 'GET').toUpperCase()
        const isAuth = href.includes('/auth/v1/')
        const isRead = method === 'GET' || method === 'HEAD'
        const timeoutMs = isAuth ? 13_000 : isRead ? 7_000 : 11_000
        const canTimeout = typeof AbortSignal.timeout === 'function'

        const attempt = () => fetch(url, canTimeout ? { ...options, signal: AbortSignal.timeout(timeoutMs) } : options)

        try {
          return await attempt()
        } catch (e) {
          if (isRead && !isAuth) return await attempt() // stale socket → retry on a fresh connection
          throw e
        }
      },
    },
  }
)
