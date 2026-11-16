import { useId, useState } from 'react'
import { cx } from '@/utils/cx'

interface Series {
  name: string
  values: number[]
  style: 'solid' | 'dashed'
  accent?: boolean
}

/**
 * Weekly line chart drawn in SVG. Always paired with a data table (in a disclosure)
 * so the numbers are available without the graphic.
 */
export function LineChart({ labels, series, title, height = 220 }: { labels: string[]; series: Series[]; title: string; height?: number }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = height
  const pad = { l: 32, r: 8, t: 12, b: 28 }
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const niceMax = Math.ceil(max / 5) * 5
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, labels.length - 1)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax)
  const ticks = [0, niceMax / 2, niceMax]
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <figure aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">{title}</figcaption>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <svg width="24" height="8">
              <line x1="0" y1="4" x2="24" y2="4" stroke={s.accent ? '#A8360F' : '#1C1B19'} strokeWidth="2" strokeDasharray={s.style === 'dashed' ? '4 3' : undefined} />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${title}. Data table follows.`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#1C1B19" strokeOpacity={t === 0 ? 0.3 : 0.08} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono" fontSize="10">{t}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % Math.ceil(labels.length / 6) === 0 ? (
            <text key={l} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i >= labels.length - 2 ? 'end' : 'middle'} className="fill-muted font-mono" fontSize="10">{fmt(l)}</text>
          ) : null,
        )}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.accent ? '#A8360F' : '#1C1B19'}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray={s.style === 'dashed' ? '5 4' : undefined}
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
        {labels.map((_, i) => (
          <rect key={i} x={x(i) - (W / labels.length) / 2} y={pad.t} width={W / labels.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#1C1B19" strokeOpacity="0.25" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="3.5" fill="#FAF8F3" stroke={s.accent ? '#A8360F' : '#1C1B19'} strokeWidth="2" />
            ))}
            <text x={Math.min(x(hover) + 8, W - 120)} y={pad.t + 12} fontSize="11" className="fill-ink font-mono">
              {fmt(labels[hover])}: {series.map((s) => `${s.values[hover]} ${s.name.toLowerCase()}`).join(', ')}
            </text>
          </g>
        )}
      </svg>
      <DataTable caption={title} head={['Week of', ...series.map((s) => s.name)]} rows={labels.map((l, i) => [fmt(l), ...series.map((s) => s.values[i])])} />
    </figure>
  )
}

export function BarList({ rows, title, format = (v: number) => String(v), accentKey }: { rows: { key: string; label: string; value: number; note?: string }[]; title: string; format?: (v: number) => string; accentKey?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <dl className="flex flex-col">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[120px_1fr_auto] items-center gap-x-2 border-t border-hair py-1 sm:grid-cols-[160px_1fr_auto]">
            <dt className="truncate text-sm">{r.label}</dt>
            <dd className="relative h-[10px] bg-hair" aria-hidden>
              <span className={cx('absolute inset-y-0 left-0', r.key === accentKey ? 'bg-signal' : 'bg-ink')} style={{ width: `${(r.value / max) * 100}%` }} />
            </dd>
            <dd className="tabular text-right font-mono text-xs">
              {format(r.value)}
              {r.note && <span className="ml-1 text-muted">{r.note}</span>}
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
