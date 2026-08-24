'use client'

import { X, Pencil, ExternalLink, Tag, Package } from 'lucide-react'
import { fmtQty } from '@/lib/units'
import type { Product, ProductLink, ServiceCategory } from '@/lib/types'
import type { ProductType } from '@/lib/productTypes'
import type { ProductStock } from '@/lib/inventory'

type ProductU = Product & { unit?: string }

interface Props {
  product: ProductU
  type: ProductType | null
  stock: ProductStock | null
  links: ProductLink[]
  categories: ServiceCategory[]   // the ones this product is tagged for
  onClose: () => void
  onEdit: () => void
}

/** A read-first look at a product, reachable from the inventory list. */
export default function ProductPeek({ product, type, stock, links, categories, onClose, onEdit }: Props) {
  const unit = product.unit ?? 'each'
  const subtitle = [product.name, product.brand].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-sm max-h-[85vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-start justify-between gap-2 px-5 pt-5 pb-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-lg leading-tight truncate">{type?.name ?? product.name}</h3>
            <p className="text-muted text-sm mt-0.5 truncate">{type ? subtitle : (product.brand ?? '')}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {stock ? (
            <div className="bg-surface-2/50 border border-border rounded-2xl p-4">
              <p className={`text-2xl font-bold ${stock.onHand > 0 ? 'text-accent' : 'text-faint'}`}>
                {stock.onHand > 0 ? fmtQty(stock.onHand, stock.unit) : 'None left'}
              </p>
              <p className="text-faint text-xs mt-0.5">
                {stock.consumed > 0 && `${stock.consumed} of ${stock.purchased} used`}
                {stock.value > 0 && ` · $${stock.value.toFixed(2)} left`}
              </p>
            </div>
          ) : (
            <p className="text-faint text-sm flex items-center gap-2">
              <Package size={14} /> Nothing bought or used yet.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint mb-0.5">Counted in</p>
              <p className="text-foreground">{unit}</p>
            </div>
            {!type && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-faint mb-0.5">Type</p>
                <p className="text-warn">Not set</p>
              </div>
            )}
          </div>

          {categories.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint mb-1.5">Used for</p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map(c => (
                  <span key={c.id} className="flex items-center gap-1 bg-accent/10 text-accent border border-accent/20 rounded-lg px-2 py-0.5 text-xs font-medium">
                    <Tag size={9} />{c.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {product.notes && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint mb-1">Notes</p>
              <p className="text-muted text-sm whitespace-pre-wrap">{product.notes}</p>
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-2">
              {links.map(l => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl py-2 text-sm transition-colors">
                  <ExternalLink size={13} />{l.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-2.5 transition-colors">Close</button>
          <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-2.5 transition-colors">
            <Pencil size={14} /> Edit
          </button>
        </div>
      </div>
    </div>
  )
}
