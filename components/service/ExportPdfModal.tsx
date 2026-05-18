'use client'

import { useState } from 'react'
import { X, Download, FileText } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Vehicle, ServiceLog } from '@/lib/types'

interface Props {
  vehicle: Vehicle
  logs: ServiceLog[]
  onClose: () => void
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function fetchReceiptAsBase64(path: string): Promise<{ data: string; isImage: boolean } | null> {
  try {
    const { data: urlData } = await supabase.storage
      .from('receipts')
      .createSignedUrl(path, 60)
    if (!urlData?.signedUrl) return null

    const response = await fetch(urlData.signedUrl)
    const blob = await response.blob()
    const isImage = blob.type.startsWith('image/')
    if (!isImage) return null

    const b64 = await blobToBase64(blob)
    return { data: b64, isImage: true }
  } catch {
    return null
  }
}

export default function ExportPdfModal({ vehicle, logs, onClose }: Props) {
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState('')

  const ownerCount = logs.filter(l => l.performed_by !== 'shop').length
  const shopCount = logs.filter(l => l.performed_by === 'shop').length
  const totalCost = logs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const receiptCount = logs.filter(l => l.receipt_url).length

  async function generate() {
    setGenerating(true)
    setProgress('Loading libraries…')

    try {
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()

      // ─── COLORS ───────────────────────────────────────────────────────────
      const navyR = 30, navyG = 64, navyB = 175
      const ownerBg: [number, number, number] = [219, 234, 254]  // blue-100
      const shopBg: [number, number, number] = [220, 252, 231]    // green-100
      const headBg: [number, number, number] = [navyR, navyG, navyB]

      // ─── PAGE 1: COVER ─────────────────────────────────────────────────────
      doc.setFillColor(navyR, navyG, navyB)
      doc.rect(0, 0, pageW, 50, 'F')

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(22)
      doc.setFont('helvetica', 'bold')
      doc.text('VEHICLE HISTORY REPORT', pageW / 2, 18, { align: 'center' })

      doc.setFontSize(14)
      doc.setFont('helvetica', 'normal')
      const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ' ' + vehicle.trim : ''}`
      doc.text(vehicleName, pageW / 2, 28, { align: 'center' })

      doc.setFontSize(9)
      doc.text(`Generated ${format(new Date(), 'MMMM d, yyyy')}`, pageW / 2, 36, { align: 'center' })

      if (vehicle.vin) {
        doc.text(`VIN: ${vehicle.vin}`, pageW / 2, 43, { align: 'center' })
      }

      // Summary box
      const summaryY = 58
      doc.setTextColor(30, 41, 59)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('SERVICE SUMMARY', 14, summaryY)

      const summaryItems = [
        ['Total Service Records', String(logs.length)],
        ['Owner-Performed', String(ownerCount)],
        ['Shop-Performed', String(shopCount)],
        ['Total Documented Spend', logs.some(l => l.cost != null) ? `$${totalCost.toFixed(2)}` : 'N/A'],
        ['First Record', logs.length ? format(parseISO(logs[logs.length - 1].date), 'MMM d, yyyy') : 'N/A'],
        ['Last Record', logs.length ? format(parseISO(logs[0].date), 'MMM d, yyyy') : 'N/A'],
        ['Current Odometer', `${vehicle.odometer.toLocaleString()} mi`],
        ['Receipts Attached', String(receiptCount)],
      ]

      doc.setFontSize(10)
      let sy = summaryY + 8
      for (const [label, value] of summaryItems) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 116, 139)
        doc.text(label, 14, sy)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(15, 23, 42)
        doc.text(value, pageW - 14, sy, { align: 'right' })
        doc.setDrawColor(226, 232, 240)
        doc.line(14, sy + 2, pageW - 14, sy + 2)
        sy += 9
      }

      // Legend
      const legendY = sy + 8
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 41, 59)
      doc.text('LEGEND', 14, legendY)

      doc.setFillColor(...ownerBg)
      doc.rect(14, legendY + 4, 6, 4, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.text('Owner-performed service', 22, legendY + 7.5)

      doc.setFillColor(...shopBg)
      doc.rect(14, legendY + 11, 6, 4, 'F')
      doc.text('Shop-performed service', 22, legendY + 14.5)

      // ─── PAGE 2+: SERVICE HISTORY TABLE ────────────────────────────────────
      setProgress('Building service table…')
      doc.addPage()

      doc.setFillColor(navyR, navyG, navyB)
      doc.rect(0, 0, pageW, 14, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('SERVICE HISTORY', pageW / 2, 9, { align: 'center' })

      const receiptRefs: Array<{ label: string; log: ServiceLog }> = []
      let refIdx = 1

      const tableRows = [...logs].reverse().map(log => {
        let refStr = ''
        if (log.receipt_url) {
          refStr = ` [A${refIdx}]`
          receiptRefs.push({ label: `A${refIdx}`, log })
          refIdx++
        }
        return [
          format(parseISO(log.date), 'MMM d, yyyy'),
          log.odometer ? log.odometer.toLocaleString() + ' mi' : '—',
          log.service_type + refStr,
          log.record_type === 'repair' ? 'Repair' : 'Maintenance',
          log.performed_by === 'shop' ? 'Shop' : 'Owner',
          log.shop_name
            ? log.shop_name + (log.shop_location ? '\n' + log.shop_location : '')
            : '—',
          log.cost != null ? '$' + Number(log.cost).toFixed(2) : '—',
        ]
      })

      autoTable(doc, {
        head: [['Date', 'Mileage', 'Service', 'Type', 'By', 'Shop / Location', 'Cost']],
        body: tableRows,
        startY: 18,
        margin: { left: 10, right: 10 },
        headStyles: {
          fillColor: headBg,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5,
        },
        bodyStyles: { fontSize: 8, cellPadding: 2.5 },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 22 },
          2: { cellWidth: 42 },
          3: { cellWidth: 22 },
          4: { cellWidth: 16 },
          5: { cellWidth: 35 },
          6: { cellWidth: 18 },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        willDrawCell: (data: any) => {
          if (data.section === 'body') {
            const log = [...logs].reverse()[data.row.index]
            if (log?.performed_by === 'owner') {
              data.cell.styles.fillColor = ownerBg
            } else {
              data.cell.styles.fillColor = shopBg
            }
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didDrawPage: (_data: any) => {
          const pg = doc.getNumberOfPages()
          doc.setFontSize(8)
          doc.setTextColor(150, 150, 150)
          doc.text(
            `${vehicleName}  ·  Page ${pg}`,
            pageW / 2,
            doc.internal.pageSize.getHeight() - 6,
            { align: 'center' }
          )
        },
      })

      // ─── APPENDIX: RECEIPTS ─────────────────────────────────────────────────
      if (receiptRefs.length > 0) {
        setProgress(`Loading ${receiptRefs.length} receipt${receiptRefs.length > 1 ? 's' : ''}…`)

        doc.addPage()
        doc.setFillColor(navyR, navyG, navyB)
        doc.rect(0, 0, pageW, 14, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text('APPENDIX — SERVICE RECEIPTS', pageW / 2, 9, { align: 'center' })

        let appendixY = 20

        for (const { label, log } of receiptRefs) {
          if (!log.receipt_url) continue

          const title = `${label}  —  ${log.service_type}  ·  ${format(parseISO(log.date), 'MMM d, yyyy')}${log.shop_name ? '  ·  ' + log.shop_name : ''}`

          doc.setFontSize(9)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(30, 41, 59)

          if (appendixY > 250) {
            doc.addPage()
            appendixY = 14
          }

          doc.text(title, 14, appendixY)
          appendixY += 5

          const receipt = await fetchReceiptAsBase64(log.receipt_url)
          if (receipt) {
            const maxW = pageW - 28
            const maxH = 160

            if (appendixY + maxH > 280) {
              doc.addPage()
              appendixY = 14
            }

            doc.addImage(receipt.data, 'JPEG', 14, appendixY, maxW, maxH, undefined, 'FAST')
            appendixY += maxH + 12
          } else {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8.5)
            doc.setTextColor(100, 116, 139)
            doc.text('(PDF receipt — see original file)', 14, appendixY + 4)
            appendixY += 14
          }
        }
      }

      // ─── SAVE ───────────────────────────────────────────────────────────────
      setProgress('Saving PDF…')
      const filename = `vGarage-${vehicle.year}-${vehicle.make}-${vehicle.model}.pdf`
        .replace(/\s+/g, '-')
        .toLowerCase()
      doc.save(filename)
      onClose()
    } catch (err) {
      console.error(err)
      setProgress('Error generating PDF')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-zinc-100 text-lg">Export Car History</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-4 py-3">
            <span className="text-zinc-400 text-sm">Total records</span>
            <span className="text-zinc-100 font-semibold">{logs.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-blue-300 font-bold">{ownerCount}</p>
              <p className="text-zinc-500 text-xs">Owner</p>
            </div>
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-green-400 font-bold">{shopCount}</p>
              <p className="text-zinc-500 text-xs">Shop</p>
            </div>
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-amber-400 font-bold">{receiptCount}</p>
              <p className="text-zinc-500 text-xs">Receipts</p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl px-4 py-3 mb-5 space-y-1.5">
          <p className="text-zinc-300 text-sm font-medium">Report includes:</p>
          {[
            'Cover page with vehicle summary',
            'Color-coded service history table',
            receiptCount > 0 ? `Appendix with ${receiptCount} receipt image${receiptCount > 1 ? 's' : ''}` : 'Appendix section (no receipts yet)',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-zinc-400 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              {item}
            </div>
          ))}
        </div>

        {generating ? (
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">{progress}</p>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={generate}
              disabled={logs.length === 0}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
            >
              <Download size={16} />
              Export PDF
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
