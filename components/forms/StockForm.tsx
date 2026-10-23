'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { withRetry, write } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { loadGarage, productLabel, type GarageContext } from '@/lib/formData'
import { fmtQty, guessUnit, UNIT_GROUPS } from '@/lib/units'
import { Dialog, Icon, Segmented, SelectField, Skeleton, TextField } from '@/components/ui/md'

const num = (s: string): number | null => { const n = parseFloat(s); return s.trim() !== '' && !isNaN(n) ? n : null }
const ADD_REASONS = ['Already had it (old inventory)', 'Gift or hand-me-down', 'Bought, no receipt', 'Correction']
const REMOVE_REASONS = ['Spilled or wasted', 'Gave it away', 'Expired or bad', 'Used, not on a service', 'Correction']

// Stock without a receipt: what you already had, or what left the shelf without
// a service. Each is an inventory adjustment, shown on the product with its reason.
export default function StockForm({ mode: initialMode, productId, onClose, onSaved }: {
  mode: 'add' | 'remove'; productId?: string; onClose: () => void; onSaved: (m: string) => void
}) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [ctx, setCtx] = useState<GarageContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState(initialMode)
  const [pid, setPid] = useState(productId ?? '')
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('each')
  const [amount, setAmount] = useState('')
  const [cost, setCost] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [reason, setReason] = useState(initialMode === 'add' ? ADD_REASONS[0] : REMOVE_REASONS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef({ adj: crypto.randomUUID(), prod: crypto.randomUUID() })

  useEffect(() => {
    if (!user || !vehicle) return
    let live = true
    loadGarage(user.id, vehicle.id, vehicle.odometer).then(g => { if (live) setCtx(g) }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load your products.') })
    return () => { live = false }
  }, [user, vehicle])

  const product = ctx?.products.find(p => p.id === pid)
  const unit = product?.unit ?? newUnit
  const onHand = pid ? ctx?.stock.get(pid)?.onHand ?? 0 : 0
  const amt = num(amount)
  const tooMuch = mode === 'remove' && amt != null && amt > onHand + 1e-9
  const valid = Boolean(ctx && (pid || (mode === 'add' && newName.trim())) && amt && amt > 0 && !tooMuch)
  const choices = mode === 'remove' ? (ctx?.products ?? []).filter(p => (ctx?.stock.get(p.id)?.onHand ?? 0) > 0) : ctx?.products ?? []

  function switchMode(m: 'add' | 'remove') {
    setMode(m)
    setReason(m === 'add' ? ADD_REASONS[0] : REMOVE_REASONS[0])
  }

  async function save() {
    if (!user || !amt) return
    setSaving(true); setError(null)
    try {
      await ensureFreshSession()
      let productId = pid
      if (!productId) {
        productId = ids.current.prod
        const { error: e } = await withRetry(() => write(supabase.from('products').upsert({ id: productId, user_id: user.id, vehicle_id: null, name: newName.trim(), brand: null, unit: newUnit })), 2, 2500)
        if (e) throw new Error(e.message)
      }
      const c = num(cost)
      const { error: e } = await withRetry(() => write(supabase.from('inventory_adjustments').upsert({
        id: ids.current.adj, user_id: user.id, product_id: productId,
        qty_delta: mode === 'add' ? amt : -amt,
        unit_cost: mode === 'add' && c != null ? c / amt : null,
        note: reason, date,
      })), 2, 2500)
      if (e) throw new Error(e.message)
      onSaved(mode === 'add' ? `Added ${fmtQty(amt, unit)} to stock` : `Removed ${fmtQty(amt, unit)} from stock`)
    } catch (e) {
      setError(`Couldn’t save: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={mode === 'add' ? 'Add stock' : 'Remove stock'} size="md"
      subtitle={mode === 'add' ? 'Parts you have without a receipt' : 'Stock that left without a service'}
      primary={{ label: 'Save', onClick: save, disabled: !valid || saving, loading: saving }}>
      {!ctx ? (loadError ? <p className="type-body text-error">{loadError}</p> : <div className="space-y-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div>) : (
        <div className="flex flex-col gap-5">
          <Segmented className="w-full" value={mode} onChange={switchMode} label="Add or remove"
            options={[{ value: 'add', label: 'Add', icon: 'add' }, { value: 'remove', label: 'Remove', icon: 'remove' }]} />
          <SelectField label="Product" value={pid} onChange={e => setPid(e.target.value)}
            helper={pid ? `${fmtQty(onHand, unit)} on hand now` : undefined}>
            {mode === 'add' && <option value="">New product…</option>}
            {mode === 'remove' && !pid && <option value="">Pick a product…</option>}
            {choices.map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
          </SelectField>
          {!pid && mode === 'add' && (
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <TextField label="Product name" value={newName} onChange={e => { setNewName(e.target.value); setNewUnit(guessUnit(e.target.value)) }} />
              <SelectField label="Counted in" value={newUnit} onChange={e => setNewUnit(e.target.value)}>
                {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.units.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
              </SelectField>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Amount" suffix={unit === 'each' ? '' : unit} type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
              error={tooMuch ? `Only ${fmtQty(onHand, unit)} on hand` : undefined} />
            <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {mode === 'add' && (
            <TextField label="What it cost (optional)" prefix="$" type="number" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)}
              helper="For the whole amount. Leave it empty if you don’t know: parts used from it just won’t add to a service’s cost." />
          )}
          <SelectField label="Reason" value={reason} onChange={e => setReason(e.target.value)}>
            {(mode === 'add' ? ADD_REASONS : REMOVE_REASONS).map(r => <option key={r}>{r}</option>)}
          </SelectField>
          <p className="type-body-sm text-on-surface-variant flex gap-2"><Icon name="info" size={16} className="mt-px" />
            {mode === 'add' ? 'It shows on the product as “Added without a receipt”, with this reason.' : 'Use a service instead when the part went into the car, so the service gets its cost.'}</p>
          {error && <p role="alert" className="type-body text-error">{error}</p>}
        </div>
      )}
    </Dialog>
  )
}
