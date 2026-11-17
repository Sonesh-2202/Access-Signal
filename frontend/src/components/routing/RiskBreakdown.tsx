import type { RouteRisk } from '@/types'

/** The corridor risk behind a reliable route, as text: the summary, each risky street and its inputs. */
export function RiskBreakdown({ risk }: { risk: RouteRisk | null | undefined }) {
  if (!risk?.enabled) return null
  return (
    <section aria-labelledby="risk-heading" className="border-t border-hair pt-2">
      <h3 id="risk-heading" className="meta">Corridor risk</h3>
      <p className="mt-0.5 text-sm">{risk.summary}</p>
      {risk.on_route.length === 0 ? (
        <p className="mt-0.5 text-sm text-muted">No street on this route has high corridor risk.</p>
      ) : (
        <ul className="mt-0.5 flex flex-col gap-0.5 text-sm">
          {risk.on_route.map((e) => (
            <li key={e.street}>
              {e.street}: risk {e.risk.toFixed(2)} ({e.breakdown.hotspots} hotspot{e.breakdown.hotspots === 1 ? '' : 's'}, {e.breakdown.open_issues} open report{e.breakdown.open_issues === 1 ? '' : 's'}, mean confidence {e.breakdown.mean_confidence.toFixed(2)}, time factor {e.breakdown.time_multiplier.toFixed(2)})
            </li>
          ))}
        </ul>
      )}
      <p className="mt-0.5 text-xs text-muted">
        How this is scored: <a className="underline" href="/methodology#reliable-routes">methodology</a>.
      </p>
    </section>
  )
}

