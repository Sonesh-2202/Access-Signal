import type { FeatureStatus, PlaceSummary } from '@/types'
import { cx } from '@/utils/cx'
import { PLACE_TYPE_LABEL } from '@/utils/format'

const FEATURE_SHORT: Record<string, string> = {
  step_free_entrance: 'Entrance',
  ramp: 'Ramp',
  elevator: 'Elevator',
  automatic_door: 'Auto door',
  accessible_restroom: 'Restroom',
  tactile_paving: 'Tactile',
  audible_signals: 'Signals',
  hearing_loop: 'Hearing loop',
  accessible_parking: 'Parking',
}

/** Inline feature strip: each known feature as a short word with a status mark. */
export function FeatureStrip({ status }: { status: Record<string, FeatureStatus> }) {
  const entries = Object.entries(status)
  if (!entries.length) return <span className="text-xs text-muted">No accessibility data yet</span>
  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs" aria-label="Accessibility features">
      {entries.map(([k, s]) => (
        <li key={k} className="inline-flex items-center gap-0.5">
          <span
            aria-hidden
            className={cx(
              'inline-block h-[8px] w-[8px]',
              s === 'available' && 'rounded-full bg-ink',
              s === 'limited' && 'rounded-full border-[1.5px] border-ink',
              s === 'unavailable' && 'rotate-45 bg-signal',
              s === 'unknown' && 'rounded-full border border-dashed border-muted',
            )}
          />
          <span className={cx(s === 'unavailable' ? 'text-signal-deep' : 'text-ink')}>
            {FEATURE_SHORT[k] ?? k}
            <span className="sr-only">: {s}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function placeType(p: Pick<PlaceSummary, 'place_type'>) {
  return PLACE_TYPE_LABEL[p.place_type] ?? p.place_type.replace(/_/g, ' ')
}
