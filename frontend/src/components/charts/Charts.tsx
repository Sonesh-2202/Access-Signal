import { motion, useInView, useReducedMotion } from 'framer-motion'
import { useId, useRef, useState } from 'react'
import { cx } from '@/utils/cx'

const INK = '#1A1917'
const OK = '#1F6E43'
const EASE = [0.16, 1, 0.3, 1] as const

const fmtWeek = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export interface StackGroup {
  key: string
  label: string
  color: string
  values: number[]
}

/**
 * Stacked weekly bars (reports by type) with a line for verified repairs. Bars grow in
 * once when scrolled into view; hovering a week shows its breakdown.
 */
export function StackedBarLine({ weeks, groups, line, lineLabel, title }: { weeks: string[]; groups: StackGroup[]; line: number[]; lineLabel: string; title: string }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { once: true, margin: '-60px' })
  const still = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const W = 680
  const H = 280
  const pad = { l: 34, r: 12, t: 16, b: 30 }
  const totals = weeks.map((_, i) => groups.reduce((a, g) => a + (g.values[i] ?? 0), 0))
  const max = Math.max(1, ...totals, ...line)
  const niceMax = Math.ceil(max / 20) * 20
  const band = (W - pad.l - pad.r) / weeks.length
  const bw = Math.min(30, band * 0.58)
  const cx0 = (i: number) => pad.l + band * i + band / 2
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax)
  const linePath = line.map((v, i) => `${i ? 'L' : 'M'}${cx0(i)},${y(v)}`).join(' ')
  const tip = hover !== null ? Math.min(Math.max(cx0(hover), pad.l + 90), W - pad.r - 90) : 0

  return (
    <figure aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">{title}</figcaption>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm" aria-hidden>
        {groups.map((g) => (
          <li key={g.key} className="inline-flex items-center gap-0.5">
            <span className="h-[10px] w-[10px] rounded-[2px]" style={{ background: g.color }} />
            {g.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-0.5">
          <svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={OK} strokeWidth="2.5" /><circle cx="11" cy="5" r="3" fill="#FCFBF8" stroke={OK} strokeWidth="2" /></svg>
          {lineLabel}
        </li>
      </ul>
      <div ref={ref} className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title}. Data table follows.`} onMouseLeave={() => setHover(null)}>
          {[0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={INK} strokeOpacity={t === 0 ? 0.32 : 0.07} />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" className="fill-muted font-mono" fontSize="10">{t}</text>
            </g>
          ))}
          {weeks.map((w, i) => {
            let acc = 0
            const dim = hover !== null && hover !== i
            return (
              <g key={w} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 160ms' }}>
                {groups.map((g, gi) => {
                  const v = g.values[i] ?? 0
                  const y0 = y(acc)
                  acc += v
                  const y1 = y(acc)
                  return (
                    <motion.rect
                      key={g.key}
                      x={cx0(i) - bw / 2}
                      width={bw}
                      fill={g.color}
                      initial={still ? false : { y: y(0), height: 0 }}
                      animate={seen || still ? { y: y1, height: Math.max(0, y0 - y1 - 1) } : { y: y(0), height: 0 }}
                      transition={{ duration: 0.6, delay: i * 0.035 + gi * 0.02, ease: EASE }}
                    />
                  )
                })}
              </g>
            )
          })}
          <motion.path
            d={linePath}
            fill="none"
            stroke={OK}
            strokeWidth="2.25"
            strokeLinejoin="round"
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: seen || still ? 1 : 0 }}
            transition={{ duration: 1, delay: 0.35, ease: EASE }}
          />
          {line.map((v, i) => (
            <circle key={i} cx={cx0(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill="#FCFBF8" stroke={OK} strokeWidth="2" style={{ transition: 'r 120ms' }} opacity={seen || still ? 1 : 0} />
          ))}
          {weeks.map((w, i) =>
            i % 2 === 0 || i === weeks.length - 1 ? (
              <text key={w} x={cx0(i)} y={H - 10} textAnchor="middle" className="fill-muted font-mono" fontSize="10">{fmtWeek(w)}</text>
            ) : null,
          )}
          {weeks.map((w, i) => (
            <rect key={`h${w}`} x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-[180px] -translate-x-1/2 rounded-sm border border-stone-300/80 bg-paper-raised/95 px-1 py-0.5 text-xs shadow-[0_8px_24px_-12px_rgba(26,25,23,0.35)]"
            style={{ left: `${(tip / W) * 100}%` }}
            role="presentation"
          >
            <p className="tabular font-mono text-muted">Week of {fmtWeek(weeks[hover])}</p>
            <dl className="mt-0.5 flex flex-col">
              {groups.map((g) => (
                <div key={g.key} className="flex items-center justify-between gap-1">
                  <dt className="inline-flex items-center gap-0.5"><span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: g.color }} />{g.label}</dt>
                  <dd className="tabular font-mono">{g.values[hover]}</dd>
                </div>
              ))}
              <div className="mt-0.5 flex justify-between border-t border-hair pt-0.5 font-medium">
                <dt>Reported</dt>
                <dd className="tabular font-mono">{totals[hover]}</dd>
              </div>
              <div className="flex justify-between text-ok">
                <dt>{lineLabel}</dt>
                <dd className="tabular font-mono">{line[hover]}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <DataTable
        caption={title}
        head={['Week of', ...groups.map((g) => g.label), 'Reported', lineLabel]}
        rows={weeks.map((w, i) => [fmtWeek(w), ...groups.map((g) => g.values[i]), totals[i], line[i]])}
      />
    </figure>
  )
}

/** Horizontal bars that grow in on first view. Values always printed, never colour-only. */
export function HBarChart({ rows, title, format = (v: number) => String(v), accentKey }: { rows: { key: string; label: string; value: number; note?: string }[]; title: string; format?: (v: number) => string; accentKey?: string }) {
  const ref = useRef<HTMLDListElement>(null)
  const seen = useInView(ref, { once: true, margin: '-40px' })
  const still = useReducedMotion()
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <dl ref={ref} className="flex flex-col">
        {rows.map((r, i) => (
          // dt/dd must be direct children of the row div, so the layout is a grid rather than a nested flex.
          <div key={r.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 border-t border-hair py-1">
            <dt className="text-sm">{r.label}</dt>
            <dd className="tabular whitespace-nowrap font-mono text-xs">
              {format(r.value)}
              {r.note && <span className="ml-1 text-muted">{r.note}</span>}
            </dd>
            <dd className="relative col-span-2 mt-0.5 h-[8px] bg-hair" aria-hidden>
              <motion.span
                className={cx('absolute inset-y-0 left-0 origin-left', r.key === accentKey ? 'bg-signal' : 'bg-ink')}
                style={{ width: `${(r.value / max) * 100}%` }}
                initial={still ? false : { scaleX: 0 }}
                animate={{ scaleX: seen || still ? 1 : 0 }}
                transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  )
}

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-1 text-sm">
      <summary className="inline-flex min-h-touch cursor-pointer items-center text-muted underline decoration-rule underline-offset-[3px]">Show data table</summary>
      <div className="scroll-tray" tabIndex={0} role="region" aria-label={`${caption} (table)`}>
        <table className="mt-1 w-full min-w-[320px] text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{head.map((h) => <th key={h} scope="col" className="meta border-b border-hair px-1 py-0.5 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="border-b border-hair px-1 py-0.5 font-normal">{c}</th> : <td key={j} className="tabular border-b border-hair px-1 py-0.5">{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
