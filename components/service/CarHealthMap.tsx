'use client'

import { LEVEL_COLOR, LEVEL_LABEL, ZONES, type ZoneId, type ZoneLevel, type ZoneState } from '@/lib/carZones'
import type { TirePosition } from '@/lib/tires'

/**
 * Top-down X-ray of the car. The body is a translucent shell and the parts that
 * services act on show through it, each drawn roughly to scale and tinted by
 * state: yellow when something's coming up, red — glowing and clickable — when
 * it needs doing.
 *
 * Proportions follow a compact sedan (≈4.7 m long, 1.8 m wide, 2.7 m wheelbase,
 * transverse engine): a cabin air filter is palm-sized behind the glovebox, not
 * a slab across the interior. Small parts carry invisible, larger hit areas so
 * being true to size doesn't make them hard to tap.
 *
 * `compact` keeps only the big-ticket regions (tires, engine) live, for small
 * screens where detail would just be noise.
 */
export default function CarHealthMap({
  states, compact = false, onZone, activeZone = null, tireCorners = null,
}: {
  states: Map<ZoneId, ZoneState>
  compact?: boolean
  onZone?: (zone: ZoneId) => void
  activeZone?: ZoneId | null
  /** Per-corner tint, only when the tires on the car differ from each other. */
  tireCorners?: Map<TirePosition, ZoneLevel> | null
}) {
  const live = (id: ZoneId) => !compact || Boolean(ZONES.find(z => z.id === id)?.compact)
  const levelOf = (id: ZoneId): ZoneLevel => states.get(id)?.level ?? 'none'
  const clickable = (id: ZoneId) => Boolean(onZone && live(id) && (states.get(id)?.items.length ?? 0) > 0)

  const BLUE = '#60a5fa'

  const zoneProps = (id: ZoneId, level: ZoneLevel = levelOf(id)) => {
    const isLive = live(id)
    const tracked = isLive && level !== 'none'
    const color = tracked ? LEVEL_COLOR[level] : BLUE
    const active = activeZone === id
    return {
      fill: color,
      fillOpacity: !isLive ? 0.04 : active ? 0.42 : tracked ? (level === 'ok' ? 0.16 : 0.3) : 0.08,
      stroke: color,
      strokeOpacity: !isLive ? 0.22 : active ? 1 : tracked ? 0.9 : 0.45,
      strokeWidth: active ? 1.8 : 1.1,
      strokeLinejoin: 'round' as const,
      filter: isLive && (level === 'due' || active) ? 'url(#hm-glow)' : undefined,
      className: [
        clickable(id) ? 'cursor-pointer' : '',
        isLive && level === 'due' && !active ? 'animate-pulse' : '',
      ].join(' ').trim() || undefined,
      onClick: clickable(id) ? () => onZone!(id) : undefined,
    }
  }

  /** An invisible target around a small part, so true-to-size stays tappable. */
  const Hit = (p: { x: number; y: number; w: number; h: number }) => (
    <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={6} fillOpacity={0} strokeOpacity={0} />
  )

  const title = (id: ZoneId) => {
    const st = states.get(id)
    if (!st) return null
    const first = st.items[0]
    return <title>{`${st.zone.label} — ${LEVEL_LABEL[st.level]}${first ? `: ${first.name}${first.detail ? ` (${first.detail})` : ''}` : ''}`}</title>
  }

  // Wheel centres: front axle ~0.95 m behind the bumper, 2.7 m wheelbase.
  const wheels: { pos: TirePosition; cx: number; cy: number; inboard: 1 | -1 }[] = [
    { pos: 'FL', cx: 34, cy: 128, inboard: 1 },
    { pos: 'FR', cx: 186, cy: 128, inboard: -1 },
    { pos: 'RL', cx: 34, cy: 432, inboard: 1 },
    { pos: 'RR', cx: 186, cy: 432, inboard: -1 },
  ]
  const TIRE_W = 22
  const TIRE_L = 70

  const body =
    'M60 22 C80 13 140 13 160 22 C178 28 188 44 192 70 L197 106 C200 124 200 150 197 170 ' +
    'L195 250 C194 300 194 352 197 402 C200 418 200 446 198 462 L194 500 C190 526 178 538 160 543 ' +
    'C140 549 80 549 60 543 C42 538 30 526 26 500 L22 462 C20 446 20 418 23 402 ' +
    'C26 352 26 300 25 250 L23 170 C20 150 20 124 23 106 L28 70 C32 44 42 28 60 22 Z'

  return (
    <svg viewBox="-4 0 228 560" className="w-full h-full overflow-visible" role="img" aria-label="Vehicle health map">
      <defs>
        <linearGradient id="hm-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.14" />
          <stop offset="45%" stopColor={BLUE} stopOpacity="0.04" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="hm-glass" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.16" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0.04" />
        </radialGradient>
        <filter id="hm-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="hm-scan" width="3" height="3" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="3" y2="0" stroke={BLUE} strokeOpacity="0.06" strokeWidth="0.8" />
        </pattern>
        <clipPath id="hm-body-clip"><path d={body} /></clipPath>
      </defs>

      {/* ── Tires sit under the shell, so they're drawn first ──────────────── */}
      {wheels.map(w => {
        const level = tireCorners?.get(w.pos) ?? levelOf('tires')
        const x = w.cx - TIRE_W / 2
        const y = w.cy - TIRE_L / 2
        return (
          <g key={`tire-${w.pos}`} {...zoneProps('tires', level)}>
            {title('tires')}
            <rect x={x} y={y} width={TIRE_W} height={TIRE_L} rx={8} />
            {/* sidewall + tread, faint */}
            <rect x={x + 3} y={y + 4} width={TIRE_W - 6} height={TIRE_L - 8} rx={5} fillOpacity={0} strokeOpacity={0.35} strokeWidth={0.7} />
            {[-24, -16, -8, 0, 8, 16, 24].map(d => (
              <path key={d} d={`M${x + 4} ${w.cy + d - 2} L${x + TIRE_W / 2} ${w.cy + d + 2} L${x + TIRE_W - 4} ${w.cy + d - 2}`}
                fillOpacity={0} strokeOpacity={0.28} strokeWidth={0.7} />
            ))}
          </g>
        )
      })}

      {/* ── Shell ───────────────────────────────────────────────────────────── */}
      <path d={body} fill="url(#hm-shell)" stroke={BLUE} strokeOpacity="0.55" strokeWidth="1.3" />
      <path d={body} fill="url(#hm-scan)" />
      {/* mirrors */}
      <path d="M195 196 C205 194 214 198 214 204 C214 210 205 212 195 210 Z" fill={BLUE} fillOpacity="0.08" stroke={BLUE} strokeOpacity="0.4" strokeWidth="0.9" />
      <path d="M25 196 C15 194 6 198 6 204 C6 210 15 212 25 210 Z" fill={BLUE} fillOpacity="0.08" stroke={BLUE} strokeOpacity="0.4" strokeWidth="0.9" />

      {/* ── Orientation detail, clipped to the body and kept faint ─────────── */}
      <g clipPath="url(#hm-body-clip)" fill="none" stroke={BLUE} strokeLinecap="round">
        {/* hood creases */}
        <path d="M86 36 C84 100 82 150 80 204" strokeOpacity="0.16" strokeWidth="0.8" />
        <path d="M134 36 C136 100 138 150 140 204" strokeOpacity="0.16" strokeWidth="0.8" />
        {/* door shut lines */}
        <path d="M24 300 L196 300" strokeOpacity="0.1" strokeWidth="0.8" strokeDasharray="2 3" />
        {/* trunk shut line */}
        <path d="M58 426 C90 433 130 433 162 426" strokeOpacity="0.2" strokeWidth="0.8" />
      </g>

      {/* glass */}
      <path d="M42 212 C80 201 140 201 178 212 L168 262 C140 255 80 255 52 262 Z" fill="url(#hm-glass)" stroke={BLUE} strokeOpacity="0.35" strokeWidth="0.9" />
      <path d="M52 266 C80 260 140 260 168 266 L170 372 C140 378 80 378 50 372 Z" fill={BLUE} fillOpacity="0.025" stroke={BLUE} strokeOpacity="0.18" strokeWidth="0.8" />
      <path d="M50 376 C80 382 140 382 170 376 L160 420 C140 426 80 426 60 420 Z" fill="url(#hm-glass)" stroke={BLUE} strokeOpacity="0.3" strokeWidth="0.9" />

      {/* cabin furniture — context only, never a zone */}
      <g fill="none" stroke={BLUE} strokeOpacity="0.22" strokeWidth="0.8">
        <path d="M46 284 C80 276 140 276 174 284" />
        <ellipse cx="80" cy="298" rx="14" ry="5" />
        <rect x="58" y="312" width="38" height="44" rx="10" />
        <rect x="124" y="312" width="38" height="44" rx="10" />
        <path d="M110 312 L110 360" strokeDasharray="2 3" />
        <rect x="56" y="380" width="108" height="34" rx="10" />
      </g>

      {/* ── Engine bay (transverse) ────────────────────────────────────────── */}
      <g {...zoneProps('engine')}>
        {title('engine')}
        <Hit x={98} y={26} w={82} h={120} />
        {/* radiator across the nose */}
        <rect x="56" y="30" width="108" height="8" rx="3" />
        {/* engine air box */}
        <rect x="140" y="48" width="30" height="24" rx="6" />
        <path d="M140 60 C130 60 128 78 126 94" fillOpacity={0} />
        {/* block with four cylinders */}
        <rect x="100" y="94" width="60" height="48" rx="9" />
        {[111, 124, 137, 150].map(cx => (
          <circle key={cx} cx={cx} cy="118" r="4" fillOpacity={0} strokeOpacity={0.7} />
        ))}
        {/* oil filler cap */}
        <circle cx="131" cy="101" r="3" />
        {/* coolant reservoir */}
        <rect x="165" y="78" width="14" height="20" rx="5" />
      </g>

      {/* ── Transmission, driver's side of the engine ──────────────────────── */}
      <g {...zoneProps('transmission')}>
        {title('transmission')}
        <Hit x={58} y={92} w={42} h={56} />
        <path d="M100 100 L78 100 C66 100 60 108 60 120 C60 132 66 140 78 140 L100 140 Z" />
        <circle cx="76" cy="120" r="7" fillOpacity={0} strokeOpacity={0.6} />
      </g>

      {/* ── Battery, front-left of the bay ─────────────────────────────────── */}
      <g {...zoneProps('battery')}>
        {title('battery')}
        <Hit x={40} y={42} w={42} h={38} />
        <rect x="46" y="50" width="30" height="20" rx="3" />
        <circle cx="52" cy="54" r="1.8" strokeOpacity={0.8} />
        <circle cx="70" cy="54" r="1.8" strokeOpacity={0.8} />
      </g>

      {/* ── Wipers, parked at the base of the windshield ───────────────────── */}
      <g {...zoneProps('wipers')}>
        {title('wipers')}
        <Hit x={44} y={196} w={132} h={26} />
        <path d="M58 214 L104 205" strokeWidth={2.2} strokeLinecap="round" fillOpacity={0} />
        <path d="M114 205 L160 214" strokeWidth={2.2} strokeLinecap="round" fillOpacity={0} />
      </g>

      {/* ── Cabin: HVAC unit behind the dash, filter behind the glovebox ───── */}
      <g {...zoneProps('cabin')}>
        {title('cabin')}
        <Hit x={92} y={262} w={70} h={30} />
        <rect x="99" y="270" width="22" height="12" rx="3" />
        <rect x="134" y="271" width="18" height="11" rx="2" />
        {[138, 142, 146, 150].map(x => (
          <line key={x} x1={x} y1={273} x2={x} y2={280} strokeOpacity={0.6} strokeWidth={0.6} />
        ))}
      </g>

      {/* ── Brakes: rotor edge-on just inboard of each wheel, caliper on it ─ */}
      {wheels.map(w => {
        const rotorX = w.cx + w.inboard * (TIRE_W / 2 + 2)       // inner face of the rotor
        const rx = w.inboard === 1 ? rotorX : rotorX - 5
        const cx = w.inboard === 1 ? rotorX + 3 : rotorX - 3 - 9
        return (
          <g key={`brake-${w.pos}`} {...zoneProps('brakes')}>
            {title('brakes')}
            <Hit x={Math.min(rx, cx) - 5} y={w.cy - 30} w={24} h={60} />
            <rect x={rx} y={w.cy - 25} width={5} height={50} rx={2.5} />
            <rect x={cx} y={w.cy - 10} width={9} height={20} rx={3.5} />
          </g>
        )
      })}
    </svg>
  )
}
