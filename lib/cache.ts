// Page-data cache so navigating (or reloading) shows your last-loaded data
// INSTANTLY instead of re-querying and waiting. Pages read the cache first, then
// quietly revalidate in the background — a background fetch can't block or hang the
// visible view, and a failed one leaves your data on screen.
//
// Backed by localStorage so it also survives a full page reload / reopening the tab:
// after the laptop sleeps, a reload shows your real data immediately while the dead
// connection reconnects in the background — instead of a blank "nothing here" state.
// Keyed by data-kind + vehicle id, e.g. "fuel:<vehicleId>".
const store = new Map<string, unknown>()
const LS_PREFIX = 'vgarage_cache:'

export function getCache<T>(key: string): T | undefined {
  if (store.has(key)) return store.get(key) as T
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LS_PREFIX + key)
      if (raw != null) {
        const val = JSON.parse(raw) as T
        store.set(key, val)
        return val
      }
    } catch { /* corrupt/unavailable storage — treat as no cache */ }
  }
  return undefined
}

export function setCache<T>(key: string, value: T): void {
  store.set(key, value)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
    } catch { /* quota exceeded or unserializable — keep the in-memory copy only */ }
  }
}

export function clearCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
  } else {
    for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k)
  }
  if (typeof window !== 'undefined') {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i)
        if (k && k.startsWith(LS_PREFIX) && (!prefix || k.slice(LS_PREFIX.length).startsWith(prefix))) {
          window.localStorage.removeItem(k)
        }
      }
    } catch { /* ignore */ }
  }
}
