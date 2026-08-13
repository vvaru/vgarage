'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { computeStock, type ProductStock } from '@/lib/inventory'
import type { Product, Receipt, ReceiptItem, InventoryAdjustment, ServiceProductUsage } from '@/lib/types'

type ProductU = Product & { unit?: string }

// Garage-wide products and their derived stock, for any surface that needs to
// offer "what do I have on the shelf" without owning the inventory queries.
// Returns empty and quiet when the inventory tables aren't there yet.
export function useStock(userId: string | undefined) {
  const [products, setProducts] = useState<ProductU[]>([])
  const [stock, setStock] = useState<Map<string, ProductStock>>(new Map())

  const reload = useCallback(async () => {
    if (!userId) return
    try {
      const { data: prods } = await supabase.from('products').select('*').eq('user_id', userId).order('name')
      const list = (prods ?? []) as ProductU[]
      setProducts(list)

      const rq = await supabase.from('receipts').select('*').eq('user_id', userId)
      if (rq.error) { setStock(new Map()); return }

      const [itemsQ, usageQ, adjQ, logsQ] = await Promise.all([
        supabase.from('receipt_items').select('*'),
        supabase.from('service_product_usage').select('*'),
        supabase.from('inventory_adjustments').select('*'),
        supabase.from('service_logs').select('id,date').eq('user_id', userId),
      ])
      const dates: Record<string, string> = Object.fromEntries(
        ((logsQ.data ?? []) as { id: string; date: string }[]).map(l => [l.id, l.date]),
      )
      setStock(computeStock(
        list,
        (rq.data ?? []) as Receipt[],
        (itemsQ.data ?? []) as ReceiptItem[],
        (usageQ.data ?? []) as ServiceProductUsage[],
        (adjQ.data ?? []) as InventoryAdjustment[],
        id => dates[id] ?? null,
      ))
    } catch {
      /* leave whatever we already have */
    }
  }, [userId])

  useEffect(() => { reload() }, [reload])

  return { products, stock, reload }
}
