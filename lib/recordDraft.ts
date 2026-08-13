import { differenceInDays, parseISO } from 'date-fns'
import type { ServiceCategory, ServiceLog } from '@/lib/types'
import type { ProductStock } from '@/lib/inventory'

// ─────────────────────────────────────────────────────────────────────────────
// Draft shapes for the two-phase record wizard, plus the pure logic that turns
// phase-1 receipt entries into phase-2 service groups.
//
// The model: a service tag on a receipt IDENTIFIES which service that receipt
// feeds — it does not create one. Two receipts tagged "Oil change" are evidence
// for a single oil change, so they collapse into one record by default and are
// split only on request.
// ─────────────────────────────────────────────────────────────────────────────

export interface LineDraft {
  key: string
  itemId: string | null      // existing receipt_item being edited
  productId: string          // '' = a new product named below
  newName: string
  newBrand: string
  unit: string
  unitTouched: boolean
  qty: string
  unitPrice: string
  // Catalogue detail for a product being created here. All optional — a receipt
  // shouldn't demand them, and the service it's used in fills the category in.
  newNotes: string
  newBuyUrl: string
  newCategoryIds: string[]
}

export const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(), itemId: null, productId: '', newName: '', newBrand: '',
  unit: 'each', unitTouched: false, qty: '', unitPrice: '',
  newNotes: '', newBuyUrl: '', newCategoryIds: [],
})

export interface ServiceTag {
  key: string
  categoryId: string
  customName: string
  performedBy: 'shop' | 'owner'
  amount: string             // what this receipt charged for it
}

export const emptyTag = (): ServiceTag => ({
  key: crypto.randomUUID(), categoryId: '', customName: '', performedBy: 'shop', amount: '',
})

export interface ReceiptDraft {
  key: string
  receiptId: string | null   // existing receipt being edited
  originLogId: string | null // the service a past receipt was lifted from
  file: File | null
  preview: string | null
  existingImage: string | null
  date: string
  store: string
  noProducts: boolean
  lines: LineDraft[]
  tags: ServiceTag[]
}

export const emptyReceipt = (date: string): ReceiptDraft => ({
  key: crypto.randomUUID(), receiptId: null, originLogId: null,
  file: null, preview: null, existingImage: null,
  date, store: '', noProducts: false, lines: [emptyLine()], tags: [],
})

export interface TagRef { receiptKey: string; tagKey: string }

export interface ServiceGroup {
  key: string
  label: string
  categoryId: string
  customName: string
  performedBy: 'shop' | 'owner'
  members: TagRef[]
  linkedLogId: string | null   // attach to an existing record instead of creating
  date: string
  odometer: string
  cost: string
  shopEquivalent: string
  notes: string
  draws: { productKey: string; qty: string }[]
}

// Services this far apart are different visits even when they share a category.
const SAME_VISIT_DAYS = 14

export const tagLabel = (tag: ServiceTag, categories: ServiceCategory[]): string =>
  categories.find(c => c.id === tag.categoryId)?.name || tag.customName.trim() || 'Service'

// Same category (or same typed name) and same shop/DIY = the same kind of job.
const identity = (categoryId: string, customName: string, performedBy: string): string =>
  `${categoryId || customName.trim().toLowerCase()}|${performedBy}`

const identityOf = (tag: ServiceTag): string => identity(tag.categoryId, tag.customName, tag.performedBy)

const daysApart = (a: string, b: string): number => {
  if (!a || !b) return 0
  try { return Math.abs(differenceInDays(parseISO(a), parseISO(b))) } catch { return 0 }
}

/**
 * Collapse every service tag across every receipt into proposed records.
 * Same category + same shop/DIY + within a fortnight = one service.
 *
 * Keys are derived from that identity plus the earliest contributing date, so
 * re-running this after an edit lands on the same keys and in-progress detail
 * (odometer, notes, product draws) can be carried across by the caller.
 */
export function groupServiceTags(receipts: ReceiptDraft[], categories: ServiceCategory[]): ServiceGroup[] {
  const flat = receipts.flatMap(r =>
    r.tags.map(t => ({ receiptKey: r.key, tag: t, date: r.date, amount: parseFloat(t.amount) || 0 })),
  ).sort((a, b) => a.date.localeCompare(b.date))

  const groups: ServiceGroup[] = []
  for (const entry of flat) {
    const id = identityOf(entry.tag)
    const hit = groups.find(g =>
      identity(g.categoryId, g.customName, g.performedBy) === id
      && daysApart(g.date, entry.date) <= SAME_VISIT_DAYS)

    if (hit) {
      hit.members.push({ receiptKey: entry.receiptKey, tagKey: entry.tag.key })
      const summed = (parseFloat(hit.cost) || 0) + entry.amount
      hit.cost = summed > 0 ? String(Math.round(summed * 100) / 100) : ''
    } else {
      groups.push({
        key: `${id}|${entry.date}`,
        label: tagLabel(entry.tag, categories),
        categoryId: entry.tag.categoryId,
        customName: entry.tag.customName,
        performedBy: entry.tag.performedBy,
        members: [{ receiptKey: entry.receiptKey, tagKey: entry.tag.key }],
        linkedLogId: null,
        date: entry.date,
        odometer: '',
        cost: entry.amount ? String(entry.amount) : '',
        shopEquivalent: '',
        notes: '',
        draws: [],
      })
    }
  }
  return groups
}

