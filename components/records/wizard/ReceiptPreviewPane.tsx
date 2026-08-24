'use client'

import { format, parseISO } from 'date-fns'
import { Image as ImageIcon, Receipt as ReceiptIcon } from 'lucide-react'
import ReceiptViewer from '@/components/ui/ReceiptViewer'
import { receiptTitle } from '@/lib/receipts'
import type { ReceiptDraft } from '@/lib/recordDraft'

interface Props {
  receipts: ReceiptDraft[]
  activeKey: string
  onPick: (key: string) => void
  /** Step 1 can attach an image here; step 2 is read-only. */
  onAttach?: () => void
  onRemove?: () => void
}

/**
 * The receipt, as large as the dialog allows. Shared by both steps: entering
 * service details means reading the same paperwork as entering line items, so
 * the pane follows you rather than disappearing after step 1.
 */
export default function ReceiptPreviewPane({ receipts, activeKey, onPick, onAttach, onRemove }: Props) {
  const draft = receipts.find(r => r.key === activeKey) ?? receipts[0]
  if (!draft) return null

  const label = receiptTitle({
    store: draft.store,
    products: draft.noProducts ? [] : draft.lines.map(l => l.newName.trim()).filter(Boolean),
    noProducts: draft.noProducts,
  }, 2)

  return (
    <aside className="lg:shrink-0 flex flex-col lg:w-[46%] border-b lg:border-b-0 lg:border-r border-border bg-surface-2/30">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {draft.file?.name ?? (draft.existingImage ? label : 'No image yet')}
          </p>
          {draft.date && (
            <p className="text-[11px] text-faint">{format(parseISO(draft.date), 'MMM d, yyyy')}</p>
          )}
        </div>
        {onRemove && draft.preview && (
          <button onClick={onRemove} className="text-danger text-xs font-medium shrink-0">Remove</button>
        )}
      </div>

      {/* Several receipts in one sitting — switch without leaving the step */}
      {receipts.length > 1 && (
        <div className="flex gap-1.5 px-4 py-2 border-b border-border/60 overflow-x-auto">
          {receipts.map((r, i) => (
            <button
              key={r.key}
              onClick={() => onPick(r.key)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                r.key === draft.key
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'bg-surface-2 text-muted border-border-strong'
              }`}
            >{r.store.trim() || `Receipt ${i + 1}`}</button>
          ))}
        </div>
      )}

      <div className="p-3 h-[380px] lg:h-auto lg:flex-1 lg:min-h-0">
        {draft.preview ? (
          draft.file?.type === 'application/pdf' ? (
            <iframe src={`${draft.preview}#toolbar=0&navpanes=0`} title="Receipt PDF" className="w-full h-full rounded-xl border border-border-strong/50 bg-surface" />
          ) : (
            <a href={draft.preview} target="_blank" rel="noopener noreferrer" title="Open full size"
              className="block w-full h-full bg-surface-2 rounded-xl overflow-hidden">
              <img src={draft.preview} alt="Receipt" className="w-full h-full object-contain" />
            </a>
          )
        ) : draft.existingImage ? (
          <ReceiptViewer path={draft.existingImage} className="w-full h-full" fit />
        ) : onAttach ? (
          <button onClick={onAttach}
            className="w-full h-full rounded-xl border border-dashed border-border-strong flex flex-col items-center justify-center gap-1.5 text-muted hover:text-accent hover:border-accent/50 transition-colors">
            <ImageIcon size={22} />
            <span className="text-sm font-medium">Attach receipt</span>
            <span className="text-[11px] text-faint">Image or PDF · optional</span>
          </button>
        ) : (
          <div className="w-full h-full rounded-xl border border-dashed border-border-strong flex flex-col items-center justify-center gap-2 text-faint">
            <ReceiptIcon size={22} />
            <span className="text-xs">No image on this receipt</span>
          </div>
        )}
      </div>
    </aside>
  )
}
