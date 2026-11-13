// In-memory stand-in for the Supabase client, used only when NEXT_PUBLIC_DEMO=1
// (dev: screenshots, trying flows without the real database). Covers exactly the
// query surface the app uses: select / insert / upsert / update / delete with
// eq, neq, in, lt, lte, gt, gte, is, order, limit, single, maybeSingle; rpc;
// storage (receipts bucket); and a signed-in session. Writes live in memory
// until the page reloads.
import { buildDemoData, DEMO_USER } from './fixtures'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null; count?: number | null }

const db: Record<string, Row[]> = buildDemoData()
const table = (name: string): Row[] => (db[name] ??= [])
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

type Filter = (r: Row) => boolean

class Query implements PromiseLike<Result> {
  private filters: Filter[] = []
  private sorts: { col: string; asc: boolean }[] = []
  private max: number | null = null
  private one: 'single' | 'maybe' | null = null
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private returning = false
  private head = false
  private wantCount = false

  constructor(private name: string) {}

  select(_cols?: string, opts?: { head?: boolean; count?: string }) {
    if (this.op === 'select') { this.head = Boolean(opts?.head); this.wantCount = Boolean(opts?.count) } else this.returning = true
    return this
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
  upsert(rows: Row | Row[]) { this.op = 'upsert'; this.payload = rows; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }

  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this }
  in(c: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[c])); return this }
  lt(c: string, v: number | string) { this.filters.push(r => (r[c] as number | string) < v); return this }
  lte(c: string, v: number | string) { this.filters.push(r => (r[c] as number | string) <= v); return this }
  gt(c: string, v: number | string) { this.filters.push(r => (r[c] as number | string) > v); return this }
  gte(c: string, v: number | string) { this.filters.push(r => (r[c] as number | string) >= v); return this }
  is(c: string, v: unknown) { this.filters.push(r => (r[c] ?? null) === v); return this }
  order(c: string, o?: { ascending?: boolean }) { this.sorts.push({ col: c, asc: o?.ascending !== false }); return this }
  limit(n: number) { this.max = n; return this }
  single() { this.one = 'single'; return this }
  maybeSingle() { this.one = 'maybe'; return this }

  private match(r: Row) { return this.filters.every(f => f(r)) }

  private run(): Result {
    const rows = table(this.name)
    let out: Row[] = []
    if (this.op === 'select') {
      out = rows.filter(r => this.match(r))
    } else if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map(r => ({ id: uuid(), created_at: new Date().toISOString(), ...r }))
      for (const r of list) {
        const at = this.op === 'upsert' ? rows.findIndex(x => x.id === r.id && r.id != null) : -1
        if (at >= 0) rows[at] = { ...rows[at], ...r }; else rows.push(r)
      }
      out = list
    } else if (this.op === 'update') {
      for (const r of rows) if (this.match(r)) Object.assign(r, this.payload)
      out = rows.filter(r => this.match(r))
    } else {
      out = rows.filter(r => this.match(r))
      db[this.name] = rows.filter(r => !this.match(r))
    }
    for (const s of [...this.sorts].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[s.col] as string | number | null, y = b[s.col] as string | number | null
        if (x === y) return 0
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : 1) * (s.asc ? 1 : -1)
      })
    }
    if (this.max != null) out = out.slice(0, this.max)
    const copy = JSON.parse(JSON.stringify(out)) as Row[]
    if (this.op !== 'select' && !this.returning) return { data: null, error: null }
    if (this.one) {
      if (copy.length === 0) return this.one === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'No rows found' } }
      return { data: copy[0], error: null }
    }
    return { data: this.head ? null : copy, error: null, count: this.wantCount ? copy.length : null }
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    // A short delay so loading states are exercised the way they are for real.
    return new Promise<Result>(res => setTimeout(() => res(this.run()), 60)).then(ok, bad)
  }
}

const session = {
  access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: DEMO_USER.id, email: DEMO_USER.email, app_metadata: {}, user_metadata: { full_name: 'Demo Driver' }, aud: 'authenticated', created_at: '2024-08-01T00:00:00Z' },
}

const ok = (data: unknown = null) => Promise.resolve({ data, error: null })

export function createDemoClient() {
  return {
    from: (name: string) => new Query(name),
    rpc: () => ok(),
    storage: {
      from: () => ({
        upload: (path: string) => ok({ path }),
        remove: () => ok([]),
        createSignedUrl: () => ok({ signedUrl: '/demo-receipt.svg' }),
      }),
    },
    auth: {
      getSession: () => ok({ session }),
      refreshSession: () => ok({ session }),
      onAuthStateChange: (cb: (event: string, s: typeof session) => void) => {
        setTimeout(() => cb('SIGNED_IN', session), 0)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      signInWithOAuth: () => ok(),
      signInWithPassword: () => ok({ session }),
      signUp: () => ok({ session }),
      signOut: () => ok(),
    },
  }
}
