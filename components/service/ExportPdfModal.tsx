'use client'

import { useState } from 'react'
import { X, Download } from 'lucide-react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { Vehicle, ServiceLog } from '@/lib/types'

interface Props {
  vehicle: Vehicle
  logs: ServiceLog[]
  onClose: () => void
}

interface ReceiptAsset {
  data: string
  format: 'JPEG' | 'PNG' | 'WEBP'
}

async function fetchReceiptAsset(path: string): Promise<ReceiptAsset | null> {
  try {
    const { data: urlData } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
    if (!urlData?.signedUrl) return null
    const response = await fetch(urlData.signedUrl)
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    const fmt: ReceiptAsset['format'] = blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG'
    const b64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result as string)
      reader.onerror = rej
      reader.readAsDataURL(blob)
    })
    return { data: b64, format: fmt }
  } catch {
    return null
  }
}

function computeAverages(sortedLogs: ServiceLog[]) {
  if (sortedLogs.length < 2) return { avgMiles: null as number | null, avgDays: null as number | null }
  const milesArr: number[] = []
  const daysArr: number[] = []
  for (let i = 1; i < sortedLogs.length; i++) {
    const mi = sortedLogs[i].odometer - sortedLogs[i - 1].odometer
    const dy = differenceInDays(parseISO(sortedLogs[i].date), parseISO(sortedLogs[i - 1].date))
    if (mi > 0) milesArr.push(mi)
    if (dy > 0) daysArr.push(dy)
  }
  return {
    avgMiles: milesArr.length ? Math.round(milesArr.reduce((a, b) => a + b) / milesArr.length) : null,
    avgDays: daysArr.length ? Math.round(daysArr.reduce((a, b) => a + b) / daysArr.length) : null,
  }
}

