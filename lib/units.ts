// Inventory units.
//
// Three flavours, because they read differently:
//   measures  — print as-is, never pluralised: "2.5 qt", "1 gal"
//   countable — pluralise the noun: "1 filter", "3 filters"
//   'each'    — the unitless fallback; prints as a bare number: "3"

export const MEASURE_UNITS = ['qt', 'gal', 'L', 'mL', 'oz', 'fl oz', 'lb', 'kg', 'ft'] as const

export const COUNT_UNITS = [
  'filter', 'blade', 'bulb', 'plug', 'tire', 'pad', 'rotor', 'belt', 'hose',
  'bottle', 'can', 'box', 'pair', 'set', 'kit',
] as const

// Grouped for <optgroup> in the unit pickers.
export const UNIT_GROUPS: { label: string; units: string[] }[] = [
  { label: 'Count', units: ['each', ...COUNT_UNITS] },
  { label: 'Volume & weight', units: [...MEASURE_UNITS] },
]

const MEASURES = new Set<string>(MEASURE_UNITS)

export const isMeasure = (unit: string): boolean => MEASURES.has(unit)

// "filter" → "filters", "box" → "boxes", "battery" → "batteries"
export function pluralize(unit: string, n: number): string {
  if (n === 1) return unit
  if (/([sxz]|[cs]h)$/i.test(unit)) return `${unit}es`
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`
  return `${unit}s`
}

// Trim float noise without turning 2.50 into "2.50" or 4 into "4.00".
export function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000
  if (Number.isInteger(r)) return String(r)
  return r.toFixed(Math.abs(r) < 10 ? 2 : 1).replace(/\.?0+$/, '')
}

// "1 filter", "3 filters", "2.5 qt", or a bare "4" when the unit is 'each'.
export function fmtQty(n: number, unit?: string | null): string {
  const num = fmtNum(n)
  const u = (unit ?? '').trim()
  if (!u || u === 'each') return num
  return isMeasure(u) ? `${num} ${u}` : `${num} ${pluralize(u, n)}`
}

// Best-guess unit from a product name, so new products rarely need correcting.
const GUESSES: [RegExp, string][] = [
  [/\b(engine ?oil|motor ?oil|coolant|antifreeze|atf|fluid|lubricant)\b/i, 'qt'],
  [/\bfilters?\b/i, 'filter'],
  [/\b(wiper|blades?)\b/i, 'blade'],
  [/\b(bulbs?|headlight|taillight)\b/i, 'bulb'],
  [/\b(spark ?plugs?|plugs?)\b/i, 'plug'],
  [/\btires?\b/i, 'tire'],
  [/\b(brake ?)?pads?\b/i, 'pad'],
  [/\brotors?\b/i, 'rotor'],
  [/\bbelts?\b/i, 'belt'],
  [/\bhoses?\b/i, 'hose'],
]

export function guessUnit(name: string): string {
  for (const [re, unit] of GUESSES) if (re.test(name)) return unit
  return 'each'
}
