// Tiny in-memory cache (lives for the browser session, cleared on reload) so
// navigating back to a page shows its already-loaded data INSTANTLY instead of
// re-querying and waiting. Pages read the cache first, then quietly revalidate in
// the background — a background fetch can't block or hang the visible view.
// Keyed by data-kind + vehicle id, e.g. "fuel:<vehicleId>".
const store = new Map<string, unknown>()

export function getCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function setCache<T>(key: string, value: T): void {
  store.set(key, value)
}

export function clearCache(prefix?: string): void {
  if (!prefix) { store.clear(); return }
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k)
}
