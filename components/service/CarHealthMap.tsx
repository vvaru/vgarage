'use client'

import { LEVEL_COLOR, LEVEL_LABEL, ZONES, type ZoneId, type ZoneLevel, type ZoneState } from '@/lib/carZones'
import type { TirePosition } from '@/lib/tires'

/**
 * Top-down car, each region tinted by the state of the services that touch it:
 * yellow when something's coming up, red — glowing and clickable — when it needs
 * doing. Drawn as inline SVG so every region is data-driven and stays crisp at
 * any size, from a phone header to a full desktop pane.
 *
 * `compact` keeps only the big-ticket regions (tires, engine) live, for small
 * screens where a detailed drawing would just be noise.
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
  const live = (id: ZoneId) => !compact || ZONES.find(z => z.id === id)?.compact
  const levelOf = (id: ZoneId): ZoneLevel => states.get(id)?.level ?? 'none'
  const clickable = (id: ZoneId) => Boolean(onZone && live(id) && (states.get(id)?.items.length ?? 0) > 0)

  // Shared look for a region: dim outline when idle, tinted fill when it has a
  // state, glow + slow pulse when it needs doing.
  const zoneProps = (id: ZoneId, level: ZoneLevel = levelOf(id)) => {
    const isLive = live(id)
    const color = isLive ? LEVEL_COLOR[level] : '#3b82f6'
    const active = activeZone === id
    const tracked = isLive && level !== 'none'
    return {
      fill: color,
      fillOpacity: !isLive ? 0.03 : active ? 0.34 : tracked ? (level === 'ok' ? 0.12 : 0.22) : 0.06,
      stroke: color,
      strokeOpacity: !isLive ? 0.18 : active ? 1 : tracked ? 0.8 : 0.35,
      strokeWidth: active ? 2.2 : 1.3,
      filter: isLive && (level === 'due' || active) ? 'url(#hm-glow)' : undefined,
      className: [
        clickable(id) ? 'cursor-pointer' : '',
        isLive && level === 'due' && !active ? 'animate-pulse' : '',
      ].join(' '),
      onClick: clickable(id) ? () => onZone!(id) : undefined,
    }
  }

  const title = (id: ZoneId) => {
    const st = states.get(id)
    if (!st) return null
    const first = st.items[0]
    return <title>{`${st.zone.label} — ${LEVEL_LABEL[st.level]}${first ? `: ${first.name}${first.detail ? ` (${first.detail})` : ''}` : ''}`}</title>
  }

  const wheels: { pos: TirePosition; x: number; y: number }[] = [
    { pos: 'FL', x: 28, y: 72 }, { pos: 'FR', x: 190, y: 72 },
    { pos: 'RL', x: 28, y: 302 }, { pos: 'RR', x: 190, y: 302 },
  ]
  const brakes: { pos: TirePosition; cx: number; cy: number }[] = [
    { pos: 'FL', cx: 64, cy: 102 }, { pos: 'FR', cx: 176, cy: 102 },
    { pos: 'RL', cx: 64, cy: 332 }, { pos: 'RR', cx: 176, cy: 332 },
  ]

  return (
    <svg viewBox="0 0 240 440" className="w-full h-full overflow-visible" role="img" aria-label="Vehicle health map">
      <defs>
        <linearGradient id="hm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.16" />
          <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.12" />
        </linearGradient>
        <filter id="hm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Faint scan lines — the "holographic" read, kept well below the data */}
        <pattern id="hm-scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="4" y2="0" stroke="#3b82f6" strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Body */}
      <path
        d="M72 20 Q120 6 168 20 L186 66 Q193 110 191 150 L191 296 Q193 346 186 382 L168 420 Q120 434 72 420 L54 382 Q47 346 49 296 L49 150 Q47 110 54 66 Z"
        fill="url(#hm-body)" stroke="#3b82f6" strokeOpacity="0.5" strokeWidth="1.4"
      />
      <path
        d="M72 20 Q120 6 168 20 L186 66 Q193 110 191 150 L191 296 Q193 346 186 382 L168 420 Q120 434 72 420 L54 382 Q47 346 49 296 L49 150 Q47 110 54 66 Z"
        fill="url(#hm-scan)"
      />

      {/* Glass: windshield and rear window, orientation only */}
      <path d="M74 176 L84 146 Q120 136 156 146 L166 176 Q120 168 74 176 Z" fill="#3b82f6" fillOpacity="0.08" stroke="#3b82f6" strokeOpacity="0.3" strokeWidth="0.9" />
      <path d="M78 300 Q120 308 162 300 L154 326 Q120 332 86 326 Z" fill="#3b82f6" fillOpacity="0.07" stroke="#3b82f6" strokeOpacity="0.25" strokeWidth="0.9" />

      {/* Engine bay */}
      <g {...zoneProps('engine')}>
        {title('engine')}
        <rect x="84" y="38" width="72" height="68" rx="12" />
        {/* block detail */}
        <rect x="98" y="52" width="44" height="40" rx="6" fillOpacity={0} strokeOpacity={0.5} />
        <line x1="104" y1="62" x2="136" y2="62" strokeOpacity={0.45} />
        <line x1="104" y1="72" x2="136" y2="72" strokeOpacity={0.45} />
        <line x1="104" y1="82" x2="136" y2="82" strokeOpacity={0.45} />
      </g>

      {/* Battery */}
      <g {...zoneProps('battery')}>
        {title('battery')}
        <rect x="62" y="46" width="16" height="22" rx="3" />
        <line x1="66" y1="44" x2="66" y2="47" strokeOpacity={0.7} />
        <line x1="74" y1="44" x2="74" y2="47" strokeOpacity={0.7} />
      </g>

      {/* Transmission */}
      <g {...zoneProps('transmission')}>
        {title('transmission')}
        <rect x="106" y="112" width="28" height="30" rx="6" />
      </g>

      {/* Wipers */}
      <g {...zoneProps('wipers')}>
        {title('wipers')}
        <rect x="74" y="168" width="92" height="18" rx="6" fillOpacity={0} strokeOpacity={0} />
        <line x1="86" y1="178" x2="116" y2="170" strokeWidth={2.4} strokeLinecap="round" />
        <line x1="124" y1="170" x2="154" y2="178" strokeWidth={2.4} strokeLinecap="round" />
      </g>

      {/* Cabin */}
      <g {...zoneProps('cabin')}>
        {title('cabin')}
        <rect x="66" y="194" width="108" height="98" rx="16" />
        <rect x="78" y="206" width="36" height="32" rx="7" fillOpacity={0} strokeOpacity={0.4} />
        <rect x="126" y="206" width="36" height="32" rx="7" fillOpacity={0} strokeOpacity={0.4} />
        <rect x="78" y="252" width="84" height="28" rx="7" fillOpacity={0} strokeOpacity={0.4} />
      </g>

      {/* Tires — per corner when the set is mixed, as one set otherwise */}
      {wheels.map(w => {
        const level = tireCorners?.get(w.pos) ?? levelOf('tires')
        return (
          <g key={w.pos} {...zoneProps('tires', level)}>
            {title('tires')}
            <rect x={w.x} y={w.y} width="22" height="60" rx="7" />
            {[14, 24, 34, 44].map(dy => (
              <line key={dy} x1={w.x + 4} y1={w.y + dy} x2={w.x + 18} y2={w.y + dy} strokeOpacity={0.35} />
            ))}
          </g>
        )
      })}

      {/* Brakes */}
      {brakes.map(b => (
        <g key={b.pos} {...zoneProps('brakes')}>
          {title('brakes')}
          <circle cx={b.cx} cy={b.cy} r="10" />
          <circle cx={b.cx} cy={b.cy} r="4" fillOpacity={0} strokeOpacity={0.55} />
        </g>
      ))}
    </svg>
  )
}
