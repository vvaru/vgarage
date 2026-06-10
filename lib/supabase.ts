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
