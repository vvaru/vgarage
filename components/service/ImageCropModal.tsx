'use client'

import { useState, useRef, useCallback } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Dialog } from '@/components/ui/md'

interface Props {
  file: File
  onConfirm: (cropped: File) => void
  onCancel: () => void
}

const MAX_PX = 1600

async function cropAndCompress(img: HTMLImageElement, crop: PixelCrop, file: File): Promise<File> {
  const scaleX = img.naturalWidth / img.width
  const scaleY = img.naturalHeight / img.height

  const srcX = crop.x * scaleX
  const srcY = crop.y * scaleY
  const srcW = crop.width * scaleX
  const srcH = crop.height * scaleY

  const isPNG = file.type === 'image/png'
  const longest = Math.max(srcW, srcH)
  const scale = longest > MAX_PX ? MAX_PX / longest : 1
  const outW = Math.round(srcW * scale)
  const outH = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  canvas.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) { reject(new Error('Couldn’t crop the photo.')); return }
        const base = file.name.replace(/\.\w+$/, '') || 'receipt'
        resolve(new File([blob], `${base}.${isPNG ? 'png' : 'jpg'}`, { type: isPNG ? 'image/png' : 'image/jpeg' }))
      },
      isPNG ? 'image/png' : 'image/jpeg',
      isPNG ? undefined : 0.85,
    )
  })
}

/** Trim a receipt photo to the paper before it's saved. "Use whole photo" skips it. */
export default function ImageCropModal({ file, onConfirm, onCancel }: Props) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [srcUrl] = useState(() => URL.createObjectURL(file))

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 })
    setCompletedCrop({ unit: 'px', x: 0, y: 0, width, height })
  }, [])

  async function handleConfirm() {
    if (!imgRef.current || !completedCrop || completedCrop.width === 0) return
    setProcessing(true); setError(null)
    try {
      const cropped = await cropAndCompress(imgRef.current, completedCrop, file)
      URL.revokeObjectURL(srcUrl)
      onConfirm(cropped)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t crop the photo.')
    } finally {
      setProcessing(false)
    }
  }

  function close(use: File | null) {
    URL.revokeObjectURL(srcUrl)
    if (use) onConfirm(use)
    else onCancel()
  }

  return (
    <Dialog open onClose={() => close(null)} title="Crop the receipt" subtitle="Drag the corners to the edges of the paper" size="md"
      primary={{ label: 'Crop & use', onClick: handleConfirm, disabled: processing || !completedCrop || completedCrop.width === 0, loading: processing }}
      secondary={{ label: 'Use whole photo', onClick: () => close(file) }}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-center rounded-xl overflow-hidden bg-surface-container-highest">
          <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} ruleOfThirds>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a page image */}
            <img ref={imgRef} src={srcUrl} alt="Receipt" onLoad={onImageLoad} style={{ maxHeight: '60vh', maxWidth: '100%', display: 'block' }} />
          </ReactCrop>
        </div>
        <button type="button" onClick={() => close(file)} className="sm:hidden self-center type-label-lg text-primary px-3 h-10">Use whole photo</button>
        {error && <p role="alert" className="type-body text-error">{error}</p>}
      </div>
    </Dialog>
  )
}
