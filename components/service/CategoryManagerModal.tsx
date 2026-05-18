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

const EMPTY_CAT = { name: '', interval_miles: '', interval_days: '' }
const EMPTY_PROD = { name: '', product_url: '', last_price: '' }

export default function CategoryManagerModal({ vehicle, onClose, onUpdated }: Props) {
  const { user } = useAuth()
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [products, setProducts] = useState<Record<string, ServiceCategoryProduct[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  // Edit/Add category state
  const [editCat, setEditCat] = useState<ServiceCategory | null>(null)
  const [newCat, setNewCat] = useState(false)
  const [catForm, setCatForm] = useState(EMPTY_CAT)
  const [catSaving, setCatSaving] = useState(false)
  const [renameWarn, setRenameWarn] = useState(false)

  // Delete category state
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Product state
  const [editProd, setEditProd] = useState<{ catId: string; prod: ServiceCategoryProduct | null } | null>(null)
  const [prodForm, setProdForm] = useState(EMPTY_PROD)
  const [prodSaving, setProdSaving] = useState(false)
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
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
    setLoading(false)
  }, [vehicle.id])

  useEffect(() => { load() }, [load])

  function openEditCat(cat: ServiceCategory) {
    setEditCat(cat)
    setNewCat(false)
    setCatForm({
      name: cat.name,
      interval_miles: cat.interval_miles != null ? String(cat.interval_miles) : '',
      interval_days: cat.interval_days != null ? String(cat.interval_days) : '',
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
        category_type: 'maintenance',
        interval_miles: catForm.interval_miles ? parseInt(catForm.interval_miles) : null,
        interval_days: catForm.interval_days ? parseInt(catForm.interval_days) : null,
      })
    } else if (editCat) {
      const nameChanged = catForm.name.trim() !== editCat.name
      await supabase.from('service_categories').update({
        name: catForm.name.trim(),
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

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
          <div>
            <h3 className="font-bold text-zinc-100 text-lg">Manage Categories</h3>
            <p className="text-zinc-500 text-sm">Maintenance intervals & products</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && maintenanceCats.map(cat => {
            const catProds = products[cat.id] ?? []
            const isOpen = expanded[cat.id]
            const isEditing = editCat?.id === cat.id

            return (
              <div key={cat.id} className="bg-zinc-800/50 border border-zinc-700/60 rounded-2xl overflow-hidden">
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-zinc-300">Edit Category</p>
                      {renameWarn && (
                        <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg">
                          Renaming updates all past records
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Category name"
                      value={catForm.name}
                      onChange={e => {
                        setCatForm(f => ({ ...f, name: e.target.value }))
                        if (e.target.value.trim() !== cat.name) setRenameWarn(true)
                        else setRenameWarn(false)
                      }}
                      className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Every X miles</label>
                        <input
                          type="number"
                          placeholder="e.g. 5000"
                          value={catForm.interval_miles}
                          onChange={e => setCatForm(f => ({ ...f, interval_miles: e.target.value }))}
                          className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Every X days</label>
                        <input
                          type="number"
                          placeholder="e.g. 180"
                          value={catForm.interval_days}
                          onChange={e => setCatForm(f => ({ ...f, interval_days: e.target.value }))}
                          className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditCat(null); setRenameWarn(false) }}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium rounded-xl py-2 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveCat}
                        disabled={catSaving || !catForm.name.trim()}
                        className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 text-sm font-bold rounded-xl py-2 transition-colors"
                      >
                        {catSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center p-4 gap-3">
                      <button
                        onClick={() => setExpanded(e => ({ ...e, [cat.id]: !e[cat.id] }))}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-zinc-100 text-sm">{cat.name}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">
                          {[
                            cat.interval_miles ? `${cat.interval_miles.toLocaleString()} mi` : null,
                            cat.interval_days ? `${Math.round(cat.interval_days / 30)} mo` : null,
                          ].filter(Boolean).join(' / ') || 'No interval set'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditCat(cat)}
                          className="w-7 h-7 rounded-lg bg-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => { setDeleteCatId(cat.id); setDeleteConfirm(false) }}
                          className="w-7 h-7 rounded-lg bg-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-zinc-700/50 px-4 pb-4 pt-3 space-y-2">
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                          Products / Parts ({catProds.length})
                        </p>
                        {catProds.map(p => (
                          editProd?.prod?.id === p.id ? (
                            <div key={p.id} className="bg-zinc-700/40 rounded-xl p-3 space-y-2">
                              <input
                                type="text"
                                placeholder="Product name"
                                value={prodForm.name}
                                onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))}
                                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                              />
                              <input
                                type="url"
                                placeholder="Product URL (optional)"
                                value={prodForm.product_url}
                                onChange={e => setProdForm(f => ({ ...f, product_url: e.target.value }))}
                                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                              />
                              <input
                                type="number"
                                placeholder="Last price $"
                                value={prodForm.last_price}
                                onChange={e => setProdForm(f => ({ ...f, last_price: e.target.value }))}
                                min="0" step="0.01"
                                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                              />
                              <div className="flex gap-2">
                                <button onClick={() => setEditProd(null)} className="flex-1 bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg py-2 hover:bg-zinc-600 transition-colors">Cancel</button>
                                <button onClick={saveProd} disabled={prodSaving} className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-lg py-2 disabled:opacity-40 transition-colors">{prodSaving ? 'Saving…' : 'Save'}</button>
                              </div>
                            </div>
                          ) : (
                            <div key={p.id} className="flex items-center gap-3 bg-zinc-700/30 rounded-xl px-3 py-2.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-zinc-200 text-sm truncate">{p.name}</p>
                                  {p.product_url && (
                                    <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400">
                                      <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>
                                {p.last_price != null && (
                                  <p className="text-amber-400 text-xs font-medium">${Number(p.last_price).toFixed(2)}</p>
                                )}
                              </div>
                              <button onClick={() => openEditProd(cat.id, p)} className="w-6 h-6 rounded-md bg-zinc-600/60 flex items-center justify-center text-zinc-400 hover:text-zinc-200"><Pencil size={11} /></button>
                              <button onClick={() => setDeleteProdId(p.id)} className="w-6 h-6 rounded-md bg-zinc-600/60 flex items-center justify-center text-zinc-400 hover:text-red-400"><Trash2 size={11} /></button>
                            </div>
                          )
                        ))}

                        {editProd?.catId === cat.id && !editProd.prod ? (
                          <div className="bg-zinc-700/40 rounded-xl p-3 space-y-2">
                            <input type="text" placeholder="Product name" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all" />
                            <input type="url" placeholder="Product URL (optional)" value={prodForm.product_url} onChange={e => setProdForm(f => ({ ...f, product_url: e.target.value }))} className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all" />
                            <input type="number" placeholder="Last price $" value={prodForm.last_price} onChange={e => setProdForm(f => ({ ...f, last_price: e.target.value }))} min="0" step="0.01" className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all" />
                            <div className="flex gap-2">
                              <button onClick={() => setEditProd(null)} className="flex-1 bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg py-2 hover:bg-zinc-600 transition-colors">Cancel</button>
                              <button onClick={saveProd} disabled={prodSaving || !prodForm.name.trim()} className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-lg py-2 disabled:opacity-40 transition-colors">{prodSaving ? 'Saving…' : 'Add'}</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => openEditProd(cat.id, null)}
                            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
                          >
                            <Plus size={12} /> Add Product
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {/* New category form */}
          {newCat && (
            <div className="bg-zinc-800/50 border border-amber-500/30 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-medium text-zinc-300">New Maintenance Category</p>
              <input
                type="text"
                placeholder="Category name (e.g. Coolant Flush)"
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Every X miles</label>
                  <input type="number" placeholder="e.g. 30000" value={catForm.interval_miles} onChange={e => setCatForm(f => ({ ...f, interval_miles: e.target.value }))} className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Every X days</label>
                  <input type="number" placeholder="e.g. 365" value={catForm.interval_days} onChange={e => setCatForm(f => ({ ...f, interval_days: e.target.value }))} className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setNewCat(false)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium rounded-xl py-2 transition-colors">Cancel</button>
                <button onClick={saveCat} disabled={catSaving || !catForm.name.trim()} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 text-sm font-bold rounded-xl py-2 transition-colors">{catSaving ? 'Saving…' : 'Add Category'}</button>
              </div>
            </div>
          )}

          {!newCat && !loading && (
            <button
              onClick={openNewCat}
              className="flex items-center gap-2 w-full border-2 border-dashed border-zinc-700 hover:border-amber-500/40 rounded-2xl px-4 py-3 text-zinc-500 hover:text-amber-500 text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Add Maintenance Category
            </button>
          )}
        </div>
      </div>

      {/* Delete category confirm */}
      {deleteCatId && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-xs">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-red-400" />
              </div>
              <div>
                <p className="font-bold text-zinc-100">Delete category?</p>
                <p className="text-zinc-400 text-sm mt-1">
                  Existing service records <span className="text-zinc-200">won&apos;t be deleted</span>, but they will lose their category link. You can re-assign them manually.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteCatId(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-2xl py-3 transition-colors disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete product confirm */}
      {deleteProdId && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-zinc-100 mb-2">Remove this product?</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setDeleteProdId(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={() => deleteProd(deleteProdId)} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-2xl py-3 transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
