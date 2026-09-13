'use client'

import type { ReactNode } from 'react'
import { LEVEL_COLOR, LEVEL_LABEL, ZONES, type ZoneId, type ZoneLevel, type ZoneState } from '@/lib/carZones'
import type { TirePosition } from '@/lib/tires'

/**
 * Top-down X-ray of the car: a translucent blue shell with the mechanicals
 * showing through in steel, each part shaped like the thing it is and roughly
 * to scale for a compact front-wheel-drive sedan. A part picks up colour from
 * the services in its component — yellow when something's coming up, red and
 * glowing when it needs doing — and can be clicked.
 *
 * Shell, glass and seats are drawn with pointer-events off so they never sit on
 * top of a part and swallow its click. Small parts carry invisible, larger hit
 * areas so being true to size doesn't make them hard to tap.
 *
 * `compact` keeps only the big-ticket parts (engine, tires) live for small
 * screens, where detail would just be noise.
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
  const BLUE = '#60a5fa'
  const STEEL = '#cbd5e1'

  const live = (id: ZoneId) => !compact || Boolean(ZONES.find(z => z.id === id)?.compact)
  const levelOf = (id: ZoneId): ZoneLevel => states.get(id)?.level ?? 'none'
  const clickable = (id: ZoneId) => Boolean(onZone && live(id) && (states.get(id)?.items.length ?? 0) > 0)

  const zoneProps = (id: ZoneId, level: ZoneLevel = levelOf(id)) => {
    const isLive = live(id)
    const tracked = isLive && level !== 'none'
    const color = tracked ? LEVEL_COLOR[level] : STEEL
    const active = activeZone === id
    return {
      fill: color,
      fillOpacity: !isLive ? 0.03 : active ? 0.45 : tracked ? (level === 'ok' ? 0.18 : 0.32) : 0.07,
      stroke: color,
      strokeOpacity: !isLive ? 0.2 : active ? 1 : tracked ? 0.95 : 0.6,
      strokeWidth: active ? 1.7 : 1,
      strokeLinejoin: 'round' as const,
      strokeLinecap: 'round' as const,
      filter: isLive && (level === 'due' || active) ? 'url(#hm-glow)' : undefined,
      className: [
        clickable(id) ? 'cursor-pointer' : '',
        isLive && level === 'due' && !active ? 'animate-pulse' : '',
      ].join(' ').trim() || undefined,
      onClick: clickable(id) ? () => onZone!(id) : undefined,
    }
  }

  /** Invisible target, so a small part is still easy to hit. */
  const Hit = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => (
    <rect x={x} y={y} width={w} height={h} rx={6} fillOpacity={0} strokeOpacity={0} />
  )

  const Title = ({ id }: { id: ZoneId }) => {
    const st = states.get(id)
    if (!st) return null
    const first = st.items[0]
    return <title>{`${st.zone.label} — ${LEVEL_LABEL[st.level]}${first ? `: ${first.name}${first.detail ? ` (${first.detail})` : ''}` : ''}`}</title>
  }

  const Part = ({ id, children, level }: { id: ZoneId; children: ReactNode; level?: ZoneLevel }) => (
    <g {...zoneProps(id, level)}><Title id={id} />{children}</g>
  )

  // No stroke detail inherits the part's fill — lines inside parts are outline-only.
  const line = { fillOpacity: 0 } as const

  // Front axle ~0.95 m behind the bumper, 2.7 m wheelbase, tires under the fenders.
  const wheels: { pos: TirePosition; cx: number; cy: number; inboard: 1 | -1 }[] = [
    { pos: 'FL', cx: 34, cy: 128, inboard: 1 },
    { pos: 'FR', cx: 186, cy: 128, inboard: -1 },
    { pos: 'RL', cx: 34, cy: 432, inboard: 1 },
    { pos: 'RR', cx: 186, cy: 432, inboard: -1 },
  ]
  const TW = 22
  const TL = 70

  const body =
    'M60 22 C80 13 140 13 160 22 C178 28 188 44 192 70 L197 106 C200 124 200 150 197 170 ' +
    'L195 250 C194 300 194 352 197 402 C200 418 200 446 198 462 L194 500 C190 526 178 538 160 543 ' +
    'C140 549 80 549 60 543 C42 538 30 526 26 500 L22 462 C20 446 20 418 23 402 ' +
    'C26 352 26 300 25 250 L23 170 C20 150 20 124 23 106 L28 70 C32 44 42 28 60 22 Z'

  return (
    <svg viewBox="-4 0 228 560" className="w-full h-full overflow-visible" role="img" aria-label="Vehicle health map">
      <defs>
        <linearGradient id="hm-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.16" />
          <stop offset="45%" stopColor={BLUE} stopOpacity="0.05" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0.12" />
        </linearGradient>
        <radialGradient id="hm-glass" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.2" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0.05" />
        </radialGradient>
        <filter id="hm-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="hm-scan" width="3" height="3" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="3" y2="0" stroke={BLUE} strokeOpacity="0.06" strokeWidth="0.8" />
        </pattern>
        <clipPath id="hm-body-clip"><path d={body} /></clipPath>
      </defs>

      {/* ── Tires ─────────────────────────────────────────────────────────── */}
      {wheels.map(w => {
        const x = w.cx - TW / 2
        const y = w.cy - TL / 2
        return (
          <Part key={`tire-${w.pos}`} id="tires" level={tireCorners?.get(w.pos) ?? levelOf('tires')}>
            <rect x={x} y={y} width={TW} height={TL} rx={8} />
            <rect x={x + 3} y={y + 4} width={TW - 6} height={TL - 8} rx={5} {...line} strokeOpacity={0.35} strokeWidth={0.6} />
            {[-26, -18, -10, -2, 6, 14, 22].map(d => (
              <path key={d} d={`M${x + 4} ${w.cy + d} L${x + TW / 2} ${w.cy + d + 4} L${x + TW - 4} ${w.cy + d}`}
                {...line} strokeOpacity={0.3} strokeWidth={0.6} />
            ))}
          </Part>
        )
      })}

      {/* ── Shell: context only, never takes a click ─────────────────────── */}
      <g pointerEvents="none">
        <path d={body} fill="url(#hm-shell)" stroke={BLUE} strokeOpacity="0.6" strokeWidth="1.3" />
        <path d={body} fill="url(#hm-scan)" />
        <path d="M195 196 C205 194 214 198 214 204 C214 210 205 212 195 210 Z" fill={BLUE} fillOpacity="0.1" stroke={BLUE} strokeOpacity="0.45" strokeWidth="0.9" />
        <path d="M25 196 C15 194 6 198 6 204 C6 210 15 212 25 210 Z" fill={BLUE} fillOpacity="0.1" stroke={BLUE} strokeOpacity="0.45" strokeWidth="0.9" />
        <g clipPath="url(#hm-body-clip)" fill="none" stroke={BLUE} strokeLinecap="round">
          <path d="M84 50 C82 110 80 160 78 206" strokeOpacity="0.14" strokeWidth="0.8" />
          <path d="M136 50 C138 110 140 160 142 206" strokeOpacity="0.14" strokeWidth="0.8" />
          <path d="M29 176 L29 398" strokeOpacity="0.18" strokeWidth="0.8" />
          <path d="M191 176 L191 398" strokeOpacity="0.18" strokeWidth="0.8" />
          <path d="M24 300 L196 300" strokeOpacity="0.1" strokeWidth="0.8" strokeDasharray="2 3" />
          <path d="M58 428 C90 435 130 435 162 428" strokeOpacity="0.2" strokeWidth="0.8" />
        </g>
        <path d="M42 212 C80 201 140 201 178 212 L168 262 C140 255 80 255 52 262 Z" fill="url(#hm-glass)" stroke={BLUE} strokeOpacity="0.4" strokeWidth="0.9" />
        <path d="M52 266 C80 260 140 260 168 266 L170 372 C140 378 80 378 50 372 Z" fill={BLUE} fillOpacity="0.03" stroke={BLUE} strokeOpacity="0.22" strokeWidth="0.8" />
        <path d="M50 376 C80 382 140 382 170 376 L160 422 C140 428 80 428 60 422 Z" fill="url(#hm-glass)" stroke={BLUE} strokeOpacity="0.35" strokeWidth="0.9" />
        <g fill="none" stroke={BLUE} strokeOpacity="0.2" strokeWidth="0.8">
          <path d="M46 286 C80 278 140 278 174 286" />
          <ellipse cx="78" cy="300" rx="13" ry="5" />
          <rect x="58" y="314" width="38" height="44" rx="10" />
          <rect x="124" y="314" width="38" height="44" rx="10" />
          <rect x="56" y="384" width="108" height="32" rx="10" />
        </g>
      </g>

      {/* ── Exhaust: manifold, catalytic converter, resonator, muffler ───── */}
      <Part id="exhaust">
        <Hit x={144} y={158} w={28} h={44} />
        <Hit x={148} y={280} w={20} h={40} />
        <Hit x={118} y={476} w={68} h={64} />
        <path d="M110 140 C112 150 120 154 130 156 M140 140 C140 148 136 152 130 156" {...line} strokeWidth={2.4} />
        <path d="M130 156 C142 160 158 158 158 168" {...line} strokeWidth={2.6} />
        <rect x="150" y="168" width="16" height="30" rx="6" />
        <path d="M158 198 L158 284 M158 316 L158 372 C158 388 138 392 138 408 L138 474 C138 480 142 484 146 486" {...line} strokeWidth={2.6} />
        <ellipse cx="158" cy="300" rx="6" ry="16" />
        <rect x="124" y="484" width="56" height="20" rx="9" />
        <path d="M150 504 L150 538" {...line} strokeWidth={3} />
      </Part>

      {/* ── Fuel tank under the rear seat, filler neck to the quarter panel ─ */}
      <Part id="fuel">
        <Hit x={20} y={338} w={120} h={64} />
        <path d="M62 344 L128 344 C132 344 134 348 134 352 L134 388 C134 394 130 398 124 398 L66 398 C60 398 56 394 56 388 L56 352 C56 348 58 344 62 344 Z" />
        <circle cx="94" cy="370" r="7" {...line} strokeOpacity={0.7} />
        <path d="M56 360 C44 360 34 354 29 350" {...line} strokeWidth={2.6} />
        <circle cx="27" cy="349" r="3.5" />
      </Part>

      {/* ── Suspension & steering: rack and tie rods, rear beam and springs ─ */}
      <Part id="suspension">
        <Hit x={50} y={132} w={120} h={30} />
        <Hit x={46} y={402} w={128} h={70} />
        <rect x="70" y="150" width="80" height="5" rx="2.5" />
        <ellipse cx="72" cy="152.5" rx="3" ry="4.5" />
        <ellipse cx="148" cy="152.5" rx="3" ry="4.5" />
        <path d="M70 152 L58 139 M150 152 L162 139" {...line} strokeWidth={2} />
        <path d="M60 424 L76 404 M160 424 L144 404" {...line} strokeWidth={3.4} />
        <rect x="50" y="448" width="120" height="7" rx="3.5" />
        {[72, 148].map(cx => (
          <g key={cx}>
            <circle cx={cx} cy={463} r={6.5} {...line} strokeWidth={1.4} />
            <circle cx={cx} cy={463} r={3} {...line} strokeOpacity={0.6} />
          </g>
        ))}
      </Part>

      {/* ── Transmission: transaxle beside the engine, driveshafts to each wheel */}
      <Part id="transmission">
        <Hit x={66} y={90} w={34} h={56} />
        <path d="M67 128 L150 128" {...line} strokeWidth={3} />
        {[71, 149].map(cx => <ellipse key={cx} cx={cx} cy={128} rx={3.5} ry={4.5} />)}
        <path d="M100 96 L88 94 C76 94 69 104 69 118 C69 132 76 142 88 142 L100 140 Z" />
        <circle cx="84" cy="128" r="7" {...line} strokeOpacity={0.75} />
        <circle cx="84" cy="107" r="5" {...line} strokeOpacity={0.55} />
      </Part>

      {/* ── Engine & cooling: head, coils, block, intake plenum, belt drive ─ */}
      <Part id="engine">
        <Hit x={98} y={54} w={68} h={90} />
        <rect x="104" y="58" width="48" height="10" rx="4" />
        {[112, 122, 132, 142].map(x => <path key={x} d={`M${x} 68 L${x} 84`} {...line} strokeWidth={2.4} />)}
        <rect x="100" y="84" width="50" height="24" rx="6" />
        {[109, 120, 131, 142].map(x => <rect key={x} x={x - 3} y={90} width={6} height={12} rx={1.5} strokeOpacity={0.8} />)}
        <rect x="100" y="108" width="50" height="32" rx="6" />
        <rect x="106" y="114" width="38" height="20" rx="4" {...line} strokeOpacity={0.4} strokeDasharray="2 2" />
        <circle cx="106" cy="88" r="2.6" />
        <rect x="152" y="84" width="12" height="27" rx="6" {...line} strokeOpacity={0.55} />
        <circle cx="158" cy="90" r="4.5" />
        <circle cx="158" cy="105" r="3.5" />
      </Part>

      {/* ── Air intake: pleated filter behind the nose, duct to the throttle ─ */}
      <Part id="intake">
        <Hit x={62} y={24} w={100} h={30} />
        <Hit x={136} y={40} w={24} h={28} />
        <rect x="68" y="30" width="84" height="16" rx="3.5" />
        {Array.from({ length: 13 }, (_, i) => 74 + i * 6).map(x => (
          <path key={x} d={`M${x} 32.5 L${x} 43.5`} {...line} strokeOpacity={0.6} strokeWidth={0.8} />
        ))}
        <path d="M140 46 C140 56 150 56 152 64" {...line} strokeWidth={5} strokeOpacity={0.55} />
      </Part>

      {/* ── Battery, front-left of the bay ─────────────────────────────────── */}
      <Part id="battery">
        <Hit x={36} y={46} w={40} h={34} />
        <rect x="40" y="54" width="30" height="20" rx="3" />
        <rect x="44" y="50.5" width="5" height="3.5" rx="1" />
        <rect x="61" y="50.5" width="5" height="3.5" rx="1" />
        <path d="M44.5 64 L48.5 64 M46.5 62 L46.5 66 M61.5 64 L65.5 64" {...line} strokeWidth={1.2} strokeOpacity={0.9} />
      </Part>

      {/* ── Cabin: one pleated filter behind the glovebox ──────────────────── */}
      <Part id="cabin">
        <Hit x={118} y={258} w={44} h={34} />
        <rect x="128" y="268" width="24" height="14" rx="2.5" />
        {[132, 136, 140, 144, 148].map(x => (
          <path key={x} d={`M${x} 270 L${x} 280`} {...line} strokeOpacity={0.65} strokeWidth={0.7} />
        ))}
      </Part>

      {/* ── Wipers, parked at the base of the windshield ───────────────────── */}
      <Part id="wipers">
        <Hit x={44} y={196} w={132} h={26} />
        <path d="M58 214 L104 205 M114 205 L160 214" {...line} strokeWidth={2.6} />
      </Part>

      {/* ── Body & lights: headlights and taillights ───────────────────────── */}
      <Part id="body">
        <Hit x={34} y={20} w={36} h={30} />
        <Hit x={150} y={20} w={36} h={30} />
        <Hit x={30} y={506} w={42} h={36} />
        <Hit x={150} y={506} w={42} h={36} />
        <path d="M40 32 C48 26 58 24 64 25 L63 38 C55 40 46 43 40 46 Z" />
        <path d="M180 32 C172 26 162 24 156 25 L157 38 C165 40 174 43 180 46 Z" />
        <path d="M37 514 C43 526 54 533 68 536 L68 526 C57 524 48 520 40 508 Z" />
        <path d="M183 514 C177 526 166 533 152 536 L152 526 C163 524 172 520 180 508 Z" />
      </Part>

      {/* ── Brakes: rotor edge-on inboard of each wheel, caliper clamped on ─ */}
      {wheels.map(w => {
        const rotorX = w.inboard === 1 ? w.cx + TW / 2 + 2 : w.cx - TW / 2 - 2 - 7
        const caliperX = w.inboard === 1 ? rotorX + 9 : rotorX - 2 - 11
        return (
          <Part key={`brake-${w.pos}`} id="brakes">
            <Hit x={Math.min(rotorX, caliperX) - 4} y={w.cy - 30} w={26} h={60} />
            <rect x={rotorX} y={w.cy - 26} width={7} height={52} rx={3} />
            <path d={`M${rotorX + 3.5} ${w.cy - 22} L${rotorX + 3.5} ${w.cy + 22}`} {...line} strokeOpacity={0.45} strokeWidth={0.7} />
            <rect x={caliperX} y={w.cy - 11} width={11} height={22} rx={4} />
          </Part>
        )
      })}
    </svg>
  )
}
