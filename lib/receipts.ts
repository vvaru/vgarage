// One place deciding how a receipt is named and summarised, so the inventory
// list, the wizard header and the service step never disagree about what a
// given receipt is called.

export interface ReceiptSummary {
  store?: string | null
  products?: string[]
  services?: string[]
  noProducts?: boolean
}

const joinUpTo = (names: (string | null | undefined)[], max: number): string => {
  const clean = [...new Set(names.map(n => (n ?? '').trim()).filter(Boolean))]
  if (clean.length === 0) return ''
  if (clean.length <= max) return clean.join(', ')
  return `${clean.slice(0, max).join(', ')} +${clean.length - max} more`
}

/** Everything on the receipt, products first, trimmed to a readable length. */
export const receiptContents = (r: ReceiptSummary, max = 3): string =>
  joinUpTo([...(r.products ?? []), ...(r.services ?? [])], max)

/**
 * What to call a receipt: what was on it. The shop is where you were, not what
 * you bought — "Honda" doesn't help you find the transmission fluid — so it's
 * only the name when there's nothing on the receipt to name it by. It belongs
 * alongside the date as context instead; see receiptWhere.
 */
export function receiptTitle(r: ReceiptSummary, max = 3): string {
  const contents = receiptContents(r, max)
  if (contents) return contents
  const store = (r.store ?? '').trim()
  if (store) return store
  return r.noProducts ? 'Services only' : 'Receipt'
}

/** Shop and date, joined for the secondary line under the title. */
export function receiptWhere(store: string | null | undefined, date: string | null | undefined): string {
  return [(store ?? '').trim(), (date ?? '').trim()].filter(Boolean).join(' · ')
}
