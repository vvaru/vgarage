'use client'

import { useState, useEffect } from 'react'
import { X, Copy, Check, Upload, AlertCircle, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { ServiceCategory, Vehicle } from '@/lib/types'

function buildClaudePrompt() {
  return `I have vehicle service records I need to import into a car maintenance tracker. These may be from a Carfax report, a dealership service PDF, or my own handwritten/typed notes. Extract every service record and return them as a JSON array — nothing else, just raw JSON, no markdown fences, no explanatory text.

Each object must follow this exact shape:
{
  "session_key": 1,
  "date": "YYYY-MM-DD",
  "odometer": 12345,
  "service_type": "Brief service name (e.g. Oil Change, Tire Rotation, Brake Inspection)",
  "performed_by": "shop",
  "shop_name": "Name of dealership or shop, or null if self-performed",
  "shop_location": "City, ST or null",
  "cost": 99.99,
  "notes": "specific detail, product names, part numbers, or null"
}

Rules:
- session_key: assign the SAME integer to all services performed on the same date at the same shop (or the same DIY session). Each distinct visit or DIY session gets its own unique sequential integer (1, 2, 3...). This is critical for correctly grouping multi-service visits.
- date: YYYY-MM-DD format; if only month/year is known, use the 1st of that month
- odometer: integer miles; null if not shown
- performed_by: "shop" if done at a dealership/mechanic/shop; "owner" if self-performed/DIY
- cost: decimal dollars for that specific service line; null if not shown. If only a visit total is shown for multiple services, split it evenly among them.
- notes: include product names, part numbers, technician remarks, or warranty info if present; null otherwise
- One entry per distinct service line — split multi-service visits into SEPARATE objects all sharing the same session_key
- Skip non-service entries: ownership transfers, accident/damage reports, registration renewals, title changes, CARFAX Advantage badges, emissions/safety inspections that are just pass/fail with no service performed
- For personal notes: interpret common abbreviations (OC = Oil Change, TR = Tire Rotation, AIR = Air Filter, etc.) and infer performed_by from context (e.g. "did myself", "took to Jiffy Lube")
- If the same service appears multiple times in the same visit (unusual), keep them as separate entries with the same session_key

Here are the service records to parse (paste them below this line):
`
}

interface Props {
  vehicle: Vehicle
  categories: ServiceCategory[]
  onClose: () => void
  onImported: () => void
}

interface ExistingLog {
  id: string
  date: string
  service_type: string
}

interface ParsedRow {
  session_key: number
  date: string
  odometer: number | null
  service_type: string
  performed_by: 'shop' | 'owner'
  shop_name: string | null
  shop_location: string | null
  cost: number | null
  notes: string | null
}

type RowAction = 'import' | 'skip' | 'replace'

interface ReviewRow extends ParsedRow {
  action: RowAction
  isDuplicate: boolean
  duplicateLogId: string | null
  editingName: string | null
}

export default function CarfaxImportModal({ vehicle, categories, onClose, onImported }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'prompt' | 'import'>('prompt')
  const [jsonText, setJsonText] = useState('')
  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; skipped: number; replaced: number; errors: number; lastError?: string } | null>(null)
  const [existingLogs, setExistingLogs] = useState<ExistingLog[]>([])

  useEffect(() => {
    supabase
      .from('service_logs')
      .select('id,date,service_type')
      .eq('vehicle_id', vehicle.id)
      .then(({ data }) => setExistingLogs((data ?? []) as ExistingLog[]))
  }, [vehicle.id])

  function findDuplicate(date: string, serviceName: string): ExistingLog | null {
    return existingLogs.find(
      l => l.date === date && l.service_type.toLowerCase().trim() === serviceName.toLowerCase().trim()
    ) ?? null
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildClaudePrompt())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function parseJson() {
    setParseError(null)
    setReviewRows(null)
    try {
      const data = JSON.parse(jsonText.trim())
      if (!Array.isArray(data)) throw new Error('Expected a JSON array')
      const rows: ParsedRow[] = data.map((r, i) => {
        if (!r.service_type) throw new Error(`Row ${i + 1}: missing service_type`)
        if (!r.date) throw new Error(`Row ${i + 1}: missing date`)
        const rawOdo = r.odometer != null ? parseFloat(String(r.odometer).replace(/[^0-9.]/g, '')) : null
        const rawCost = r.cost != null ? parseFloat(String(r.cost).replace(/[^0-9.]/g, '')) : null
        const perfBy = String(r.performed_by ?? 'shop').toLowerCase().trim() === 'owner' ? 'owner' : 'shop'
        return {
          session_key: typeof r.session_key === 'number' ? r.session_key : i + 1,
          date: r.date,
          odometer: rawOdo != null && !isNaN(rawOdo) ? Math.round(rawOdo) : null,
          service_type: String(r.service_type).trim(),
          performed_by: perfBy as 'shop' | 'owner',
          shop_name: r.shop_name ? String(r.shop_name).trim() : null,
          shop_location: r.shop_location ? String(r.shop_location).trim() : null,
          cost: rawCost != null && !isNaN(rawCost) ? rawCost : null,
          notes: r.notes ? String(r.notes).trim() : null,
        }
      })

      const reviewed: ReviewRow[] = rows.map(row => {
        const dup = findDuplicate(row.date, row.service_type)
        return {
          ...row,
          action: dup ? 'skip' : 'import',
          isDuplicate: !!dup,
          duplicateLogId: dup?.id ?? null,
          editingName: null,
        }
      })
      setReviewRows(reviewed)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  function commitRename(idx: number, newName: string) {
    setReviewRows(prev => prev ? prev.map((row, i) => {
      if (i !== idx) return row
      const name = newName.trim() || row.service_type
      const dup = findDuplicate(row.date, name)
      return {
        ...row,
        service_type: name,
        editingName: null,
        isDuplicate: !!dup,
        duplicateLogId: dup?.id ?? null,
        action: dup ? 'skip' : (row.action === 'skip' ? 'import' : row.action),
      }
    }) : null)
  }

  function setAction(idx: number, action: RowAction) {
    setReviewRows(prev => prev ? prev.map((row, i) => i === idx ? { ...row, action } : row) : null)
  }

  async function handleImport() {
    if (!reviewRows || !user) return
    setImporting(true)
    let success = 0, skipped = 0, replaced = 0, errors = 0
    let lastError: string | undefined

    // Pre-generate one session_id UUID per unique session_key.
    // Only used if the session_id column exists in the DB (detected on first insert attempt).
    const sessionIdMap = new Map<number, string>()
    for (const row of reviewRows) {
      if (row.action === 'skip') continue
      if (!sessionIdMap.has(row.session_key)) {
        sessionIdMap.set(row.session_key, crypto.randomUUID())
      }
    }

    let sessionIdSupported: boolean | null = null // null = not yet tested

    for (const row of reviewRows) {
      if (row.action === 'skip') { skipped++; continue }

      // Replace: delete the existing log first
      if (row.action === 'replace' && row.duplicateLogId) {
        await supabase.from('service_logs').delete().eq('id', row.duplicateLogId)
        replaced++
      }

      const matchedCat = categories.find(c => c.name.toLowerCase() === row.service_type.toLowerCase())
      const sessionId = sessionIdMap.get(row.session_key) ?? null

      const basePayload = {
        user_id: user.id,
        vehicle_id: vehicle.id,
        service_type: row.service_type,
        category_id: matchedCat?.id ?? null,
        record_type: 'maintenance',
        performed_by: row.performed_by,
        shop_name: row.shop_name,
        shop_location: row.shop_location,
        date: row.date,
        odometer: row.odometer ?? 0,
        cost: row.cost,
        notes: row.notes,
      }

      // Try with session_id if column is known to exist (or unknown yet)
      const withSession = sessionIdSupported !== false && sessionId !== null
        ? { ...basePayload, session_id: sessionId }
        : basePayload

      let { error } = await supabase.from('service_logs').insert(withSession)

      // If session_id column doesn't exist, retry without it
      if (error && error.message.includes('session_id')) {
        sessionIdSupported = false
        const retry = await supabase.from('service_logs').insert(basePayload)
        error = retry.error
      } else if (!error && sessionId !== null) {
        sessionIdSupported = true
      }

      if (error) {
        errors++
        if (!lastError) lastError = error.message
      } else {
        success++
      }
    }

    setImporting(false)
    setImportResult({ success, skipped, replaced, errors, lastError })
    if (success > 0) onImported()
  }

  const toImportCount = reviewRows?.filter(r => r.action !== 'skip').length ?? 0
  const duplicateCount = reviewRows?.filter(r => r.isDuplicate).length ?? 0

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
          <div>
            <h3 className="font-bold text-zinc-100 text-lg">Import Service Records</h3>
            <p className="text-zinc-500 text-sm">Carfax, dealer PDFs, or your own notes</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
        </div>

        <div className="flex border-b border-zinc-800 shrink-0">
          {(['prompt', 'import'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === t ? 'text-blue-500 border-b-2 border-blue-500' : 'text-zinc-500'}`}>
              {t === 'prompt' ? '1. Get Claude Prompt' : '2. Paste & Review'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-5">

          {/* ── Step 1: Copy prompt ── */}
          {tab === 'prompt' && (
            <div className="space-y-4">
              <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-3">
                <p className="text-zinc-300 text-sm font-medium mb-2">How it works:</p>
                <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                  <li>Copy the prompt below and open Claude.ai</li>
                  <li>Paste the prompt, then paste your service records after it</li>
                  <li>Works with Carfax text, dealer PDFs, or your own notes</li>
                  <li>Copy Claude&apos;s JSON output → go to tab 2 to review</li>
                </ol>
              </div>
              <div className="relative">
                <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-zinc-300 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono">
                  {buildClaudePrompt()}
                </pre>
                <button onClick={copyPrompt}
                  className={`absolute top-3 right-3 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${copied ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'}`}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button onClick={() => setTab('import')} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl py-3 transition-colors">
                Next: Paste JSON →
              </button>
            </div>
          )}

          {/* ── Step 2: Paste, review, import ── */}
          {tab === 'import' && (
            <div className="space-y-4">

              {/* Done state */}
              {importResult ? (
                <div className="text-center py-6">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${importResult.success > 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    <Check size={28} className={importResult.success > 0 ? 'text-green-400' : 'text-red-400'} />
                  </div>
                  <p className="font-bold text-zinc-100 text-lg">{importResult.success > 0 ? 'Import Complete' : 'Import Failed'}</p>
                  <p className="text-zinc-400 text-sm mt-1">
                    {importResult.success} imported
                    {importResult.replaced > 0 ? ` (${importResult.replaced} replaced)` : ''}
                    {importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}
                    {importResult.errors > 0 ? `, ${importResult.errors} failed` : ''}
                  </p>
                  {importResult.lastError && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-3 text-left">
                      <p className="text-red-400 text-xs">Error: {importResult.lastError}</p>
                    </div>
                  )}
                  <button onClick={onClose} className="mt-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-2xl px-6 py-2.5 transition-colors">Done</button>
                </div>

              /* Review state */
              ) : reviewRows ? (
                <>
                  {/* Summary banner */}
                  <div className={`rounded-xl px-4 py-3 border ${duplicateCount > 0 ? 'bg-blue-500/5 border-blue-500/20' : 'bg-green-500/5 border-green-500/20'}`}>
                    <p className={`text-sm font-medium ${duplicateCount > 0 ? 'text-blue-400' : 'text-green-400'}`}>
                      {toImportCount} of {reviewRows.length} records will be imported
                    </p>
                    {duplicateCount > 0 && (
                      <p className="text-zinc-500 text-xs mt-0.5">
                        {duplicateCount} possible duplicate{duplicateCount !== 1 ? 's' : ''} detected — review each one below
                      </p>
                    )}
                  </div>

                  {/* Per-row review */}
                  <div className="space-y-2">
                    {reviewRows.map((row, idx) => (
                      <div key={idx} className={`border rounded-2xl overflow-hidden transition-opacity ${row.action === 'skip' ? 'opacity-50 bg-zinc-800/20 border-zinc-800' : row.isDuplicate ? 'bg-blue-500/5 border-blue-500/25' : 'bg-zinc-800/50 border-zinc-700/60'}`}>
                        <div className="flex items-start gap-3 px-3 py-3">
                          {/* Action toggle for non-duplicates */}
                          {!row.isDuplicate && (
                            <button
                              onClick={() => setAction(idx, row.action === 'import' ? 'skip' : 'import')}
                              className={`shrink-0 mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${row.action === 'import' ? 'bg-blue-500 border-blue-500 text-zinc-950' : 'bg-zinc-800 border-zinc-700 text-zinc-600'}`}
                              title={row.action === 'import' ? 'Click to skip' : 'Click to import'}
                            >
                              {row.action === 'import' && <Check size={11} />}
                            </button>
                          )}
                          {/* Duplicate indicator */}
                          {row.isDuplicate && (
                            <div className="shrink-0 mt-0.5 w-5 h-5 rounded border border-blue-500/40 bg-blue-500/10 flex items-center justify-center">
                              <span className="text-blue-400 text-xs font-bold">!</span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            {/* Service name (editable) */}
                            {row.editingName !== null ? (
                              <input
                                type="text"
                                value={row.editingName}
                                autoFocus
                                onChange={e => setReviewRows(prev => prev ? prev.map((r, i) => i === idx ? { ...r, editingName: e.target.value } : r) : null)}
                                onBlur={e => commitRename(idx, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitRename(idx, row.editingName ?? row.service_type)
                                  if (e.key === 'Escape') setReviewRows(prev => prev ? prev.map((r, i) => i === idx ? { ...r, editingName: null } : r) : null)
                                }}
                                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70"
                              />
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-medium ${row.action === 'skip' ? 'text-zinc-500' : 'text-zinc-100'}`}>{row.service_type}</p>
                                {row.isDuplicate && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0">⚠ Duplicate</span>
                                )}
                                <button
                                  onClick={() => setReviewRows(prev => prev ? prev.map((r, i) => i === idx ? { ...r, editingName: r.service_type } : r) : null)}
                                  className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                                  title="Rename"
                                >
                                  <Pencil size={10} />
                                </button>
                              </div>
                            )}
                            <p className="text-zinc-500 text-xs mt-0.5">
                              {row.date}
                              {row.odometer ? ` · ${row.odometer.toLocaleString()} mi` : ''}
                              {row.shop_name ? ` · ${row.shop_name}` : ''}
                              {row.cost != null ? ` · $${row.cost.toFixed(2)}` : ''}
                              {row.performed_by === 'owner' ? ' · 🔧 DIY' : ''}
                            </p>
                          </div>
                        </div>

                        {/* Duplicate action bar */}
                        {row.isDuplicate && (
                          <div className="border-t border-blue-500/20 px-3 py-2.5 flex items-center gap-2 flex-wrap">
                            <p className="text-zinc-500 text-xs flex-1">A record with this name already exists on this date.</p>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                onClick={() => setAction(idx, 'skip')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${row.action === 'skip' ? 'bg-zinc-700 text-zinc-200 border-zinc-600' : 'text-zinc-500 border-zinc-700 hover:text-zinc-300'}`}
                              >
                                Skip
                              </button>
                              <button
                                onClick={() => setAction(idx, 'replace')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${row.action === 'replace' ? 'bg-red-500/20 text-red-400 border-red-500/40' : 'text-zinc-500 border-zinc-700 hover:text-red-400'}`}
                              >
                                Replace old
                              </button>
                              <button
                                onClick={() => setAction(idx, 'import')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${row.action === 'import' ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'text-zinc-500 border-zinc-700 hover:text-blue-400'}`}
                              >
                                Keep both
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button onClick={() => { setReviewRows(null); setJsonText('') }} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Back</button>
                    <button
                      onClick={handleImport}
                      disabled={importing || toImportCount === 0}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
                    >
                      <Upload size={15} />
                      {importing ? 'Importing…' : `Import ${toImportCount}`}
                    </button>
                  </div>
                </>

              /* Paste state */
              ) : (
                <>
                  <p className="text-zinc-400 text-sm">Paste Claude&apos;s JSON output here:</p>
                  <textarea
                    value={jsonText}
                    onChange={e => { setJsonText(e.target.value); setParseError(null) }}
                    placeholder={'[\n  {\n    "session_key": 1,\n    "date": "2023-05-12",\n    "service_type": "Oil Change",\n    ...\n  }\n]'}
                    rows={9}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-blue-500/70 transition-all text-xs font-mono resize-none"
                  />
                  {parseError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400 text-sm">{parseError}</p>
                    </div>
                  )}
                  <button
                    onClick={parseJson}
                    disabled={!jsonText.trim()}
                    className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-100 font-medium rounded-2xl py-3 transition-colors"
                  >
                    Validate & Review →
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
