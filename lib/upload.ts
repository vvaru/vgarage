import { supabase } from '@/lib/supabase'
import { withRetry, write } from '@/lib/recover'

/** Phone photos are huge; receipts read fine at 2000px. PDFs and small images pass through. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/**
 * Upload a receipt image or PDF to the receipts bucket at `path` (callers keep the
 * path stable across retries so a retried save never leaves a second copy).
 */
export async function uploadReceiptFile(path: string, file: File): Promise<void> {
  const body = await shrink(file)
  const { error } = await withRetry(() => write(supabase.storage.from('receipts').upload(path, body, { upsert: true })), 1, 2500)
  if (error) throw new Error(`The receipt image didn’t upload (${error.message}).`)
}

export const receiptPath = (userId: string, file: File) =>
  `${userId}/${crypto.randomUUID()}.${file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('image/') && file.size >= 600_000 ? 'jpg' : (file.name.split('.').pop() ?? 'jpg')}`
