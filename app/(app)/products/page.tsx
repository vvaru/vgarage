'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, Pencil, Trash2, X, Package, Link as LinkIcon, Tag, SlidersHorizontal, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import InventoryTab from '@/components/inventory/InventoryTab'
import { UNIT_GROUPS, guessUnit, fmtQty } from '@/lib/units'
import { findType, guessProductType, type ProductType } from '@/lib/productTypes'
import type { Product, ProductLink, ServiceCategory } from '@/lib/types'

interface ProductWithLinks extends Product {
  links: ProductLink[]
  categoryIds: string[]
}

interface LinkDraft { label: string; url: string }

const EMPTY_FORM = {
  name: '',
  brand: '',
  typeName: '',        // what it IS; free text so a new type can be named inline
  unit: '',            // blank = follow the name-based guess until edited by hand
  notes: '',
  categoryIds: [] as string[],
  links: [{ label: 'Buy', url: '' }] as LinkDraft[],
}

export default function ProductsPage() {
  const { user } = useAuth()
  const { vehicle } = useVehicle()

  const [tab, setTab] = useState<'inventory' | 'catalog'>('inventory')
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
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [assigning, setAssigning] = useState<string | null>(null)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!vehicle || !user) return
    setLoading(true)
    try {
      const [{ data: prods }, { data: links }, { data: catLinks }, { data: cats }] = await Promise.all([
        // Garage-wide: products bought on a receipt are created with vehicle_id
        // NULL, so scoping this to the vehicle hid them from the catalog entirely.
        supabase.from('products').select('*').eq('user_id', user!.id).order('name'),
        supabase.from('product_links').select('*'),
        supabase.from('product_category_links').select('*'),
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).order('name'),
      ])
      // Types are optional until the SQL is run — stay quiet if the table is absent.
      const typesQ = await supabase.from('product_types').select('*').eq('user_id', user.id).order('name')
      setProductTypes((typesQ.data ?? []) as ProductType[])
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
  }, [vehicle, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      typeName: productTypes.find(t => t.id === p.product_type_id)?.name ?? '',
      unit: (p as ProductWithLinks & { unit?: string }).unit ?? '',
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

    // Resolve the typed name to a type row, creating it if it's a new one.
    let typeId: string | null = null
    const wantedType = form.typeName.trim()
    if (wantedType) {
      const existing = findType(productTypes, wantedType)
      if (existing) {
        typeId = existing.id
      } else {
        const { data } = await supabase.from('product_types')
          .insert({ user_id: user.id, name: wantedType }).select('id').single()
        typeId = data?.id ?? null
      }
    }

    const payload = {
      user_id: user.id,
      vehicle_id: null,     // garage-wide, matching the inventory model
      product_type_id: typeId,
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      unit: form.unit.trim() || guessUnit(form.name),
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

  // One flat grid ordered by type, rather than a headed section per type: with
  // mostly one model per type, the headings cost more space than they earn.
  // The type leads each card instead.
  const typeNameOf = (p: ProductWithLinks) =>
    productTypes.find(t => t.id === p.product_type_id)?.name ?? ''
  const sortedProducts = [...visible].sort((a, b) => {
    const ta = typeNameOf(a), tb = typeNameOf(b)
    // Unclassified last — they're the ones needing attention, not the headline.
    if (!ta !== !tb) return ta ? -1 : 1
    return (ta || a.name).localeCompare(tb || b.name) || a.name.localeCompare(b.name)
  })

  // Assign a type to a product, creating the type if it's new.
  async function applyType(product: ProductWithLinks, typeName: string) {
    if (!user || !typeName.trim()) return
    setAssigning(product.id)
    try {
      let type = findType(productTypes, typeName)
      if (!type) {
        const { data } = await supabase.from('product_types')
          .insert({ user_id: user.id, name: typeName.trim() }).select('*').single()
        if (!data) return
        type = data as ProductType
      }
      await supabase.from('products').update({ product_type_id: type.id }).eq('id', product.id)
      // Carry the product's category tags up to the type — services link to types.
      for (const catId of product.categoryIds) {
        await supabase.from('product_type_category_links')
          .upsert({ product_type_id: type.id, category_id: catId })
      }
      await load()
    } finally {
      setAssigning(null)
    }
  }

  const activeFilterName = categoryFilter ? categories.find(c => c.id === categoryFilter)?.name : null

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-10 lg:pt-8 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Parts & Inventory</h1>
          <div className="flex items-center gap-2">
            {/* Filter button */}
            {tab === 'catalog' && categories.length > 0 && (
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

            {tab === 'catalog' && (
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl px-4 py-2 text-sm transition-colors shadow-lg shadow-accent/20"
              >
                <Plus size={15} /> Add
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-4">
          {(['inventory', 'catalog'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
                tab === t ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'inventory' && (
        <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-4 pb-28 lg:pb-12">
          <InventoryTab onEditProduct={id => {
            const p = products.find(x => x.id === id)
            if (!p) return
            setTab('catalog')
            openEdit(p)
          }} />
        </div>
      )}

      {/* Product grid (Catalog) */}
      {tab === 'catalog' && (
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
            {sortedProducts.map(p => {
              const typeName = productTypes.find(t => t.id === p.product_type_id)?.name ?? null
              // Type leads, model and brand explain which one — same order the
              // receipt titles use, so a product reads the same wherever it appears.
              const subtitle = [p.name, p.brand].filter(Boolean).join(' · ')
              return (
              <div key={p.id} className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-3">
                {/* Top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-base leading-tight truncate">{typeName ?? p.name}</p>
                    <p className="text-muted text-sm mt-0.5 truncate">{typeName ? subtitle : (p.brand ?? '')}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(p)} className="w-7 h-7 rounded-lg bg-surface-2 hover:bg-surface-2 flex items-center justify-center text-muted hover:text-foreground transition-colors"><Pencil size={12} /></button>
                    <button onClick={() => setDeleteId(p.id)} className="w-7 h-7 rounded-lg bg-surface-2 hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
                  </div>
                </div>

                {/* Untyped: offer the guess inline rather than making them dig */}
                {!p.product_type_id && (() => {
                  const guess = guessProductType(p.name, p.categoryIds.map(categoryName))
                  return guess.name ? (
                    <button onClick={() => applyType(p, guess.name!)} disabled={assigning === p.id}
                      className="self-start bg-accent/10 text-accent border border-accent/20 rounded-lg px-2 py-1 text-xs font-medium hover:bg-accent/20 disabled:opacity-50 transition-colors">
                      {assigning === p.id ? 'Setting…' : `Looks like ${guess.name} — set it`}
                    </button>
                  ) : (
                    <button onClick={() => openEdit(p)}
                      className="self-start bg-warn/10 text-warn border border-warn/20 rounded-lg px-2 py-1 text-xs font-medium hover:bg-warn/20 transition-colors">
                      Set a product type
                    </button>
                  )
                })()}

                {/* Products created from a receipt arrive bare — make that findable */}
                {p.product_type_id && p.categoryIds.length === 0 && p.links.length === 0 && (
                  <button onClick={() => openEdit(p)}
                    className="self-start bg-warn/10 text-warn border border-warn/20 rounded-lg px-2 py-0.5 text-xs font-medium hover:bg-warn/20 transition-colors">
                    Add details
                  </button>
                )}

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
              )
            })}
          </div>
        )}
      </div>
      )}

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

              {/* Product type — what it IS, above this specific model */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Product type</label>
                <input
                  type="text"
                  list="product-type-options"
                  placeholder="e.g. Transmission Fluid"
                  value={form.typeName}
                  onChange={e => patchForm({ typeName: e.target.value })}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all"
                />
                <datalist id="product-type-options">
                  {productTypes.map(t => <option key={t.id} value={t.name} />)}
                </datalist>
                <p className="text-faint text-xs mt-1.5">
                  What it is, not which one — “{form.name.trim() || 'HCF2'}” is the model, “Transmission Fluid” is the type.
                  Receipts and services are named by the type.
                </p>
              </div>

              {/* Unit — how inventory counts this thing */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Counted in</label>
                <select
                  value={form.unit || guessUnit(form.name)}
                  onChange={e => patchForm({ unit: e.target.value })}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all"
                >
                  {UNIT_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.units.map(u => <option key={u} value={u}>{u === 'each' ? 'each (just a count)' : u}</option>)}
                    </optgroup>
                  ))}
                </select>
                <p className="text-faint text-xs mt-1.5">
                  Inventory will read “{fmtQty(3, form.unit || guessUnit(form.name))} left”.
                </p>
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
