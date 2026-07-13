import { supabase } from '@/lib/supabase'
import { withRetry, withTimeout } from '@/lib/recover'

// MPG for a fill-up is miles-since-the-previous-fill-up ÷ gallons, where "previous"
// means the fill-up at the next-lower odometer. So adding, editing, or deleting a
// fill-up can change the MPG of the fill-up right after it (its previous is now
// different). Rather than track which rows are affected, we recompute the whole
// chain from the ordered odometer/gallons sequence — cheap for a fuel log — and
// write back only the rows whose value actually changed.
//
// Best-effort: never throws. If the network is down the stored values just stay as
// they were until the next successful recompute.
export async function recomputeFuelMpg(vehicleId: string): Promise<void> {
  let logs: { id: string; odometer: number; gallons: number | null; mpg: number | null }[]
  try {
    const { data, error } = await withRetry(() => withTimeout(supabase
      .from('fuel_logs')
      .select('id, odometer, gallons, mpg')
      .eq('vehicle_id', vehicleId)
      .order('odometer', { ascending: true }), 9000))
    if (error || !data) return
    logs = data
  } catch {
    return
  }

  for (let i = 0; i < logs.length; i++) {
    const cur = logs[i]
    const prev = i > 0 ? logs[i - 1] : null
    let mpg: number | null = null
    if (prev && cur.gallons != null && cur.gallons > 0) {
      const delta = cur.odometer - prev.odometer
      if (delta > 0) mpg = parseFloat((delta / cur.gallons).toFixed(2))
    }
    const stored = cur.mpg != null ? parseFloat(Number(cur.mpg).toFixed(2)) : null
    if (mpg !== stored) {
      try {
        await withTimeout(supabase.from('fuel_logs').update({ mpg }).eq('id', cur.id), 9000)
      } catch {
        /* best effort — a later recompute will catch it */
      }
    }
  }
}
