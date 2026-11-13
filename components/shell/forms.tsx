'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Vehicle } from '@/lib/types'

// One place that opens the app's data-entry forms from anywhere (the Add menu,
// a product page, a service's Edit button), and tells every page when saved data
// changed so it can reload. Forms render in FormHost (components/forms/FormHost).

export type FormRequest =
  | { kind: 'fuel'; logId?: string }
  | { kind: 'service'; logId?: string; productId?: string; categoryId?: string }
  | { kind: 'receipt'; receiptId?: string }
  | { kind: 'stock'; mode: 'add' | 'remove'; productId?: string }
  | { kind: 'product'; productId?: string }
  | { kind: 'car'; car?: Vehicle }

interface FormsApi {
  open: (req: FormRequest) => void
  close: () => void
  active: FormRequest | null
  /** Saved data changed: every subscribed page reloads. */
  changed: () => void
  version: number
}

const Ctx = createContext<FormsApi>({ open: () => {}, close: () => {}, active: null, changed: () => {}, version: 0 })

export function FormsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<FormRequest | null>(null)
  const [version, setVersion] = useState(0)
  const open = useCallback((req: FormRequest) => setActive(req), [])
  const close = useCallback(() => setActive(null), [])
  const changed = useCallback(() => setVersion(v => v + 1), [])
  return <Ctx.Provider value={{ open, close, active, changed, version }}>{children}</Ctx.Provider>
}

export const useForms = () => useContext(Ctx)

/** Run `reload` whenever a form reports saved changes (not on first render). */
export function useDataRefresh(reload: () => void) {
  const { version } = useContext(Ctx)
  const ref = useRef(reload)
  useEffect(() => { ref.current = reload })
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    ref.current()
  }, [version])
}
