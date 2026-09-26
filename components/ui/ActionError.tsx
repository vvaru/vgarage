'use client'

import { X } from 'lucide-react'

/**
 * Where a background action says it failed.
 *
 * Deletes, merges and other one-tap actions update the screen immediately and
 * write afterwards. When that write fails there's no form still open to put the
 * message in, and silence is the worst answer — the screen would keep showing a
 * change the server never took. This is that message.
 */
export default function ActionError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="alert"
        className="pointer-events-auto flex items-start gap-3 max-w-md w-full bg-surface border border-danger/40 rounded-2xl px-4 py-3 shadow-lg"
      >
        <p className="text-danger text-sm flex-1">{message}</p>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-foreground shrink-0">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
