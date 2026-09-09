'use client'

import { POSITION_SHORT, TIRE_POSITIONS, type TireLife, type TirePosition, type TireStatus } from '@/lib/tires'

type Slot = TireStatus | 'empty'

export const STATUS_COLOR: Record<Slot, string> = {
  good: '#22c55e',
  worn: '#f59e0b',
  due: '#f97316',
  over: '#ef4444',
  unknown: '#71717a',
  empty: '#3f3f46',
}

export const STATUS_LABEL: Record<Slot, string> = {
  good: 'Good', worn: 'Wearing', due: 'Due soon', over: 'Overdue',
  unknown: 'No life set', empty: 'Nothing fitted',
}

/**
 * Top-down car with the tire currently on each corner, tinted by life left.
 *
 * Inline SVG rather than an image so every corner can be driven from data and
 * stay crisp at any size. The body is deliberately understated — it exists to
 * tell you WHICH corner you're looking at, nothing more.
 */
export default function TireDiagram({
  mounted, size = 200, onPick, activePosition,
}: {
  /** What's on each corner right now; a missing corner renders as empty. */
  mounted: Map<TirePosition, TireLife>
  size?: number
  onPick?: (position: TirePosition) => void
  activePosition?: TirePosition | null
}) {
  const corners: { pos: TirePosition; x: number; y: number }[] = [
    { pos: 'FL', x: 12, y: 30 },
    { pos: 'FR', x: 88, y: 30 },
    { pos: 'RL', x: 12, y: 132 },
    { pos: 'RR', x: 88, y: 132 },
  ]

  return (
    <svg viewBox="0 0 120 200" width={size} height={size * 200 / 120} className="overflow-visible">
      <defs>
        <linearGradient id="tire-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.04" />
        </linearGradient>
        <filter id="tire-glow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <path
        d="M34 18 Q60 6 86 18 L94 62 Q96 100 94 138 L86 184 Q60 194 34 184 L26 138 Q24 100 26 62 Z"
        fill="url(#tire-body)" stroke="#3b82f6" strokeOpacity="0.45" strokeWidth="1.2"
      />
      <path d="M34 62 Q60 54 86 62 L86 116 Q60 124 34 116 Z" fill="#3b82f6" fillOpacity="0.09" stroke="#3b82f6" strokeOpacity="0.25" strokeWidth="0.8" />
      <line x1="26" y1="45" x2="94" y2="45" stroke="#3b82f6" strokeOpacity="0.2" strokeWidth="0.8" />
      <line x1="26" y1="147" x2="94" y2="147" stroke="#3b82f6" strokeOpacity="0.2" strokeWidth="0.8" />

      {corners.map(c => {
        const life = mounted.get(c.pos)
        const slot: Slot = life ? life.status : 'empty'
        const color = STATUS_COLOR[slot]
        const pctLeft = life?.pctUsed != null ? Math.max(0, Math.min(100, 100 - life.pctUsed)) : null
        const active = activePosition === c.pos
        const loud = slot === 'over' || slot === 'due' || active
        const H = 38
        return (
          <g
            key={c.pos}
            onClick={onPick ? () => onPick(c.pos) : undefined}
            className={onPick ? 'cursor-pointer' : undefined}
            filter={loud ? 'url(#tire-glow)' : undefined}
          >
            <rect
              x={c.x} y={c.y} width={20} height={H} rx={5}
              fill={color} fillOpacity={active ? 0.30 : 0.14}
              stroke={color} strokeOpacity={active ? 1 : 0.75} strokeWidth={active ? 2 : 1.4}
            />
            {/* Remaining life, filling from the bottom up */}
            {pctLeft != null && (
              <rect
                x={c.x + 2} y={c.y + 2 + (H - 4) * (1 - pctLeft / 100)}
                width={16} height={Math.max(1.5, (H - 4) * (pctLeft / 100))}
                rx={3} fill={color} fillOpacity={0.55}
              />
            )}
            <text
              x={c.x + 10} y={c.y + H / 2 + 3.5}
              textAnchor="middle" fontSize="9" fontWeight="700"
              fill={slot === 'empty' ? '#71717a' : '#fafafa'}
            >{POSITION_SHORT[c.pos]}</text>
          </g>
        )
      })}
    </svg>
  )
}

export { TIRE_POSITIONS }
