import { supabase } from '@/lib/supabase'

/**
 * Change a product's unit and rescale everything already logged for it, in one
 * database transaction (supabase/convert_product_unit.sql). `factor` is how many
 * of the new unit make one of the old: 1 can = 5 qt → factor 5. `fromUnit` must be
 * the product's current unit; if it has already changed, nothing is converted twice.
 */
export async function convertProductUnit(productId: string, fromUnit: string, newUnit: string, factor: number): Promise<void> {
  if (!(factor > 0)) throw new Error('Enter how many of the new unit make one of the old.')
  const { error } = await supabase.rpc('convert_product_unit', {
    p_product_id: productId, p_from_unit: fromUnit, p_new_unit: newUnit, p_factor: factor,
  })
  if (!error) return
  if (/convert_product_unit/.test(error.message) && /(find|exist)/i.test(error.message)) {
    throw new Error('Unit conversion isn’t set up in the database yet (run supabase/convert_product_unit.sql).')
  }
  throw new Error(error.message)
}
