'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, Pencil, Trash2, X, Package, Link as LinkIcon, Tag, SlidersHorizontal, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { Product, ProductLink, ServiceCategory } from '@/lib/types'

interface ProductWithLinks extends Product {
  links: ProductLink[]
  categoryIds: string[]
}

interface LinkDraft { label: string; url: string }

const EMPTY_FORM = {
  name: '',
  brand: '',
  notes: '',
  categoryIds: [] as string[],
  links: [{ label: 'Buy', url: '' }] as LinkDraft[],
}

export default function ProductsPage() {
  const { user } = useAuth()
  const { vehicle } = useVehicle()

  const [products, setProducts] = useState<ProductWithLinks[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [showFilterPopup, setShowFilterPopup] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState<ProductWithLinks | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [hasEdited, setHasEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    try {
      const [{ data: prods }, { data: links }, { data: catLinks }, { data: cats }] = await Promise.all([
        supabase.from('products').select('*').eq('vehicle_id', vehicle.id).order('name'),
        supabase.from('product_links').select('*'),
        supabase.from('product_category_links').select('*'),
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).order('name'),
      ])
      const combined: ProductWithLinks[] = (prods ?? []).map(p => ({
        ...p,
        links: (links ?? []).filter(l => l.product_id === p.id),
        categoryIds: (catLinks ?? []).filter(cl => cl.product_id === p.id).map(cl => cl.category_id),
      }))
      setProducts(combined)
      setCategories(cats ?? [])
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  // Close filter popup on outside click
  useEffect(() => {
    if (!showFilterPopup) return
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterPopup(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showFilterPopup])

  // Close category dropdown on outside click
  useEffect(() => {
    if (!showCategoryDropdown) return
    function onDown(e: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showCategoryDropdown])

  function openAdd() {
    setEditProduct(null)
    setForm(EMPTY_FORM)
    setHasEdited(false)
    setShowModal(true)
  }

  function openEdit(p: ProductWithLinks) {
    setEditProduct(p)
    setForm({
      name: p.name,
      brand: p.brand ?? '',
      notes: p.notes ?? '',
      categoryIds: p.categoryIds,
      links: p.links.length > 0
        ? p.links.map(l => ({ label: l.label, url: l.url }))
        : [{ label: 'Buy', url: '' }],
    })
    setHasEdited(false)
    setShowModal(true)
  }

  function tryCloseModal() {
    if (hasEdited) {
      if (!confirm('Discard unsaved changes?')) return
    }
    setShowModal(false)
  }

  function patchForm<K extends keyof typeof EMPTY_FORM>(patch: Partial<typeof EMPTY_FORM>) {
    setForm(f => ({ ...f, ...patch }))
    setHasEdited(true)
  }

  async function handleSave() {
    if (!user || !vehicle) return
    setSaving(true)

    const payload = {
      user_id: user.id,
      vehicle_id: vehicle.id,
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      notes: form.notes.trim() || null,
    }

    let productId: string
    if (editProduct) {
      await supabase.from('products').update(payload).eq('id', editProduct.id)
      productId = editProduct.id
      await supabase.from('product_links').delete().eq('product_id', productId)
      await supabase.from('product_category_links').delete().eq('product_id', productId)
    } else {
      const { data } = await supabase.from('products').insert(payload).select('id').single()
      productId = data!.id
    }

    const validLinks = form.links.filter(l => l.url.trim())
    if (validLinks.length > 0) {
      await supabase.from('product_links').insert(
        validLinks.map(l => ({ product_id: productId, label: l.label.trim() || 'Buy', url: l.url.trim() }))
      )
    }
    if (form.categoryIds.length > 0) {
      await supabase.from('product_category_links').insert(
        form.categoryIds.map(catId => ({ product_id: productId, category_id: catId }))
      )
    }

    setSaving(false)
    setShowModal(false)
    load()
  }

  async function handleDelete(id: string) {
    await supabase.from('products').delete().eq('id', id)
    setDeleteId(null)
    load()
  }

  function toggleCategory(catId: string) {
    const next = form.categoryIds.includes(catId)
      ? form.categoryIds.filter(id => id !== catId)
      : [...form.categoryIds, catId]
    patchForm({ categoryIds: next })
  }

  function updateLink(i: number, patch: Partial<LinkDraft>) {
    const links = [...form.links]
    links[i] = { ...links[i], ...patch }
    patchForm({ links })
  }

  const visible = categoryFilter
    ? products.filter(p => p.categoryIds.includes(categoryFilter))
    : products

  const categoryName = (id: string) => categories.find(c => c.id === id)?.name ?? id

  const activeFilterName = categoryFilter ? categories.find(c => c.id === categoryFilter)?.name : null

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-10 lg:pt-8 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Parts & Products</h1>
          <div className="flex items-center gap-2">
            {/* Filter button */}
            {categories.length > 0 && (
              <div ref={filterRef} className="relative">
                <button
                  onClick={() => setShowFilterPopup(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    categoryFilter
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-surface text-muted border-border hover:border-border-strong'
                  }`}
                >
                  <SlidersHorizontal size={13} />
                  {activeFilterName ?? 'Filter'}
                </button>

                {showFilterPopup && (
                  <div className="absolute right-0 top-full mt-2 bg-surface border border-border rounded-2xl shadow-xl z-30 w-52 py-2 overflow-hidden">
                    <button
                      onClick={() => { setCategoryFilter(null); setShowFilterPopup(false) }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-surface-2 ${
                        !categoryFilter ? 'text-accent' : 'text-muted'
                      }`}
                    >
                      All products
                      {!categoryFilter && <Check size={14} />}
                    </button>
                    <div className="border-t border-border my-1" />
                    {categories.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => { setCategoryFilter(categoryFilter === cat.id ? null : cat.id); setShowFilterPopup(false) }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-surface-2 ${
                          categoryFilter === cat.id ? 'text-accent' : 'text-muted'
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        {categoryFilter === cat.id && <Check size={14} className="shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl px-4 py-2 text-sm transition-colors shadow-lg shadow-accent/20"
            >
              <Plus size={15} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Product grid */}
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-4 pb-28 lg:pb-12">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20">
            <Package size={44} className="text-faint mx-auto mb-4" />
            <p className="text-muted font-medium text-lg">{categoryFilter ? 'No products in this category' : 'No products yet'}</p>
            <p className="text-faint text-sm mt-1">Add parts and products you use for your car</p>
            {!categoryFilter && (
              <button onClick={openAdd} className="mt-5 text-accent text-sm font-medium hover:text-accent transition-colors">Add first product →</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visible.map(p => (
              <div key={p.id} className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-3">
                {/* Top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-base leading-tight truncate">{p.name}</p>
                    {p.brand && <p className="text-muted text-sm mt-0.5">{p.brand}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(p)} className="w-7 h-7 rounded-lg bg-surface-2 hover:bg-surface-2 flex items-center justify-center text-muted hover:text-foreground transition-colors"><Pencil size={12} /></button>
                    <button onClick={() => setDeleteId(p.id)} className="w-7 h-7 rounded-lg bg-surface-2 hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
                  </div>
                </div>

                {/* Category tags */}
                {p.categoryIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.categoryIds.map(catId => (
                      <span key={catId} className="flex items-center gap-1 bg-accent/10 text-accent border border-accent/20 rounded-lg px-2 py-0.5 text-xs font-medium">
                        <Tag size={9} />{categoryName(catId)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {p.notes && <p className="text-muted text-xs line-clamp-2">{p.notes}</p>}

                {/* Buy links */}
                {p.links.length > 0 && (
                  <div className="flex flex-col gap-2 mt-auto pt-1">
                    {p.links.map(l => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl py-2 text-sm transition-colors"
                      >
                        <ExternalLink size={13} />{l.label}
                      </a>
                    ))}
                  </div>
                )}

                {p.links.length === 0 && (
                  <p className="text-faint text-xs mt-auto pt-1">No buy links</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) tryCloseModal() }}
        >
          <div className="bg-surface border border-border rounded-3xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
              <h3 className="font-bold text-foreground text-lg">{editProduct ? 'Edit Product' : 'Add Product'}</h3>
              <button onClick={tryCloseModal} className="text-muted hover:text-foreground"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Product Name</label>
                <input
                  type="text"
                  placeholder="e.g. Mobil 1 Full Synthetic 0W-20"
                  value={form.name}
                  onChange={e => patchForm({ name: e.target.value })}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>

              {/* Brand */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Brand / Company</label>
                <input
                  type="text"
                  placeholder="e.g. Mobil 1"
                  value={form.brand}
                  onChange={e => patchForm({ brand: e.target.value })}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Notes (optional)</label>
                <textarea
                  placeholder="Specs, part number, compatibility notes…"
                  value={form.notes}
                  onChange={e => patchForm({ notes: e.target.value })}
                  rows={2}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all resize-none"
                />
              </div>

              {/* Category links — compact dropdown */}
              {categories.length > 0 && (
                <div ref={categoryDropdownRef} className="relative">
                  <label className="block text-sm font-medium text-muted mb-1.5">Link to Service Category</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryDropdown(v => !v)}
                    className="w-full flex items-center justify-between bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-left transition-colors hover:border-border-strong"
                  >
                    <span className={form.categoryIds.length > 0 ? 'text-foreground text-sm' : 'text-faint text-sm'}>
                      {form.categoryIds.length === 0
                        ? 'No category linked'
                        : form.categoryIds.map(id => categoryName(id)).join(', ')}
                    </span>
                    <Tag size={14} className="text-muted shrink-0" />
                  </button>

                  {showCategoryDropdown && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-surface border border-border-strong rounded-xl shadow-xl z-20 overflow-hidden max-h-48 overflow-y-auto">
                      {categories.map(cat => {
                        const selected = form.categoryIds.includes(cat.id)
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => toggleCategory(cat.id)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-surface-2"
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              selected ? 'bg-accent border-accent' : 'border-border-strong'
                            }`}>
                              {selected && <Check size={10} className="text-white" />}
                            </span>
                            <span className={selected ? 'text-foreground' : 'text-muted'}>{cat.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Buy links */}
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Buy Links</label>
                <div className="space-y-2">
                  {form.links.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Label"
                        value={l.label}
                        onChange={e => updateLink(i, { label: e.target.value })}
                        className="w-24 bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all text-sm"
                      />
                      <input
                        type="url"
                        placeholder="https://…"
                        value={l.url}
                        onChange={e => updateLink(i, { url: e.target.value })}
                        className="flex-1 bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all text-sm"
                      />
                      {form.links.length > 1 && (
                        <button
                          type="button"
                          onClick={() => patchForm({ links: form.links.filter((_, j) => j !== i) })}
                          className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => patchForm({ links: [...form.links, { label: 'Buy', url: '' }] })}
                  className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors"
                >
                  <LinkIcon size={13} /> Add another link
                </button>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6 pt-2">
              <button onClick={tryCloseModal} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors"
              >
                {saving ? 'Saving…' : editProduct ? 'Update' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteId && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setDeleteId(null) }}
        >
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-foreground mb-2">Delete this product?</p>
            <p className="text-muted text-sm mb-6">This will remove all its buy links too.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 bg-danger hover:bg-danger text-white font-bold rounded-2xl py-3 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
