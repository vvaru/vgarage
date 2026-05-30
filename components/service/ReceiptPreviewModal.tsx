'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Pencil, ExternalLink, Loader2, ImageOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ServiceLog } from '@/lib/types'

interface Props {
  log: ServiceLog
  onClose: () => void
  onEdit: (log: ServiceLog) => void
}

export default function ReceiptPreviewModal({ log, onClose, onEdit }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const isPdf = log.receipt_url?.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    if (!log.receipt_url) return
    supabase.storage.from('receipts').createSignedUrl(log.receipt_url, 3600).then(({ data }) => {
      setUrl(data?.signedUrl ?? null)
      setLoading(false)
    })
  }, [log.receipt_url])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-stretch lg:items-center lg:justify-center">
      <div className="w-full h-full lg:w-auto lg:h-auto lg:max-w-5xl lg:rounded-3xl lg:border lg:border-zinc-800 bg-zinc-900 flex flex-col lg:flex-row overflow-hidden">

        {/* Receipt pane */}
        <div className="flex-1 bg-zinc-950 flex items-center justify-center relative min-h-[50vh] lg:min-h-0 overflow-hidden">
          {loading ? (
            <Loader2 size={32} className="text-zinc-600 animate-spin" />
          ) : !url ? (
            <div className="flex flex-col items-center gap-3">
              <ImageOff size={32} className="text-zinc-600" />
              <p className="text-zinc-600 text-sm">Could not load receipt</p>
            </div>
          ) : isPdf ? (
            <iframe src={`${url}#toolbar=0&navpanes=0`} className="w-full h-full min-h-[400px]" title="Receipt PDF" />
          ) : (
            <img src={url} alt="Receipt" className="max-w-full max-h-full object-contain" />
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-3 right-3 w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-zinc-400 hover:text-blue-400 transition-colors"
              title="Open full size"
            >
              <ExternalLink size={15} />
            </a>
          )}
          {/* Mobile close */}
          <button
            onClick={onClose}
            className="lg:hidden absolute top-3 left-3 w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Details panel */}
        <div className="lg:w-72 xl:w-80 border-t border-zinc-800 lg:border-t-0 lg:border-l flex flex-col shrink-0 max-h-[45vh] lg:max-h-none overflow-y-auto">
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-100 text-sm leading-tight truncate">{log.service_type}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{format(parseISO(log.date), 'MMMM d, yyyy')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onEdit(log)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-xl transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
              <button onClick={onClose} className="hidden lg:flex text-zinc-500 hover:text-zinc-300 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="divide-y divide-zinc-800/80 flex-1">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-zinc-500 text-sm">Odometer</span>
              <span className="text-zinc-200 text-sm font-medium">{log.odometer.toLocaleString()} mi</span>
            </div>
            {log.cost != null && (
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-zinc-500 text-sm">Cost</span>
                <span className="text-blue-400 text-sm font-bold">${Number(log.cost).toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-zinc-500 text-sm">Type</span>
              <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                log.record_type === 'repair' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'
              }`}>
                {log.record_type === 'repair' ? 'Repair' : 'Maintenance'}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-zinc-500 text-sm">By</span>
              <span className="text-zinc-300 text-sm">
                {log.performed_by === 'owner' ? '🔧 DIY' : '🏪 Shop'}
              </span>
            </div>
            {log.shop_name && (
              <div className="flex items-start justify-between gap-3 px-5 py-3">
                <span className="text-zinc-500 text-sm shrink-0">Shop</span>
                <span className="text-zinc-200 text-sm text-right">{log.shop_name}{log.shop_location ? `, ${log.shop_location}` : ''}</span>
              </div>
            )}
            {log.notes && (
              <div className="px-5 py-3">
                <p className="text-zinc-500 text-xs font-medium mb-1.5">Notes</p>
                <p className="text-zinc-300 text-sm leading-relaxed">{log.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
