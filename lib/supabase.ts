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
      // Bound every request so a stale/dead connection can't leave a fetch pending
      // forever. Promise.race (rather than overriding the request's AbortSignal)
      // guarantees Supabase's await rejects on timeout regardless of how it handles
      // signals — and we never clobber its own signal, which previously broke its
      // error handling. The underlying fetch isn't aborted, so no duplicate writes.
      fetch: (url, options) => Promise.race([
        fetch(url, options),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out — the connection may have gone stale.')), 15_000)
        ),
      ]),
    },
  }
)
