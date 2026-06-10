import { useEffect, useRef } from 'react'

/**
 * Calls `onRefresh` when the tab regains visibility after being hidden for
 * longer than `minHiddenMs`. This recovers stale data and a stale Supabase
 * session after the tab has been backgrounded — without flashing a reload on
 * every quick tab switch.
 */
export function useTabFocusRefresh(onRefresh: () => void, minHiddenMs = 20000) {
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    let hiddenAt: number | null = null

    function handle() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      // becoming visible
      if (hiddenAt !== null && Date.now() - hiddenAt > minHiddenMs) {
        cb.current()
      }
      hiddenAt = null
    }

    document.addEventListener('visibilitychange', handle)
    return () => document.removeEventListener('visibilitychange', handle)
  }, [minHiddenMs])
}
