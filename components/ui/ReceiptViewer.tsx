'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ImageOff, ExternalLink, Loader2 } from 'lucide-react'

interface Props {
  path: string
  className?: string
}

export default function ReceiptViewer({ path, className = '' }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const isPdf = path.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    let cancelled = false
    supabase.storage.from('receipts').createSignedUrl(path, 3600).then(({ data }) => {
      if (!cancelled) {
        setUrl(data?.signedUrl ?? null)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [path])

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-surface-2 rounded-xl ${className}`}>
        <Loader2 size={20} className="text-faint animate-spin" />
      </div>
    )
  }

  if (!url) {
    return (
      <div className={`flex flex-col items-center justify-center bg-surface-2 rounded-xl gap-2 p-4 ${className}`}>
        <ImageOff size={24} className="text-faint" />
        <p className="text-faint text-xs">Failed to load receipt</p>
      </div>
    )
  }

  if (isPdf) {
    return (
      <div className={`flex flex-col rounded-xl overflow-hidden border border-border-strong/50 bg-surface/40 ${className}`}>
        <iframe
          src={`${url}#toolbar=0&navpanes=0`}
          title="PDF Receipt"
          className="w-full flex-1 min-h-[300px]"
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-border-strong/50 text-accent text-xs font-medium hover:text-accent transition-colors shrink-0"
        >
          <ExternalLink size={11} /> Open full size
        </a>
      </div>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block bg-surface-2 rounded-xl overflow-hidden hover:opacity-90 transition-opacity ${className}`}
      title="Click to open full size"
    >
      <img src={url} alt="Receipt" className="w-full h-full object-contain" />
    </a>
  )
}
