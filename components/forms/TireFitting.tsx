'use client'

import { Chip, Icon, SelectField, TextField } from '@/components/ui/md'
import { POSITION_LABELS, TIRE_POSITIONS, mountedByPosition, storedSets, type TireLife, type TirePosition } from '@/lib/tires'
import type { TireDraft } from '@/lib/recordDraft'

// A tire fitting, asked the way it happens: a whole set unless one got damaged,
// new rubber or a set out of storage, and what became of whatever came off.
export default function TireFitting({ draft: td, onChange, lives, products }: {
  draft: TireDraft
  onChange: (p: Partial<TireDraft>) => void
  lives: TireLife[]
  products: { id: string; name: string }[]
}) {
  const sets = storedSets(lives)
  const stored = lives.filter(l => !l.mounted && !l.retired)
  const onCar = mountedByPosition(lives)
  const corners = (td.scope === 'all' ? [...TIRE_POSITIONS] : td.corners) as TirePosition[]
  const displacing = corners.filter(c => onCar.has(c)).length
  const nameOf = (productId: string | null) => (productId && products.find(p => p.id === productId)?.name) || 'Tires'
  const productName = products.find(p => p.id === td.productId)?.name

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-primary-container/40 p-4">
      <h3 className="type-title-sm text-on-surface flex items-center gap-2"><Icon name="tire_repair" size={18} />Tires fitted</h3>

      <div className="flex flex-col gap-2">
        <span className="type-body text-on-surface-variant">Which tires?</span>
        <div className="flex flex-wrap gap-2">
          <Chip selected={td.scope === 'all'} onClick={() => onChange({ scope: 'all' })}>All four</Chip>
          <Chip selected={td.scope === 'some'} onClick={() => onChange({ scope: 'some' })}>Only some</Chip>
        </div>
        {td.scope === 'some' && (
          <div className="flex flex-wrap gap-2">
            {TIRE_POSITIONS.map(pos => {
              const on = td.corners.includes(pos)
              return <Chip key={pos} selected={on} onClick={() => onChange({ corners: on ? td.corners.filter(x => x !== pos) : [...td.corners, pos] })}>{POSITION_LABELS[pos]}</Chip>
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-body text-on-surface-variant">What went on?</span>
        <div className="flex flex-wrap gap-2">
          <Chip selected={td.source === 'new'} onClick={() => onChange({ source: 'new' })}>New tires</Chip>
          {stored.length > 0 && <Chip selected={td.source === 'storage'} onClick={() => onChange({ source: 'storage' })}>From storage</Chip>}
        </div>
      </div>

      {td.source === 'new' && (products.length === 0 ? (
        <p className="type-body-sm text-on-surface-variant">No tire products yet. Add the tires as a product receipt first (a product “used for” a tire category counts).</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label="Tire" value={td.productId} onChange={e => onChange({ productId: e.target.value })}>
            <option value="">Pick the tire…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <TextField label="Expected life" suffix="mi" type="number" inputMode="numeric" value={td.expectedLife} onChange={e => onChange({ expectedLife: e.target.value })} />
        </div>
      ))}

      {td.source === 'storage' && td.scope === 'all' && (
        <SelectField label="Set from storage" value={td.storedSetKey} onChange={e => onChange({ storedSetKey: e.target.value })}>
          <option value="">Pick the set…</option>
          {sets.map(s => <option key={s.key} value={s.key}>{nameOf(s.productId)} · {s.tires.length} tire{s.tires.length === 1 ? '' : 's'} · {s.miles.toLocaleString()} mi on them</option>)}
        </SelectField>
      )}

      {td.source === 'storage' && td.scope === 'some' && (td.corners as TirePosition[]).map(pos => (
        <SelectField key={pos} label={POSITION_LABELS[pos]} value={td.storedPicks[pos] ?? ''}
          onChange={e => { const next = { ...td.storedPicks }; if (e.target.value) next[pos] = e.target.value; else delete next[pos]; onChange({ storedPicks: next }) }}>
          <option value="">Pick a stored tire…</option>
          {stored.map(l => (
            <option key={l.tire.id} value={l.tire.id} disabled={Object.entries(td.storedPicks).some(([k, v]) => k !== pos && v === l.tire.id)}>
              {nameOf(l.tire.product_id)} · {l.miles.toLocaleString()} mi
            </option>
          ))}
        </SelectField>
      ))}

      {displacing > 0 && (
        <div className="flex flex-col gap-2">
          <span className="type-body text-on-surface-variant">{displacing === 4 ? 'The old set' : `The ${displacing} old tire${displacing === 1 ? '' : 's'}`} coming off:</span>
          <div className="flex flex-wrap gap-2">
            <Chip selected={td.oldFate === 'scrapped'} onClick={() => onChange({ oldFate: 'scrapped' })}>Scrapped</Chip>
            <Chip selected={td.oldFate === 'kept'} onClick={() => onChange({ oldFate: 'kept' })}>Kept in storage</Chip>
          </div>
          <span className="type-body-sm text-on-surface-variant">{td.oldFate === 'scrapped' ? 'They stop being tracked.' : 'They move to storage with their mileage paused, ready to go back on.'}</span>
        </div>
      )}

      {td.source === 'new' && productName && corners.length > 0 && (
        <p className="type-body-sm text-on-surface-variant">
          {corners.length === 4 ? 'Four' : corners.length} new {productName} go on at the odometer above
          {displacing > 0 && (td.oldFate === 'scrapped' ? '; the old ones are scrapped' : '; the old ones go to storage')}.
        </p>
      )}
    </section>
  )
}
