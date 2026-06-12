import { useEffect, useRef } from 'react'

/**
 * Re-runs `onRefresh` when the app reconnects after the tab was backgrounded.
 *
 * AuthProvider probes the connection on tab-return: if it's healthy it dispatches
 * `vgarage:reconnected` (handled here), and if it's dead it hard-reloads. So this
 * is the single, reliable signal to refetch page data — and crucially it clears
 * any spinner left stuck by a request that was frozen while the tab was hidden.
 */
export function useTabFocusRefresh(onRefresh: () => void) {
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    function handle() { cb.current() }
    window.addEventListener('vgarage:reconnected', handle)
    return () => window.removeEventListener('vgarage:reconnected', handle)
  }, [])
}
