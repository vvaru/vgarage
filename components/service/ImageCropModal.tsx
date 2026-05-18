'use client'

import { useState, useRef, useCallback } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { X, Check } from 'lucide-react'

interface Props {
  file: File
  onConfirm: (compressed: File) => void
  onCancel: () => void
}

const MAX_PX = 1600

async function cropAndCompress(img: HTMLImageElement, crop: PixelCrop, originalType: string): Promise<File> {
  const scaleX = img.naturalWidth / img.width
  const scaleY = img.naturalHeight / img.height

  const srcX = crop.x * scaleX
  const srcY = crop.y * scaleY
  const srcW = crop.width * scaleX
  const srcH = crop.height * scaleY

  const isPNG = originalType === 'image/png'
  const longest = Math.max(srcW, srcH)
  const scale = longest > MAX_PX ? MAX_PX / longest : 1
  const outW = Math.round(srcW * scale)
  const outH = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH)

  return new Promise(resolve => {
    canvas.toBlob(
      blob => {
        const ext = isPNG ? 'png' : 'jpg'
        resolve(new File([blob!], `receipt.${ext}`, { type: isPNG ? 'image/png' : 'image/jpeg' }))
      },
      isPNG ? 'image/png' : 'image/jpeg',
      isPNG ? undefined : 0.85
    )
  })
}

export default function ImageCropModal({ file, onConfirm, onCancel }: Props) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [processing, setProcessing] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const srcUrl = useRef(URL.createObjectURL(file)).current

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 })
    setCompletedCrop({ unit: 'px', x: 0, y: 0, width, height })
  }, [])

  async function handleConfirm() {
    if (!imgRef.current || !completedCrop || completedCrop.width === 0) return
    setProcessing(true)
    const compressed = await cropAndCompress(imgRef.current, completedCrop, file.type)
    setProcessing(false)
    URL.revokeObjectURL(srcUrl)
    onConfirm(compressed)
  }

  function handleCancel() {
    URL.revokeObjectURL(srcUrl)
    onCancel()
  }

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h3 className="font-bold text-zinc-100">Crop Receipt</h3>
          <button onClick={handleCancel} className="text-zinc-500 hover:text-zinc-300">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-2">
          <div className="flex items-center justify-center bg-zinc-950 rounded-xl overflow-hidden">
            <ReactCrop
              crop={crop}
              onChange={c => setCrop(c)}
              onComplete={c => setCompletedCrop(c)}
              ruleOfThirds
            >
              <img
                ref={imgRef}
                src={srcUrl}
                alt="Receipt"
                onLoad={onImageLoad}
                style={{ maxHeight: '55vh', maxWidth: '100%', display: 'block' }}
              />
            </ReactCrop>
          </div>
          <p className="text-zinc-600 text-xs text-center mt-2 mb-1">Drag handles to adjust · Pinch to zoom on mobile</p>
        </div>

        <div className="flex gap-3 px-5 pb-5 pt-3 shrink-0">
          <button
            onClick={handleCancel}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing || !completedCrop || completedCrop.width === 0}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
          >
            {processing
              ? <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
              : <Check size={16} />
            }
            {processing ? 'Processing…' : 'Crop & Use'}
          </button>
        </div>
      </div>
    </div>
  )
}
