'use client'

import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query (false during the static prerender). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The desktop layout (navigation rail, side panels) starts at Tailwind's lg breakpoint. */
export const useIsDesktop = () => useMedia('(min-width: 1024px)')
