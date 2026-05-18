'use client'

import { useState } from 'react'
import { X, Copy, Check, Upload, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { ServiceCategory, Vehicle } from '@/lib/types'

const CLAUDE_PROMPT = `I have a Carfax vehicle history report for my 2022 Honda Civic Sport. Please extract every service record from it and return them as a JSON array — nothing else, just raw JSON, no markdown fences, no explanatory text.

Each object must follow this exact shape:
{
  "date": "YYYY-MM-DD",
  "odometer": 12345,
  "service_type": "Brief service name (e.g. Oil Change, Tire Rotation, Multi-Point Inspection)",
  "shop_name": "Name of dealership or shop",
  "shop_location": "City, ST",
  "cost": 99.99,
  "notes": "any extra detail or null"
}

Rules:
- date: YYYY-MM-DD format; if only month/year is known, use the 1st of that month
- odometer: integer miles; null if not shown
- cost: decimal dollars if visible; otherwise null
- notes: null if nothing extra to note
- One entry per distinct service line — split multi-service visits into separate objects
- Skip non-service entries: ownership changes, CARFAX Advantage badges, accident reports, registration renewals
- All records should have "performed_by": "shop" since Carfax only captures shop visits

Here is my Carfax report text (paste it below this line):
`

interface Props {
  vehicle: Vehicle
  categories: ServiceCategory[]
  onClose: () => void
  onImported: () => void
}

interface ImportRow {
  date: string
  odometer: number | null
  service_type: string
  shop_name: string | null
  shop_location: string | null
  cost: number | null
  notes: string | null
}

export default function CarfaxImportModal({ vehicle, categories, onClose, onImported }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'prompt' | 'import'>('prompt')
  const [jsonText, setJsonText] = useState('')
  const [parsed, setParsed] = useState<ImportRow[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: number; lastError?: string } | null>(null)

  async function copyPrompt() {
    await navigator.clipboard.writeText(CLAUDE_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function parseJson() {
    setParseError(null)
    setParsed(null)
    try {
      const data = JSON.parse(jsonText.trim())
      if (!Array.isArray(data)) throw new Error('Expected a JSON array')
      const rows: ImportRow[] = data.map((r, i) => {
        if (!r.service_type) throw new Error(`Row ${i + 1}: missing service_type`)
        if (!r.date) throw new Error(`Row ${i + 1}: missing date`)
        const rawOdo = r.odometer != null ? parseFloat(String(r.odometer).replace(/[^0-9.]/g, '')) : null
        const rawCost = r.cost != null ? parseFloat(String(r.cost).replace(/[^0-9.]/g, '')) : null
        return {
          date: r.date,
          odometer: rawOdo != null && !isNaN(rawOdo) ? Math.round(rawOdo) : null,
          service_type: String(r.service_type).trim(),
          shop_name: r.shop_name ? String(r.shop_name).trim() : null,
          shop_location: r.shop_location ? String(r.shop_location).trim() : null,
          cost: rawCost != null && !isNaN(rawCost) ? rawCost : null,
          notes: r.notes ? String(r.notes).trim() : null,
        }
      })
      setParsed(rows)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  async function handleImport() {
    if (!parsed || !user) return
    setImporting(true)
    let success = 0
    let errors = 0
    let lastError: string | undefined

    for (const row of parsed) {
      const matchedCat = categories.find(
        c => c.name.toLowerCase() === row.service_type.toLowerCase()
      )
      const { error } = await supabase.from('service_logs').insert({
        user_id: user.id,
        vehicle_id: vehicle.id,
        service_type: row.service_type,
        category_id: matchedCat?.id ?? null,
        record_type: 'maintenance',
        performed_by: 'shop',
        shop_name: row.shop_name,
        shop_location: row.shop_location,
        date: row.date,
        odometer: row.odometer ?? 0,
        cost: row.cost,
        notes: row.notes,
      })
      if (error) {
        errors++
        if (!lastError) lastError = error.message
        console.error('Import row error:', error.message, row)
        // Schema not migrated — no point continuing row by row
        if (error.message.includes('schema cache') || error.message.includes('column')) {
          errors += parsed.length - success - errors
          break
        }
      } else {
        success++
      }
    }

    setImporting(false)
    setImportResult({ success, errors, lastError })
    if (success > 0) onImported()
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
          <div>
            <h3 className="font-bold text-zinc-100 text-lg">Import from Carfax</h3>
            <p className="text-zinc-500 text-sm">Use Claude to extract your shop history</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          {(['prompt', 'import'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-amber-500 border-b-2 border-amber-500'
                  : 'text-zinc-500'
              }`}
            >
              {t === 'prompt' ? '1. Get Claude Prompt' : '2. Paste JSON Output'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {tab === 'prompt' && (
            <div className="space-y-4">
              <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-3">
                <p className="text-zinc-300 text-sm leading-relaxed font-medium mb-2">How it works:</p>
                <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                  <li>Open your Carfax report and copy all the text</li>
                  <li>Copy the prompt below and paste it into Claude.ai</li>
                  <li>Append your Carfax text after the prompt</li>
                  <li>Copy Claude&apos;s JSON output, then go to tab 2</li>
                </ol>
              </div>

              <div className="relative">
                <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-zinc-300 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono">
                  {CLAUDE_PROMPT}
                </pre>
                <button
                  onClick={copyPrompt}
                  className={`absolute top-3 right-3 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                    copied
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <button
                onClick={() => setTab('import')}
                className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl py-3 transition-colors"
              >
                Next: Paste JSON →
              </button>
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-4">
              {importResult ? (
                <div className="text-center py-6">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${importResult.success > 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    <Check size={28} className={importResult.success > 0 ? 'text-green-400' : 'text-red-400'} />
                  </div>
                  <p className="font-bold text-zinc-100 text-lg">
                    {importResult.success > 0 ? 'Import Complete' : 'Import Failed'}
                  </p>
                  <p className="text-zinc-400 text-sm mt-1">
                    {importResult.success} imported
                    {importResult.errors > 0 && `, ${importResult.errors} failed`}
                  </p>
                  {importResult.lastError && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-3 text-left space-y-1.5">
                      {(importResult.lastError.includes('schema cache') || importResult.lastError.includes('column')) ? (
                        <>
                          <p className="text-red-400 text-xs font-semibold">Database migration required</p>
                          <p className="text-zinc-400 text-xs">Run <span className="font-mono text-amber-400">supabase/schema_v2.sql</span> in your Supabase SQL Editor, then retry the import.</p>
                        </>
                      ) : (
                        <p className="text-red-400 text-xs">Error: {importResult.lastError}</p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={onClose}
                    className="mt-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-2xl px-6 py-2.5 transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-zinc-400 text-sm">Paste Claude&apos;s JSON output here:</p>
                  <textarea
                    value={jsonText}
                    onChange={e => { setJsonText(e.target.value); setParsed(null); setParseError(null) }}
                    placeholder={'[\n  {\n    "date": "2023-05-12",\n    "service_type": "Oil Change",\n    ...\n  }\n]'}
                    rows={8}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-amber-500/70 transition-all text-xs font-mono resize-none"
                  />

                  {parseError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400 text-sm">{parseError}</p>
                    </div>
                  )}

                  {parsed && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                      <p className="text-green-400 text-sm font-medium">
                        ✓ {parsed.length} records ready to import
                      </p>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        Records will be imported as shop-performed. You can edit them after.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {!parsed ? (
                      <button
                        onClick={parseJson}
                        disabled={!jsonText.trim()}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-100 font-medium rounded-2xl py-3 transition-colors"
                      >
                        Validate JSON
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => { setParsed(null); setJsonText('') }}
                          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
                        >
                          Clear
                        </button>
                        <button
                          onClick={handleImport}
                          disabled={importing}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
                        >
                          <Upload size={16} />
                          {importing ? 'Importing…' : `Import ${parsed.length} Records`}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