/** Carry user-entered detail across a regroup, matching on the stable key. */
export function mergeGroupEdits(fresh: ServiceGroup[], previous: ServiceGroup[]): ServiceGroup[] {
  const before = new Map(previous.map(g => [g.key, g]))
  return fresh.map(g => {
    const old = before.get(g.key)
    if (!old) return g
    return {
      ...g,
      linkedLogId: old.linkedLogId,
      odometer: old.odometer,
      shopEquivalent: old.shopEquivalent,
      notes: old.notes,
      draws: old.draws,
      // A cost the user typed over wins; otherwise take the recomputed sum.
      cost: old.cost !== '' && old.cost !== g.cost ? old.cost : g.cost,
    }
  })
}

/** Split one member out of a group into its own record. */
export function splitMember(groups: ServiceGroup[], groupKey: string, ref: TagRef): ServiceGroup[] {
  const g = groups.find(x => x.key === groupKey)
  if (!g || g.members.length < 2) return groups
  const rest = g.members.filter(m => !(m.receiptKey === ref.receiptKey && m.tagKey === ref.tagKey))
  return [
    ...groups.map(x => x.key === groupKey ? { ...x, members: rest } : x),
    { ...g, key: `${g.key}|split:${ref.tagKey}`, members: [ref], draws: [], cost: '' },
  ]
}

// ── Provisional stock ────────────────────────────────────────────────────────

export interface AvailableProduct {
  key: string            // real product id, or `draft:<lineKey>` for one being created
  productId: string | null
  name: string
  unit: string
  onHand: number         // committed stock + anything added in this batch
  incoming: number       // the part that isn't written yet
  unitCost: number | null // oldest available lot's price — what FIFO will draw first
}

/** Estimated parts cost of a set of draws, for the live figure on a DIY record. */
export function drawsCost(draws: { productKey: string; qty: string }[], available: AvailableProduct[]): number {
  const priced = new Map(available.map(a => [a.key, a.unitCost ?? 0]))
  return draws.reduce((sum, d) => {
    const qty = parseFloat(d.qty)
    if (!qty || qty <= 0) return sum
    return sum + qty * (priced.get(d.productKey) ?? 0)
  }, 0)
}

/**
 * What's on the shelf for the service step: real stock, plus the products being
 * bought on the receipts in this same sitting, which don't exist in the DB yet.
 */
export function availableProducts(
  receipts: ReceiptDraft[],
  stock: Map<string, ProductStock>,
  productName: (id: string) => string,
  productUnit: (id: string) => string,
): AvailableProduct[] {
  const out = new Map<string, AvailableProduct>()

  for (const s of stock.values()) {
    if (s.onHand <= 0) continue
    out.set(s.product.id, {
      key: s.product.id, productId: s.product.id, name: s.product.name,
      unit: s.unit, onHand: s.onHand, incoming: 0,
      unitCost: s.lots.find(b => b.remaining > 0)?.lot.unitCost ?? null,
    })
  }

  for (const r of receipts) {
    if (r.noProducts) continue
    for (const l of r.lines) {
      const qty = parseFloat(l.qty)
      if (!qty || qty <= 0) continue
      const price = parseFloat(l.unitPrice)
      const unitCost = isNaN(price) ? null : price
      if (l.productId) {
        const existing = out.get(l.productId)
        if (existing) {
          existing.onHand += qty
          existing.incoming += qty
          // Nothing committed to draw from, so this batch's price is the price.
          if (existing.unitCost == null) existing.unitCost = unitCost
        } else {
          out.set(l.productId, {
            key: l.productId, productId: l.productId, name: productName(l.productId),
            unit: productUnit(l.productId), onHand: qty, incoming: qty, unitCost,
          })
        }
      } else if (l.newName.trim()) {
        out.set(`draft:${l.key}`, {
          key: `draft:${l.key}`, productId: null, name: l.newName.trim(),
          unit: l.unit, onHand: qty, incoming: qty, unitCost,
        })
      }
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A receipt with nothing on it yet — saved, but parked for later detail. */
export const isPending = (r: ReceiptDraft): boolean =>
  !r.noProducts
  && r.tags.length === 0
  && !r.lines.some(l => (l.productId || l.newName.trim()) && parseFloat(l.qty) > 0)

/** Suggest an already-logged record this group probably belongs to. */
export function suggestExisting(group: ServiceGroup, logs: ServiceLog[]): ServiceLog | null {
  const candidates = logs.filter(l =>
    (group.categoryId ? l.category_id === group.categoryId : l.service_type.toLowerCase() === group.label.toLowerCase())
    && daysApart(l.date, group.date) <= SAME_VISIT_DAYS,
  )
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => daysApart(a.date, group.date) - daysApart(b.date, group.date))[0]
}
