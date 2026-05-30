'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO, differenceInDays } from 'date-fns'
import {
  ShieldCheck, Users, Car, AlertTriangle, CheckCircle2, Clock, ChevronDown,
  ChevronRight, Pencil, X, Plus, Trash2, RefreshCw, Check,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { UserProfile, Vehicle, ServiceCategory, ServiceLog, GlobalCategory, CategoryRequest } from '@/lib/types'

interface UserRow extends UserProfile {
  vehicles: VehicleRow[]
}

interface VehicleRow extends Vehicle {
  overdueCount: number
  dueSoonCount: number
  totalCategories: number
}

function buildStatus(cats: ServiceCategory[], logs: ServiceLog[], odo: number) {
  let overdue = 0, dueSoon = 0
  for (const cat of cats) {
    if (!cat.interval_miles && !cat.interval_days) continue
    const catLogs = logs.filter(l => l.category_id === cat.id && l.odometer > 0).sort((a, b) => b.odometer - a.odometer)
    const last = catLogs[0]
    const lastOdo = last?.odometer ?? null
    const lastDate = last?.date ?? null
    const nextOdo = lastOdo != null && cat.interval_miles ? lastOdo + cat.interval_miles : cat.interval_miles ? odo + cat.interval_miles : null
    const nextDate = lastDate && cat.interval_days
      ? format(new Date(new Date(lastDate).getTime() + cat.interval_days * 86400000), 'yyyy-MM-dd')
      : cat.interval_days ? format(new Date(Date.now() + cat.interval_days * 86400000), 'yyyy-MM-dd') : null
    const milesLeft = nextOdo != null ? nextOdo - odo : null
    const daysLeft = nextDate ? differenceInDays(parseISO(nextDate), new Date()) : null
    const isOverdue = (milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft < 0)
    const isDueSoon = !isOverdue && ((milesLeft != null && milesLeft <= 500) || (daysLeft != null && daysLeft <= 30))
    if (isOverdue) overdue++
    else if (isDueSoon) dueSoon++
  }
  return { overdue, dueSoon }
}

export default function AdminPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()

  const [users, setUsers] = useState<UserRow[]>([])
  const [globalCats, setGlobalCats] = useState<GlobalCategory[]>([])
  const [requests, setRequests] = useState<CategoryRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [userCategories, setUserCategories] = useState<Record<string, ServiceCategory[]>>({})

  // Tab
  const [tab, setTab] = useState<'users' | 'categories' | 'requests'>('users')

  // Global category modal
  const [showCatModal, setShowCatModal] = useState(false)
  const [editCat, setEditCat] = useState<GlobalCategory | null>(null)
  const [catForm, setCatForm] = useState({ name: '', category_type: 'maintenance', interval_miles: '', interval_days: '' })
  const [savingCat, setSavingCat] = useState(false)

  // Request review modal
  const [reviewRequest, setReviewRequest] = useState<CategoryRequest | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [savingRequest, setSavingRequest] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [
        { data: profiles },
        { data: allVehicles },
        { data: allCats },
        { data: allLogs },
        { data: globalCatData },
        { data: requestData },
      ] = await Promise.all([
        supabase.from('user_profiles').select('*').order('created_at'),
        supabase.from('vehicles').select('*').order('created_at'),
        supabase.from('service_categories').select('*').eq('category_type', 'maintenance'),
        supabase.from('service_logs').select('id,vehicle_id,category_id,date,odometer').order('date', { ascending: false }),
        supabase.from('global_categories').select('*').order('name'),
        supabase.from('category_requests').select('*').order('created_at', { ascending: false }),
      ])

      const vehicles = allVehicles ?? []
      const cats = allCats ?? []
      const logs = allLogs ?? []

      const userRows: UserRow[] = (profiles ?? []).map(p => {
        const uVehicles = vehicles.filter(v => v.user_id === p.id)
        const vehicleRows: VehicleRow[] = uVehicles.map(v => {
          const vCats = cats.filter(c => c.vehicle_id === v.id)
          const vLogs = logs.filter(l => l.vehicle_id === v.id)
          const { overdue, dueSoon } = buildStatus(vCats, vLogs as ServiceLog[], v.odometer)
          return { ...v, overdueCount: overdue, dueSoonCount: dueSoon, totalCategories: vCats.length }
        })
        return { ...p, vehicles: vehicleRows }
      })

      setUsers(userRows)
      setGlobalCats(globalCatData ?? [])
      setRequests(requestData ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard')
  }, [authLoading, isAdmin, router])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  async function changeRole(userId: string, newRole: 'admin' | 'user') {
    await supabase.from('user_profiles').update({ role: newRole }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
  }

  async function expandUser(userId: string) {
    if (expandedUser === userId) { setExpandedUser(null); return }
    setExpandedUser(userId)
    if (!userCategories[userId]) {
      const userVehicles = users.find(u => u.id === userId)?.vehicles ?? []
      const vIds = userVehicles.map(v => v.id)
      if (vIds.length === 0) return
      const { data } = await supabase.from('service_categories').select('*').in('vehicle_id', vIds).order('name')
      setUserCategories(prev => ({ ...prev, [userId]: data ?? [] }))
    }
  }

  async function toggleCategoryVisibility(catId: string, userId: string, currentVisible: boolean) {
    await supabase.from('service_categories').update({ is_visible: !currentVisible }).eq('id', catId)
    setUserCategories(prev => ({
      ...prev,
      [userId]: (prev[userId] ?? []).map(c => c.id === catId ? { ...c, is_visible: !currentVisible } : c),
    }))
  }

  function openAddCat() {
    setEditCat(null)
    setCatForm({ name: '', category_type: 'maintenance', interval_miles: '', interval_days: '' })
    setShowCatModal(true)
  }

  function openEditCat(cat: GlobalCategory) {
    setEditCat(cat)
    setCatForm({
      name: cat.name,
      category_type: cat.category_type,
      interval_miles: cat.interval_miles != null ? String(cat.interval_miles) : '',
      interval_days: cat.interval_days != null ? String(cat.interval_days) : '',
    })
    setShowCatModal(true)
  }

  async function saveCat() {
    setSavingCat(true)
    const payload = {
      name: catForm.name.trim(),
      category_type: catForm.category_type,
      interval_miles: catForm.interval_miles ? parseInt(catForm.interval_miles) : null,
      interval_days: catForm.interval_days ? parseInt(catForm.interval_days) : null,
    }

    if (editCat) {
      await supabase.from('global_categories').update(payload).eq('id', editCat.id)
      // Ask to push to all users
      const push = window.confirm(
        `Push updated intervals to all users who have "${editCat.name}" in their schedule?\n\nThis will overwrite their current interval settings.`
      )
      if (push) {
        await supabase.from('service_categories').update({
          interval_miles: payload.interval_miles,
          interval_days: payload.interval_days,
        }).eq('name', editCat.name)
      }
    } else {
      const { data: newCat } = await supabase
        .from('global_categories')
        .insert({ ...payload, is_active: true })
        .select()
        .single()

      if (newCat) {
        // Add to all users' vehicles
        const { data: allVehicles } = await supabase.from('vehicles').select('id,user_id')
        if (allVehicles && allVehicles.length > 0) {
          await supabase.from('service_categories').insert(
            allVehicles.map(v => ({
              user_id: v.user_id,
              vehicle_id: v.id,
              name: payload.name,
              category_type: payload.category_type,
              interval_miles: payload.interval_miles,
              interval_days: payload.interval_days,
              global_category_id: newCat.id,
              is_visible: true,
            }))
          )
        }
      }
    }

    setSavingCat(false)
    setShowCatModal(false)
    load()
  }

  async function toggleCatActive(cat: GlobalCategory) {
    await supabase.from('global_categories').update({ is_active: !cat.is_active }).eq('id', cat.id)
    setGlobalCats(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !cat.is_active } : c))
  }

  async function handleRequest(req: CategoryRequest, status: 'approved' | 'rejected') {
    setSavingRequest(true)
    await supabase.from('category_requests').update({ status, admin_notes: adminNotes.trim() || null }).eq('id', req.id)
    if (status === 'approved') {
      // Add to global categories and all users
      await saveCatFromRequest(req)
    }
    setReviewRequest(null)
    setAdminNotes('')
    setSavingRequest(false)
    load()
  }

  async function saveCatFromRequest(req: CategoryRequest) {
    const { data: newCat } = await supabase
      .from('global_categories')
      .insert({
        name: req.name,
        category_type: 'maintenance',
        interval_miles: req.interval_miles,
        interval_days: req.interval_days,
        is_active: true,
      })
      .select()
      .single()
    if (newCat) {
      const { data: allVehicles } = await supabase.from('vehicles').select('id,user_id')
      if (allVehicles && allVehicles.length > 0) {
        await supabase.from('service_categories').insert(
          allVehicles.map(v => ({
            user_id: v.user_id,
            vehicle_id: v.id,
            name: req.name,
            category_type: 'maintenance',
            interval_miles: req.interval_miles,
            interval_days: req.interval_days,
            global_category_id: newCat.id,
            is_visible: true,
          }))
        )
      }
    }
  }

  if (authLoading || !isAdmin) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="bg-zinc-950 min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 lg:pt-6 border-b border-zinc-800/60">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-500" />
            <h1 className="text-xl font-bold text-zinc-100">Admin Dashboard</h1>
          </div>
          <button onClick={load} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex gap-4 text-sm">
          <span className="text-zinc-500">{users.length} <span className="text-zinc-300 font-semibold">users</span></span>
          <span className="text-zinc-500">{users.reduce((s, u) => s + u.vehicles.length, 0)} <span className="text-zinc-300 font-semibold">vehicles</span></span>
          {pendingCount > 0 && <span className="text-blue-400 font-semibold">{pendingCount} pending requests</span>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {([
            ['users', 'Users', Users],
            ['categories', 'Global Categories', null],
            ['requests', `Requests${pendingCount > 0 ? ` (${pendingCount})` : ''}`, null],
          ] as [string, string, unknown][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as typeof tab)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                tab === key ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-28 pt-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'users' ? (
          /* ── Users tab ── */
          <div className="space-y-3">
            {users.length === 0 && <p className="text-zinc-600 text-sm text-center py-12">No users yet</p>}
            {users.map(u => {
              const totalOverdue = u.vehicles.reduce((s, v) => s + v.overdueCount, 0)
              const totalDueSoon = u.vehicles.reduce((s, v) => s + v.dueSoonCount, 0)
              const isExpanded = expandedUser === u.id
              return (
                <div key={u.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-zinc-800/40 transition-colors"
                    onClick={() => expandUser(u.id)}
                  >
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 text-sm font-bold shrink-0">
                      {(u.email ?? '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-100 text-sm font-medium truncate">{u.email ?? '—'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${u.role === 'admin' ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>
                          {u.role}
                        </span>
                        <span className="text-zinc-600 text-xs">{u.vehicles.length} vehicle{u.vehicles.length !== 1 ? 's' : ''}</span>
                        {totalOverdue > 0 && <span className="text-red-400 text-xs font-medium">{totalOverdue} overdue</span>}
                        {totalOverdue === 0 && totalDueSoon > 0 && <span className="text-blue-400 text-xs">{totalDueSoon} due soon</span>}
                        {totalOverdue === 0 && totalDueSoon === 0 && u.vehicles.length > 0 && <span className="text-green-400 text-xs">All current</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={u.role}
                        onClick={e => e.stopPropagation()}
                        onChange={e => changeRole(u.id, e.target.value as 'admin' | 'user')}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-blue-500/50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                      {isExpanded ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
                      {u.vehicles.length === 0 && <p className="text-zinc-600 text-sm">No vehicles</p>}
                      {u.vehicles.map(v => {
                        const vCats = (userCategories[u.id] ?? []).filter(c => c.vehicle_id === v.id)
                        return (
                          <div key={v.id}>
                            <div className="flex items-center gap-2 mb-2">
                              <Car size={13} className="text-zinc-500" />
                              <span className="text-zinc-300 text-sm font-medium">{v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ''}</span>
                              <span className="text-zinc-600 text-xs ml-auto">{v.odometer.toLocaleString()} mi</span>
                              {v.overdueCount > 0 && <span className="text-red-400 text-xs font-semibold">{v.overdueCount} overdue</span>}
                              {v.overdueCount === 0 && v.dueSoonCount > 0 && <span className="text-blue-400 text-xs">{v.dueSoonCount} due soon</span>}
                            </div>
                            {vCats.length > 0 && (
                              <div className="ml-5 space-y-1">
                                {vCats.map(c => (
                                  <div key={c.id} className="flex items-center gap-2">
                                    <button
                                      onClick={() => toggleCategoryVisibility(c.id, u.id, c.is_visible !== false)}
                                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                        c.is_visible !== false ? 'bg-blue-500 border-blue-500' : 'border-zinc-600'
                                      }`}
                                    >
                                      {c.is_visible !== false && <Check size={9} className="text-white" />}
                                    </button>
                                    <span className={`text-xs ${c.is_visible !== false ? 'text-zinc-300' : 'text-zinc-600 line-through'}`}>{c.name}</span>
                                    <span className="text-zinc-600 text-xs ml-auto">
                                      {c.interval_miles ? `${c.interval_miles.toLocaleString()} mi` : ''}{c.interval_miles && c.interval_days ? ' / ' : ''}{c.interval_days ? `${c.interval_days}d` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <p className="text-zinc-700 text-xs">Joined {format(parseISO(u.created_at), 'MMM d, yyyy')}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : tab === 'categories' ? (
          /* ── Global Categories tab ── */
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-zinc-400 text-sm">Master category list. New users automatically inherit these.</p>
              <button
                onClick={openAddCat}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl px-3 py-2 text-xs transition-colors"
              >
                <Plus size={13} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {globalCats.map(cat => (
                <div key={cat.id} className={`bg-zinc-900 border rounded-2xl px-4 py-3 flex items-center gap-3 ${cat.is_active ? 'border-zinc-800' : 'border-zinc-800/40 opacity-60'}`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${cat.is_active ? 'text-zinc-100' : 'text-zinc-500'}`}>{cat.name}</p>
                    <p className="text-zinc-600 text-xs mt-0.5">
                      {cat.interval_miles ? `Every ${cat.interval_miles.toLocaleString()} mi` : ''}{cat.interval_miles && cat.interval_days ? ' · ' : ''}{cat.interval_days ? `${cat.interval_days} days` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleCatActive(cat)}
                      className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${cat.is_active ? 'bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:text-red-400' : 'bg-zinc-800 text-zinc-500 hover:bg-green-500/10 hover:text-green-400'}`}
                    >
                      {cat.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={() => openEditCat(cat)} className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
                      <Pencil size={12} />
                    </button>
                  </div>
                </div>
              ))}
              {globalCats.length === 0 && <p className="text-zinc-600 text-sm text-center py-12">No global categories yet</p>}
            </div>
          </div>
        ) : (
          /* ── Requests tab ── */
          <div className="space-y-3">
            {requests.length === 0 && <p className="text-zinc-600 text-sm text-center py-12">No category requests</p>}
            {requests.map(req => {
              const requester = users.find(u => u.id === req.user_id)
              return (
                <div key={req.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-zinc-100 text-sm font-semibold">{req.name}</p>
                      <p className="text-zinc-500 text-xs mt-0.5">from {requester?.email ?? req.user_id} · {format(parseISO(req.created_at), 'MMM d, yyyy')}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-lg font-medium shrink-0 ${
                      req.status === 'pending' ? 'bg-blue-500/10 text-blue-400'
                      : req.status === 'approved' ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                    }`}>{req.status}</span>
                  </div>
                  {req.description && <p className="text-zinc-400 text-xs mb-2">{req.description}</p>}
                  <div className="flex gap-3 text-xs text-zinc-500">
                    {req.interval_miles && <span>Every {req.interval_miles.toLocaleString()} mi</span>}
                    {req.interval_days && <span>{req.interval_days} days</span>}
                  </div>
                  {req.admin_notes && <p className="text-zinc-500 text-xs mt-2 italic">Admin: {req.admin_notes}</p>}
                  {req.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { setReviewRequest(req); setAdminNotes('') }}
                        className="flex items-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-medium rounded-xl px-3 py-1.5 transition-colors"
                      >
                        <CheckCircle2 size={12} /> Review
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Global Category Modal ── */}
      {showCatModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowCatModal(false) }}
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-100">{editCat ? 'Edit Category' : 'Add Global Category'}</h3>
              <button onClick={() => setShowCatModal(false)} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
                <input type="text" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Transmission Service"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Miles interval</label>
                  <input type="number" value={catForm.interval_miles} onChange={e => setCatForm(f => ({ ...f, interval_miles: e.target.value }))}
                    placeholder="e.g. 5000"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Days interval</label>
                  <input type="number" value={catForm.interval_days} onChange={e => setCatForm(f => ({ ...f, interval_days: e.target.value }))}
                    placeholder="e.g. 180"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCatModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-2.5 text-sm transition-colors">Cancel</button>
              <button
                onClick={saveCat}
                disabled={savingCat || !catForm.name.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-2.5 text-sm transition-colors"
              >
                {savingCat ? 'Saving…' : editCat ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request Review Modal ── */}
      {reviewRequest && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setReviewRequest(null) }}
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-zinc-100">Review Request</h3>
              <button onClick={() => setReviewRequest(null)} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
            </div>
            <p className="text-zinc-200 font-semibold mb-1">{reviewRequest.name}</p>
            {reviewRequest.description && <p className="text-zinc-500 text-sm mb-3">{reviewRequest.description}</p>}
            <div className="flex gap-3 text-xs text-zinc-500 mb-4">
              {reviewRequest.interval_miles && <span>Every {reviewRequest.interval_miles.toLocaleString()} mi</span>}
              {reviewRequest.interval_days && <span>{reviewRequest.interval_days} days</span>}
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Admin notes (optional)</label>
              <textarea
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all resize-none"
                placeholder="Reason for approval or rejection…"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleRequest(reviewRequest, 'rejected')}
                disabled={savingRequest}
                className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium rounded-2xl py-2.5 text-sm transition-colors disabled:opacity-40"
              >
                Reject
              </button>
              <button
                onClick={() => handleRequest(reviewRequest, 'approved')}
                disabled={savingRequest}
                className="flex-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold rounded-2xl py-2.5 text-sm transition-colors disabled:opacity-40"
              >
                {savingRequest ? 'Saving…' : 'Approve & Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
