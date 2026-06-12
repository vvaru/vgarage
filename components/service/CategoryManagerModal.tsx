'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Pencil, Trash2, Check, ChevronDown, ChevronRight, ExternalLink, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { ServiceCategory, ServiceCategoryProduct, Vehicle } from '@/lib/types'

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onUpdated: () => void
}

const EMPTY_CAT = { name: '', interval_miles: '', interval_days: '', sub_type: 'service' as 'service' | 'check', category_type: 'maintenance' as 'maintenance' | 'repair' }
const EMPTY_PROD = { name: '', product_url: '', last_price: '' }

export default function CategoryManagerModal({ vehicle, onClose, onUpdated }: Props) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [products, setProducts] = useState<Record<string, ServiceCategoryProduct[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const [editCat, setEditCat] = useState<ServiceCategory | null>(null)
  const [newCat, setNewCat] = useState(false)
  const [catForm, setCatForm] = useState(EMPTY_CAT)
  const [catSaving, setCatSaving] = useState(false)
  const [renameWarn, setRenameWarn] = useState(false)

  const [merging, setMerging] = useState(false)

  const [deleteCatId, setDeleteCatId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [editProd, setEditProd] = useState<{ catId: string; prod: ServiceCategoryProduct | null } | null>(null)
  const [prodForm, setProdForm] = useState(EMPTY_PROD)
  const [prodSaving, setProdSaving] = useState(false)
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: cats } = await supabase
        .from('service_categories')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('name')
      setCategories(cats ?? [])

      if (cats?.length) {
        const { data: prods } = await supabase
          .from('service_category_products')
          .select('*')
          .in('category_id', cats.map(c => c.id))
          .order('created_at')
        const grouped: Record<string, ServiceCategoryProduct[]> = {}
        for (const p of prods ?? []) {
          grouped[p.category_id] = [...(grouped[p.category_id] ?? []), p]
        }
        setProducts(grouped)
      }
    } finally {
      setLoading(false)
    }
  }, [vehicle.id])

  useEffect(() => { load() }, [load])

  function openEditCat(cat: ServiceCategory) {
    setEditCat(cat)
    setNewCat(false)
    setCatForm({
      name: cat.name,
      interval_miles: cat.interval_miles != null ? String(cat.interval_miles) : '',
      interval_days: cat.interval_days != null ? String(cat.interval_days) : '',
      sub_type: cat.sub_type ?? 'service',
      category_type: cat.category_type,
    })
    setRenameWarn(false)
  }

  function openNewCat() {
    setEditCat(null)
    setNewCat(true)
    setCatForm(EMPTY_CAT)
  }

  async function saveCat() {
    if (!user || !catForm.name.trim()) return
    setCatSaving(true)

    if (newCat) {
      await supabase.from('service_categories').insert({
        user_id: user.id,
        vehicle_id: vehicle.id,
        name: catForm.name.trim(),
        category_type: catForm.category_type,
        sub_type: catForm.category_type === 'maintenance' ? catForm.sub_type : null,
        interval_miles: catForm.interval_miles ? parseInt(catForm.interval_miles) : null,
        interval_days: catForm.interval_days ? parseInt(catForm.interval_days) : null,
      })
    } else if (editCat) {
      const nameChanged = catForm.name.trim() !== editCat.name
      await supabase.from('service_categories').update({
        name: catForm.name.trim(),
        sub_type: editCat.category_type === 'maintenance' ? catForm.sub_type : null,
        interval_miles: catForm.interval_miles ? parseInt(catForm.interval_miles) : null,
        interval_days: catForm.interval_days ? parseInt(catForm.interval_days) : null,
      }).eq('id', editCat.id)

      if (nameChanged) {
        await supabase.from('service_logs')
          .update({ service_type: catForm.name.trim() })
          .eq('category_id', editCat.id)
      }
    }

    setCatSaving(false)
    setEditCat(null)
    setNewCat(false)
    await load()
    onUpdated()
  }

  async function mergeAllDuplicates() {
    setMerging(true)
    const byName = new Map<string, ServiceCategory[]>()
    for (const cat of categories) {
      const key = cat.name.toLowerCase().trim()
      byName.set(key, [...(byName.get(key) ?? []), cat])
    }
    for (const [, group] of byName) {
      if (group.length <= 1) continue
      const primary = group.find(c => c.interval_miles || c.interval_days) ?? group[0]
      const duplicates = group.filter(c => c.id !== primary.id)
      for (const dup of duplicates) {
        await supabase.from('service_logs').update({ category_id: primary.id }).eq('category_id', dup.id)
        await supabase.from('service_category_products').update({ category_id: primary.id }).eq('category_id', dup.id)
        await supabase.from('service_categories').delete().eq('id', dup.id)
      }
    }
    await load()
    onUpdated()
    setMerging(false)
  }

  async function confirmDelete() {
    if (!deleteCatId) return
    setDeleting(true)
    await supabase.from('service_categories').delete().eq('id', deleteCatId)
    setDeleting(false)
    setDeleteCatId(null)
    setDeleteConfirm(false)
    await load()
    onUpdated()
  }

  function openEditProd(catId: string, prod: ServiceCategoryProduct | null) {
    setEditProd({ catId, prod })
    setProdForm(prod ? {
      name: prod.name,
      product_url: prod.product_url ?? '',
      last_price: prod.last_price != null ? String(prod.last_price) : '',
    } : EMPTY_PROD)
  }

  async function saveProd() {
    if (!user || !editProd || !prodForm.name.trim()) return
    setProdSaving(true)

    if (editProd.prod) {
      await supabase.from('service_category_products').update({
        name: prodForm.name.trim(),
        product_url: prodForm.product_url.trim() || null,
        last_price: prodForm.last_price ? parseFloat(prodForm.last_price) : null,
      }).eq('id', editProd.prod.id)
    } else {
      await supabase.from('service_category_products').insert({
        user_id: user.id,
        category_id: editProd.catId,
        vehicle_id: vehicle.id,
        name: prodForm.name.trim(),
        product_url: prodForm.product_url.trim() || null,
        last_price: prodForm.last_price ? parseFloat(prodForm.last_price) : null,
      })
    }

    setProdSaving(false)
    setEditProd(null)
    await load()
    onUpdated()
  }

  async function deleteProd(id: string) {
    await supabase.from('service_category_products').delete().eq('id', id)
    setDeleteProdId(null)
    await load()
    onUpdated()
  }

  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')
  const repairCatsList = categories.filter(c => c.category_type === 'repair')
  const serviceCats = maintenanceCats.filter(c => c.sub_type !== 'check')
  const checkCats = maintenanceCats.filter(c => c.sub_type === 'check')

  const duplicateGroups = (() => {
    const byName = new Map<string, ServiceCategory[]>()
    for (const cat of maintenanceCats) {
      const key = cat.name.toLowerCase().trim()
      byName.set(key, [...(byName.get(key) ?? []), cat])
    }
    return Array.from(byName.values()).filter(g => g.length > 1)
  })()

  const duplicateIds = new Set(
    duplicateGroups.flatMap(group => {
      const primary = group.find(c => c.interval_miles || c.interval_days) ?? group[0]
      return group.filter(c => c.id !== primary.id).map(c => c.id)
    })
  )

  // ─── Shared category row renderer ────────────────────────────────────────────
  function renderCatRow(cat: ServiceCategory) {
    const catProds = products[cat.id] ?? []
    const isOpen = expanded[cat.id]
    const isEditing = editCat?.id === cat.id
    const noInterval = !cat.interval_miles && !cat.interval_days && cat.category_type === 'maintenance'
    const isDuplicate = duplicateIds.has(cat.id)

    return (
      <div key={cat.id} className={`border rounded-2xl overflow-hidden ${isDuplicate ? 'bg-danger/5 border-danger/20 opacity-70' : noInterval ? 'bg-accent/5 border-accent/25' : 'bg-surface-2/50 border-border-strong/60'}`}>
        {isEditing ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium text-foreground">Edit Category</p>
              {renameWarn && <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-lg">Renaming updates all past records</span>}
            </div>
            <input
              type="text"
              placeholder="Category name"
              value={catForm.name}
              onChange={e => { setCatForm(f => ({ ...f, name: e.target.value })); if (e.target.value.trim() !== cat.name) setRenameWarn(true); else setRenameWarn(false) }}
              className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
            />
            {cat.category_type === 'maintenance' && (
              <div>
                <label className="block text-xs text-muted mb-1.5">Sub-type</label>
                <div className="flex gap-2">
                  {(['service', 'check'] as const).map(st => (
                    <button key={st} type="button" onClick={() => setCatForm(f => ({ ...f, sub_type: st }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors border ${catForm.sub_type === st ? 'bg-accent/20 text-accent border-accent/40' : 'bg-surface-2 text-muted border-border-strong'}`}>
                      {st === 'service' ? 'Service' : 'Check'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted mb-1">Every X miles</label>
                <input type="number" placeholder="e.g. 5000" value={catForm.interval_miles} onChange={e => setCatForm(f => ({ ...f, interval_miles: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Every X days</label>
                <input type="number" placeholder="e.g. 180" value={catForm.interval_days} onChange={e => setCatForm(f => ({ ...f, interval_days: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setEditCat(null); setRenameWarn(false) }} className="flex-1 bg-surface-2 hover:bg-faint text-foreground text-sm font-medium rounded-xl py-2 transition-colors">Cancel</button>
              <button onClick={saveCat} disabled={catSaving || !catForm.name.trim()} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-bold rounded-xl py-2 transition-colors">{catSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center p-4 gap-3">
              <button onClick={() => setExpanded(e => ({ ...e, [cat.id]: !e[cat.id] }))} className="text-muted hover:text-foreground transition-colors">
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-foreground text-sm">{cat.name}</p>
                  {isDuplicate && <span className="text-xs font-semibold px-1.5 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/25 shrink-0">Duplicate</span>}
                  {!isDuplicate && noInterval && <span className="text-xs font-semibold px-1.5 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/25 shrink-0">No interval</span>}
                </div>
                <p className="text-muted text-xs mt-0.5">
                  {[cat.interval_miles ? `${cat.interval_miles.toLocaleString()} mi` : null, cat.interval_days ? `${Math.round(cat.interval_days / 30)} mo` : null].filter(Boolean).join(' / ') || (cat.category_type === 'maintenance' ? 'Won\'t appear on dashboard' : 'As needed')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEditCat(cat)} className="w-7 h-7 rounded-lg bg-surface-2/60 flex items-center justify-center text-muted hover:text-foreground transition-colors"><Pencil size={12} /></button>
                <button onClick={() => { setDeleteCatId(cat.id); setDeleteConfirm(false) }} className="w-7 h-7 rounded-lg bg-surface-2/60 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
              </div>
            </div>

            {noInterval && !isOpen && (
              <div className="border-t border-accent/20 px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle size={12} className="text-accent shrink-0" />
                  <p className="text-accent/80 text-xs">Intentionally no schedule?</p>
                </div>
                <button onClick={() => openEditCat(cat)} className="text-accent text-xs font-semibold hover:text-accent transition-colors shrink-0">Set interval →</button>
              </div>
            )}

            {isOpen && (
              <div className="border-t border-border-strong/50 px-4 pb-4 pt-3 space-y-2">
                <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Products / Parts ({catProds.length})</p>
                {catProds.map(p =>
                  editProd?.prod?.id === p.id ? (
                    <div key={p.id} className="bg-surface-2/40 rounded-xl p-3 space-y-2">
                      <input type="text" placeholder="Product name" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                      <input type="url" placeholder="Product URL (optional)" value={prodForm.product_url} onChange={e => setProdForm(f => ({ ...f, product_url: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                      <input type="number" placeholder="Last price $" value={prodForm.last_price} onChange={e => setProdForm(f => ({ ...f, last_price: e.target.value }))} min="0" step="0.01" className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                      <div className="flex gap-2">
                        <button onClick={() => setEditProd(null)} className="flex-1 bg-surface-2 text-foreground text-xs font-medium rounded-lg py-2 hover:bg-faint transition-colors">Cancel</button>
                        <button onClick={saveProd} disabled={prodSaving} className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg py-2 disabled:opacity-40 transition-colors">{prodSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : (
                    <div key={p.id} className="flex items-center gap-3 bg-surface-2/30 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-foreground text-sm truncate">{p.name}</p>
                          {p.product_url && <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent"><ExternalLink size={12} /></a>}
                        </div>
                        {p.last_price != null && <p className="text-accent text-xs font-medium">${Number(p.last_price).toFixed(2)}</p>}
                      </div>
                      <button onClick={() => openEditProd(cat.id, p)} className="w-6 h-6 rounded-md bg-faint/60 flex items-center justify-center text-muted hover:text-foreground"><Pencil size={11} /></button>
                      <button onClick={() => setDeleteProdId(p.id)} className="w-6 h-6 rounded-md bg-faint/60 flex items-center justify-center text-muted hover:text-danger"><Trash2 size={11} /></button>
                    </div>
                  )
                )}

                {editProd?.catId === cat.id && !editProd.prod ? (
                  <div className="bg-surface-2/40 rounded-xl p-3 space-y-2">
                    <input type="text" placeholder="Product name" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                    <input type="url" placeholder="Product URL (optional)" value={prodForm.product_url} onChange={e => setProdForm(f => ({ ...f, product_url: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                    <input type="number" placeholder="Last price $" value={prodForm.last_price} onChange={e => setProdForm(f => ({ ...f, last_price: e.target.value }))} min="0" step="0.01" className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                    <div className="flex gap-2">
                      <button onClick={() => setEditProd(null)} className="flex-1 bg-surface-2 text-foreground text-xs font-medium rounded-lg py-2 hover:bg-faint transition-colors">Cancel</button>
                      <button onClick={saveProd} disabled={prodSaving || !prodForm.name.trim()} className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg py-2 disabled:opacity-40 transition-colors">{prodSaving ? 'Saving…' : 'Add'}</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => openEditProd(cat.id, null)} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors py-1">
                    <Plus size={12} /> Add Product
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h3 className="font-bold text-foreground text-lg">Manage Categories</h3>
            <p className="text-muted text-sm">Maintenance intervals & products</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {duplicateGroups.length > 0 && !loading && (
            <div className="bg-accent/8 border border-accent/30 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <AlertCircle size={13} className="text-accent shrink-0" />
                  <p className="text-accent text-sm font-semibold">{duplicateGroups.length} duplicate {duplicateGroups.length === 1 ? 'category' : 'categories'} found</p>
                </div>
                <p className="text-muted text-xs truncate">{duplicateGroups.map(g => g[0].name).join(', ')}</p>
                <p className="text-faint text-xs mt-0.5">Merging keeps the one with an interval set and re-links all records.</p>
              </div>
              <button onClick={mergeAllDuplicates} disabled={merging} className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-bold text-xs rounded-xl px-3 py-2 transition-colors shrink-0">
                {merging ? 'Merging…' : 'Merge All'}
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Service section */}
          {!loading && serviceCats.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint mb-2 px-1">Service</p>
              <div className="space-y-2">{serviceCats.map(cat => renderCatRow(cat))}</div>
            </div>
          )}

          {/* Checks section */}
          {!loading && checkCats.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint mb-2 px-1 mt-4">Checks</p>
              <div className="space-y-2">{checkCats.map(cat => renderCatRow(cat))}</div>
            </div>
          )}

          {/* Repair section */}
          {!loading && repairCatsList.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint mb-2 px-1 mt-4">Repair</p>
              <div className="space-y-2">{repairCatsList.map(cat => renderCatRow(cat))}</div>
            </div>
          )}

          {/* New category form */}
          {newCat && (
            <div className="bg-surface-2/50 border border-accent/30 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">New Category</p>

              {/* Type toggle */}
              <div>
                <label className="block text-xs text-muted mb-1.5">Category type</label>
                <div className="flex gap-2">
                  {(['maintenance', 'repair'] as const).map(ct => (
                    <button key={ct} type="button" onClick={() => setCatForm(f => ({ ...f, category_type: ct }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize transition-colors border ${catForm.category_type === ct ? ct === 'maintenance' ? 'bg-accent/20 text-accent border-accent/40' : 'bg-warn/20 text-warn border-warn/40' : 'bg-surface-2 text-muted border-border-strong'}`}>
                      {ct}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-type toggle (maintenance only) */}
              {catForm.category_type === 'maintenance' && (
                <div>
                  <label className="block text-xs text-muted mb-1.5">Sub-type</label>
                  <div className="flex gap-2">
                    {(['service', 'check'] as const).map(st => (
                      <button key={st} type="button" onClick={() => setCatForm(f => ({ ...f, sub_type: st }))}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors border ${catForm.sub_type === st ? 'bg-accent/20 text-accent border-accent/40' : 'bg-surface-2 text-muted border-border-strong'}`}>
                        {st === 'service' ? 'Service' : 'Check'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <input
                type="text"
                placeholder={catForm.category_type === 'maintenance' ? 'Category name (e.g. Coolant Flush)' : 'Repair type (e.g. Strut replacement)'}
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted mb-1">Every X miles</label>
                  <input type="number" placeholder="e.g. 30000" value={catForm.interval_miles} onChange={e => setCatForm(f => ({ ...f, interval_miles: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Every X days</label>
                  <input type="number" placeholder="e.g. 365" value={catForm.interval_days} onChange={e => setCatForm(f => ({ ...f, interval_days: e.target.value }))} className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setNewCat(false)} className="flex-1 bg-surface-2 hover:bg-faint text-foreground text-sm font-medium rounded-xl py-2 transition-colors">Cancel</button>
                <button onClick={saveCat} disabled={catSaving || !catForm.name.trim()} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-bold rounded-xl py-2 transition-colors">{catSaving ? 'Saving…' : 'Add Category'}</button>
              </div>
            </div>
          )}

          {!newCat && !loading && (
            <button onClick={openNewCat} className="flex items-center gap-2 w-full border-2 border-dashed border-border-strong hover:border-accent/40 rounded-2xl px-4 py-3 text-muted hover:text-accent text-sm font-medium transition-colors">
              <Plus size={16} /> Add Category
            </button>
          )}
        </div>
      </div>

      {/* Delete category confirm */}
      {deleteCatId && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-xs">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-danger" />
              </div>
              <div>
                <p className="font-bold text-foreground">Delete category?</p>
                <p className="text-muted text-sm mt-1">Existing service records <span className="text-foreground">won&apos;t be deleted</span>, but they will lose their category link.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteCatId(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 bg-danger hover:bg-danger text-white font-bold rounded-2xl py-3 transition-colors disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete product confirm */}
      {deleteProdId && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-foreground mb-2">Remove this product?</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setDeleteProdId(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={() => deleteProd(deleteProdId)} className="flex-1 bg-danger hover:bg-danger text-white font-bold rounded-2xl py-3 transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
