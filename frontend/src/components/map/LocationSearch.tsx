import { useEffect, useId, useRef, useState } from 'react'
import { geocode } from '@/services/api'
import { useDebounced } from '@/hooks/useAsync'
import type { GeocodeResult } from '@/types'
import { cx } from '@/utils/cx'
import { Icon } from '../common/Icon'

interface Props {
  label: string
  placeholder?: string
  onSelect: (r: GeocodeResult) => void
  value?: string
  hideLabel?: boolean
  className?: string
  /** Extra local suggestions shown before Nominatim results (e.g. known places). */
  presets?: GeocodeResult[]
}

/** ARIA 1.2 combobox with listbox popup. Arrow keys move, Enter selects, Escape closes. */
export function LocationSearch({ label, placeholder, onSelect, value, hideLabel, className, presets = [] }: Props) {
  const id = useId()
  const [q, setQ] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const dq = useDebounced(q, 350)
  const typed = useRef(false)

  useEffect(() => {
    if (value !== undefined) setQ(value)
  }, [value])

  useEffect(() => {
    if (!typed.current) return
    const ctrl = new AbortController()
    const local = presets.filter((p) => dq.length >= 2 && p.label.toLowerCase().includes(dq.toLowerCase())).slice(0, 4)
    setResults(local)
    if (dq.trim().length < 3) {
      setLoading(false)
      return
    }
    setLoading(true)
    geocode(dq, ctrl.signal)
      .then((r) => setResults([...local, ...r.filter((x) => !local.some((l) => l.label === x.label))]))
      .catch(() => undefined)
      .finally(() => setLoading(false))
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq])

  function choose(r: GeocodeResult) {
    typed.current = false
    setQ(r.label)
    setOpen(false)
    setActive(-1)
    onSelect(r)
  }

  const listId = `${id}-list`
  const show = open && (results.length > 0 || loading || dq.length >= 3)

  return (
    <div className={cx('relative', className)}>
      <label htmlFor={id} className={cx('mb-0.5 block text-sm font-medium', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <Icon name="search" size={18} className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={id}
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            typed.current = true
            setQ(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => q && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(results.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && active >= 0 && results[active]) {
              e.preventDefault()
              choose(results[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          className="min-h-touch w-full rounded-sm border border-rule bg-paper-raised pl-5 pr-2 text-base placeholder:text-muted/80 hover:border-ink/40 focus-visible:border-signal"
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        className={cx(
          'absolute left-0 right-0 top-full z-20 mt-0.5 max-h-[280px] overflow-y-auto rounded-sm border border-hair bg-paper-raised',
          !show && 'hidden',
        )}
      >
        {loading && results.length === 0 && (
          <li className="px-2 py-1 text-sm text-muted" role="presentation">
            Searching…
          </li>
        )}
        {!loading && results.length === 0 && dq.length >= 3 && (
          <li className="px-2 py-1 text-sm text-muted" role="presentation">
            No matches in Midtown or Lower Manhattan
          </li>
        )}
        {results.map((r, i) => (
          <li
            key={`${r.label}-${i}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(r)
            }}
            className={cx('cursor-pointer border-b border-hair px-2 py-1 text-sm last:border-0', i === active ? 'bg-tint' : 'hover:bg-hair')}
          >
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