export default function ExportPdfModal({ vehicle, logs, onClose }: Props) {
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState('')

  const maintenanceLogs = logs.filter(l => l.record_type !== 'repair')
  const repairLogs = logs.filter(l => l.record_type === 'repair')
  const receiptCount = logs.filter(l => l.receipt_url).length

  async function generate() {
    setGenerating(true)
    setProgress('Loading libraries…')

    try {
      const { jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()

      const NAVY: [number, number, number] = [30, 64, 175]
      const DIY_BG: [number, number, number] = [219, 234, 254]
      const SHOP_BG: [number, number, number] = [220, 252, 231]
      const VERIFIED_BG: [number, number, number] = [240, 253, 244]
      const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ' ' + vehicle.trim : ''}`

      // Assign appendix refs to all receipted logs (chronological)
      const receiptRefMap = new Map<string, string>()
      let refIdx = 1
      for (const log of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
        if (log.receipt_url) receiptRefMap.set(log.id, `A${refIdx++}`)
      }

      function addFooter() {
        const pg = doc.getNumberOfPages()
        doc.setFontSize(7.5)
        doc.setTextColor(150, 150, 150)
        doc.text(`${vehicleName}  ·  Page ${pg}`, pageW / 2, pageH - 5, { align: 'center' })
      }

      function addPageHeader(title: string, sub?: string) {
        doc.setFillColor(...NAVY)
        doc.rect(0, 0, pageW, sub ? 18 : 14, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(title, pageW / 2, sub ? 10 : 9, { align: 'center' })
        if (sub) {
          doc.setFontSize(8)
          doc.setFont('helvetica', 'normal')
          doc.text(sub, pageW / 2, 15, { align: 'center' })
        }
      }

      function drawServiceTable(logsForTable: ServiceLog[], startY: number, includeServiceCol: boolean) {
        const sorted = [...logsForTable].sort((a, b) => a.date.localeCompare(b.date))
        const rows = sorted.map(log => {
          const ref = receiptRefMap.get(log.id) ?? '—'
          const verified = receiptRefMap.has(log.id) ? '✓ ' + ref : '—'
          return [
            format(parseISO(log.date), 'MMM d, yyyy'),
            log.odometer ? log.odometer.toLocaleString() + ' mi' : '—',
            ...(includeServiceCol ? [log.service_type] : []),
            log.performed_by === 'shop' ? 'Shop' : 'DIY',
            log.shop_name ? log.shop_name + (log.shop_location ? '\n' + log.shop_location : '') : '—',
            ref,
            verified,
          ]
        })

        const baseColWidths = includeServiceCol
          ? [22, 20, 36, 12, 34, 10, 18]  // with service col
          : [24, 22, 12, 42, 10, 18]       // without (Date Odo By Shop Ref Verified)

        autoTable(doc, {
          head: [
            [
              'Date', 'Odometer',
              ...(includeServiceCol ? ['Service'] : []),
              'By', 'Shop / Location', 'Ref', 'Verified',
            ],
          ],
          body: rows,
          startY,
          margin: { left: 10, right: 10 },
          headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fontSize: 7.5, cellPadding: 2 },
          columnStyles: Object.fromEntries(baseColWidths.map((w, i) => [i, { cellWidth: w }])),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          willDrawCell: (data: any) => {
            if (data.section !== 'body') return
            const log = sorted[data.row.index]
            if (!log) return
            const lastCol = includeServiceCol ? 6 : 5
            if (data.column.index === lastCol && receiptRefMap.has(log.id)) {
              data.cell.styles.fillColor = VERIFIED_BG
              data.cell.styles.textColor = [22, 101, 52]
            } else if (log.performed_by === 'owner') {
              data.cell.styles.fillColor = DIY_BG
            } else {
              data.cell.styles.fillColor = SHOP_BG
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          didDrawPage: (_data: any) => { addFooter() },
        })

        // Return finalY
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (doc as any).lastAutoTable?.finalY as number ?? startY + 20
      }

      // ── COVER PAGE ────────────────────────────────────────────────────────────
      doc.setFillColor(...NAVY)
      doc.rect(0, 0, pageW, 52, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('VEHICLE HISTORY REPORT', pageW / 2, 18, { align: 'center' })
      doc.setFontSize(13)
      doc.setFont('helvetica', 'normal')
      doc.text(vehicleName, pageW / 2, 29, { align: 'center' })
      doc.setFontSize(9)
      doc.text(`Generated ${format(new Date(), 'MMMM d, yyyy')}`, pageW / 2, 37, { align: 'center' })
      if (vehicle.vin) doc.text(`VIN: ${vehicle.vin}`, pageW / 2, 44, { align: 'center' })

      let sy = 62
      doc.setTextColor(30, 41, 59)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('SERVICE SUMMARY', 14, sy)
      sy += 7

      const maintTypes = Array.from(new Set(maintenanceLogs.map(l => l.service_type))).sort()
      const summaryItems: [string, string][] = [
        ['Total Records', String(logs.length)],
        ['Maintenance Types', String(maintTypes.length)],
        ['Repair Records', String(repairLogs.length)],
        ['DIY Services', String(logs.filter(l => l.performed_by !== 'shop').length)],
        ['Shop Services', String(logs.filter(l => l.performed_by === 'shop').length)],
        ['Verified (Receipt on file)', String(receiptCount)],
        ['Total Documented Spend', logs.some(l => l.cost != null) ? `$${logs.reduce((s, l) => s + Number(l.cost ?? 0), 0).toFixed(2)}` : 'N/A'],
        ['Current Odometer', `${vehicle.odometer.toLocaleString()} mi`],
      ]
      for (const [label, val] of summaryItems) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139)
        doc.text(label, 14, sy)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42)
        doc.text(val, pageW - 14, sy, { align: 'right' })
        doc.setDrawColor(226, 232, 240); doc.line(14, sy + 2, pageW - 14, sy + 2)
        sy += 8
      }

      sy += 4
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 41, 59)
      doc.text('CONTENTS', 14, sy); sy += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139)
      maintTypes.forEach((t, i) => { doc.text(`${i + 2}. ${t}`, 14, sy); sy += 5 })
      if (repairLogs.length > 0) { doc.text(`${maintTypes.length + 2}. Repair History`, 14, sy); sy += 5 }
      if (receiptCount > 0) { doc.text(`${maintTypes.length + (repairLogs.length > 0 ? 3 : 2)}. Appendix — Receipts`, 14, sy) }

      addFooter()

      // ── ONE PAGE PER MAINTENANCE TYPE ─────────────────────────────────────────
      for (const svcType of maintTypes) {
        setProgress(`Building: ${svcType}…`)
        const typeLogs = maintenanceLogs
          .filter(l => l.service_type === svcType)
          .sort((a, b) => a.date.localeCompare(b.date))

        doc.addPage()
        addPageHeader(svcType.toUpperCase(), `${typeLogs.length} record${typeLogs.length !== 1 ? 's' : ''}`)

        const finalY = drawServiceTable(typeLogs, 22, false)

        const avgs = computeAverages(typeLogs)
        if (avgs.avgMiles || avgs.avgDays) {
          const ay = finalY + 8
          if (ay < pageH - 20) {
            doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
            doc.text('AVERAGE INTERVAL', 10, ay)
            doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
            const parts: string[] = []
            if (avgs.avgMiles) parts.push(`${avgs.avgMiles.toLocaleString()} mi between services`)
            if (avgs.avgDays) parts.push(`${Math.round(avgs.avgDays / 30)} months between services`)
            doc.text(parts.join('   ·   '), 10, ay + 5.5)
          }
        }
      }

      // ── REPAIR HISTORY PAGE ──────────────────────────────────────────────────
      if (repairLogs.length > 0) {
        setProgress('Building repair history…')
        doc.addPage()
        addPageHeader('REPAIR HISTORY', `${repairLogs.length} record${repairLogs.length !== 1 ? 's' : ''}`)
        drawServiceTable(repairLogs, 22, true)
      }

      // ── APPENDIX: RECEIPTS ──────────────────────────────────────────────────
      if (receiptCount > 0) {
        setProgress(`Loading ${receiptCount} receipt${receiptCount !== 1 ? 's' : ''}…`)
        doc.addPage()
        addPageHeader('APPENDIX — SERVICE RECEIPTS')
        let ay = 22

        const logsWithReceipts = [...logs]
          .sort((a, b) => a.date.localeCompare(b.date))
          .filter(l => l.receipt_url)

        for (const log of logsWithReceipts) {
          if (!log.receipt_url) continue
          const ref = receiptRefMap.get(log.id) ?? '?'
          const title = `${ref}  —  ${log.service_type}  ·  ${format(parseISO(log.date), 'MMM d, yyyy')}${log.shop_name ? '  ·  ' + log.shop_name : ''}`

          if (ay > pageH - 30) {
            doc.addPage()
            addPageHeader('APPENDIX — SERVICE RECEIPTS (cont.)')
            ay = 22
          }

          doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
          doc.text(title, 10, ay)
          ay += 5

          const asset = await fetchReceiptAsset(log.receipt_url)
          if (asset) {
            const maxW = pageW - 20
            const maxH = 150
            if (ay + maxH > pageH - 10) {
              doc.addPage()
              addPageHeader('APPENDIX — SERVICE RECEIPTS (cont.)')
              ay = 22
            }
            doc.addImage(asset.data, asset.format, 10, ay, maxW, maxH, undefined, 'FAST')
            ay += maxH + 10
          } else {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
            doc.text('(PDF receipt — see original file)', 10, ay + 3)
            ay += 12
          }
        }
        addFooter()
      }

      setProgress('Saving PDF…')
      const filename = `vGarage-${vehicle.year}-${vehicle.make}-${vehicle.model}.pdf`
        .replace(/\s+/g, '-').toLowerCase()
      doc.save(filename)
      onClose()
    } catch (err) {
      console.error(err)
      setProgress('Error generating PDF. Check console.')
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-zinc-100 text-lg">Export Car History</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-4 py-3">
            <span className="text-zinc-400 text-sm">Total records</span>
            <span className="text-zinc-100 font-semibold">{logs.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-blue-300 font-bold">{logs.filter(l => l.performed_by !== 'shop').length}</p>
              <p className="text-zinc-500 text-xs">DIY</p>
            </div>
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-green-400 font-bold">{logs.filter(l => l.performed_by === 'shop').length}</p>
              <p className="text-zinc-500 text-xs">Shop</p>
            </div>
            <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2.5 text-center">
              <p className="text-blue-400 font-bold">{receiptCount}</p>
              <p className="text-zinc-500 text-xs">Verified</p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl px-4 py-3 mb-5 space-y-1.5">
          <p className="text-zinc-300 text-sm font-medium">Report includes:</p>
          {[
            'Cover with summary & table of contents',
            'One page per maintenance type with interval averages',
            repairLogs.length > 0 ? `Repair history page (${repairLogs.length})` : null,
            'Verified column for receipted services',
            receiptCount > 0 ? `Appendix: ${receiptCount} receipt image${receiptCount !== 1 ? 's' : ''}` : null,
          ].filter(Boolean).map(item => (
            <div key={item as string} className="flex items-center gap-2 text-zinc-400 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              {item}
            </div>
          ))}
        </div>

        {generating ? (
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">{progress}</p>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button
              onClick={generate}
              disabled={logs.length === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
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
