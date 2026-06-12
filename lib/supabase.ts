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
      // 10-second hard timeout on every request. Without this, a dropped
      // connection can leave fetch() pending indefinitely — try/finally blocks
      // only fire on thrown errors, not on a request that never resolves.
      fetch: (url, options) => fetch(url, {
        ...options,
        signal: typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(10_000)
          : options?.signal,
      }),
    },
  }
)
