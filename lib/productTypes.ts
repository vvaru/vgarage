// Product types sit above models: "Transmission Fluid" is the type, Honda HCF2
// is one model of it. Types are what a receipt should be named by and what a
// service category should link to — a model number tells you nothing at a glance.

export interface ProductType {
  id: string
  user_id: string
  name: string
  created_at: string
}

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)

/**
 * The trailing words every name shares, never consuming a whole name — so
 * ["Fluid", "Brake Fluid"] finds nothing rather than leaving an empty prefix.
 */
function sharedTail(names: string[][]): string[] {
  const shortest = Math.min(...names.map(w => w.length))
  const tail: string[] = []
  for (let back = 1; back < shortest; back++) {
    const word = names[0][names[0].length - back]
    const everyone = names.every(w => w[w.length - back].toLowerCase() === word.toLowerCase())
    if (!everyone) break
    tail.unshift(word)
  }
  return tail
}

/**
 * Join type names, factoring out a shared trailing word so a receipt reads
 * "Transmission + Brake Fluid" rather than repeating "Fluid" each time.
 * Names with nothing in common fall back to a plain list.
 */
export function joinTypeNames(names: (string | null | undefined)[], max = 3): string {
  const clean = [...new Set(names.map(n => (n ?? '').trim()).filter(Boolean))]
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]

  const shown = clean.slice(0, max)
  const extra = clean.length - shown.length
  const tail = sharedTail(shown.map(words))

  const body = tail.length > 0
    ? `${shown.map(n => words(n).slice(0, words(n).length - tail.length).join(' ')).join(' + ')} ${tail.join(' ')}`
    : shown.join(', ')

  return extra > 0 ? `${body} +${extra} more` : body
}

// The verbs a service category wraps around the thing it acts on.
const SERVICE_VERBS = /\b(change|changes|replacement|replace|service|servicing|flush|rotation|rotate|inspection|inspect|check|top[-\s]?up|refill|swap)\b/gi

/** "Transmission Fluid Change" → "Transmission Fluid" */
export function typeFromCategory(categoryName: string): string {
  return categoryName.replace(SERVICE_VERBS, ' ').replace(/\s+/g, ' ').replace(/^[\s&-]+|[\s&-]+$/g, '').trim()
}

// Fallbacks when a product carries no category to learn from.
const NAME_HINTS: [RegExp, string][] = [
  [/\b(atf|transmission)\b/i, 'Transmission Fluid'],
  [/\b(engine ?oil|motor ?oil|\d+w-?\d+)\b/i, 'Engine Oil'],
  [/\boil ?filter\b/i, 'Oil Filter'],
  [/\bcabin\b/i, 'Cabin Air Filter'],
  [/\bair ?filter\b/i, 'Air Filter'],
  [/\b(coolant|antifreeze)\b/i, 'Coolant'],
  [/\bbrake ?fluid\b/i, 'Brake Fluid'],
  [/\bbrake ?pads?\b/i, 'Brake Pads'],
  [/\b(wiper|blades?)\b/i, 'Wiper Blades'],
  [/\bspark ?plugs?\b/i, 'Spark Plugs'],
  [/\btires?\b/i, 'Tires'],
  [/\bbatter(y|ies)\b/i, 'Battery'],
  [/\bdiff(erential)? ?(fluid|oil)\b/i, 'Differential Fluid'],
]

export interface TypeGuess {
  name: string | null
  /** Where it came from — a category the user tagged is far stronger than a name match. */
  from: 'category' | 'name' | null
}

/**
 * Best guess at a product's type. A category the user already tagged is the
 * strongest signal; the product name is a weaker fallback; otherwise nothing,
 * which the catalogue surfaces rather than inventing an answer.
 */
export function guessProductType(name: string, categoryNames: string[] = []): TypeGuess {
  for (const cat of categoryNames) {
    const derived = typeFromCategory(cat)
    if (derived && words(derived).length > 0) return { name: derived, from: 'category' }
  }
  for (const [re, type] of NAME_HINTS) {
    if (re.test(name)) return { name: type, from: 'name' }
  }
  return { name: null, from: null }
}

/** Case-insensitive lookup so guessing doesn't create near-duplicate types. */
export function findType(types: ProductType[], name: string): ProductType | undefined {
  const key = name.trim().toLowerCase()
  return types.find(t => t.name.trim().toLowerCase() === key)
}
