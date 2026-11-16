import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SeverityMark } from '@/components/common/Badge'
import { ButtonLink } from '@/components/common/Button'
import { ConfidenceBreakdownView } from '@/components/common/Confidence'
import { Icon } from '@/components/common/Icon'
import { ReportRowSkeleton, Skeleton } from '@/components/common/Skeleton'
import { Container } from '@/components/layout/Layout'
import { CategoryGlyph, ReportRow } from '@/components/reports/ReportRow'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { ReportDetail, RouteResponse } from '@/types'
import { cx } from '@/utils/cx'
import { distance, hours, ISSUE_STATUS_LABEL, minutes, pct, timeAgo } from '@/utils/format'

// Union Square, either side of the reported missing curb cut at Broadway & E 14th St.
const DEMO_ROUTE = { from: [40.7338, -73.9925] as [number, number], to: [40.7362, -73.9893] as [number, number] }

export function Home() {
  useDocumentTitle('')
  return (
    <>
      <Hero />
      <RecentReports />
      <Lifecycle />
      <RouteComparison />
      <Figures />
      <Contribute />
    </>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  const overview = useAsync(() => api.overview(), [])
  const featured = useAsync(async () => {
    const page = await api.reports({ status: ['open'], sort: 'confidence', limit: 1 })
    return page.items[0] ? api.report(page.items[0].id) : null
  }, [])

  return (
    <section className="border-b border-hair" aria-labelledby="hero-title">
      <Container className="grid gap-6 pb-8 pt-6 md:grid-cols-12 md:pb-12 md:pt-12">
        <div className="md:col-span-7">
          <p className="meta">Midtown &amp; Lower Manhattan · live conditions</p>
          <h1 id="hero-title" className="mt-2 text-4xl leading-[1.08] tracking-[-0.025em] sm:text-5xl">
            Know which ramps, elevators and curb cuts are working <em className="font-normal">before</em> you leave.
          </h1>
          <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
            AccessSignal collects reports from people who rely on them every day, checks them against each other, and
            plans step-free routes around whatever is broken this morning.
          </p>
          <div className="mt-4 flex flex-wrap gap-1">
            <ButtonLink to="/map" variant="primary" size="lg">
              Open the map
            </ButtonLink>
            <ButtonLink to="/route" variant="secondary" size="lg">
              Plan a step-free route
            </ButtonLink>
          </div>
          <p className="mt-3 text-sm text-muted" aria-live="polite">
            {overview.data ? (
              <>
                <span className="tabular text-ink">{overview.data.open_reports}</span> open barriers,{' '}
                <span className="tabular text-signal-deep">{overview.data.critical_open}</span> critical.{' '}
                <span className="tabular text-ink">{overview.data.reports_last_30d}</span> new reports in the last 30 days from{' '}
                {overview.data.contributors} contributors.
              </>
            ) : (
              <Skeleton className="inline-block h-[14px] w-[320px] max-w-full align-middle" />
            )}
          </p>
        </div>

        <div className="relative md:col-span-5 md:pt-4">
          {featured.loading ? <FeaturedSkeleton /> : featured.data ? <FeaturedReport report={featured.data} /> : null}
        </div>
      </Container>
    </section>
  )
}

function FeaturedSkeleton() {
  return (
    <div className="border border-hair bg-paper-raised p-3" aria-hidden>
      <Skeleton className="h-[12px] w-[50%]" />
      <Skeleton className="mt-1 h-[24px] w-[80%]" />
      <Skeleton className="mt-3 h-[40px] w-[30%]" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="mt-2 h-[28px] w-full" />
      ))}
    </div>
  )
}

function FeaturedReport({ report: r }: { report: ReportDetail }) {
  const t = useTaxonomy()
  const second = r.corroborating[0]
  return (
    <figure className="fade-up">
      {/* The corroborating report sits behind, offset, the way a stack of filed reports would. */}
      {second && (
        <div aria-hidden className="absolute -right-1 top-1 hidden h-[calc(100%-48px)] w-[calc(100%-24px)] border border-hair bg-paper-sunk md:block" />
      )}
      <article className="relative border border-rule bg-paper-raised">
        <header className="border-b border-hair px-3 py-2">
          <p className="meta flex items-center gap-1">
            <CategoryGlyph category={r.category} />
            Most corroborated open report
          </p>
          <h2 className="mt-1 font-sans text-lg font-medium leading-snug">
            <Link to={`/reports/${r.id}`} className="no-underline hover:underline">
              {subLabel(t, r.category, r.subcategory)}
            </Link>
          </h2>
          <p className="text-sm text-muted">
            {r.place_name ?? r.address} · {timeAgo(r.reported_at)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <SeverityMark value={r.severity_score} />
            {r.issue_status && <span className="text-sm text-muted">Issue {ISSUE_STATUS_LABEL[r.issue_status]?.toLowerCase()}</span>}
          </div>
        </header>
        <div className="px-3 py-2">
          <ConfidenceBreakdownView data={r.confidence_breakdown} />
        </div>
      </article>
      <figcaption className="mt-1 text-sm text-muted">
        Live from the report queue. Every score shows the reasons behind it.{' '}
        <Link to="/methodology">How scoring works</Link>
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------ recent */

function RecentReports() {
  const { data, loading } = useAsync(() => api.reports({ status: ['open'], sort: 'recent', limit: 5 }), [])
  return (
    <section aria-labelledby="recent-title">
      <Container className="grid gap-4 py-8 md:grid-cols-12 md:py-12">
        <div className="md:col-span-4">
          <div className="md:sticky md:top-[96px]">
            <h2 id="recent-title" className="text-3xl leading-snug tracking-[-0.015em]">
              Reported in the last few days
            </h2>
            <p className="mt-1 text-muted">
              Newest first. Low-confidence reports are shown too, so you can confirm or dispute them.
            </p>
            <Link to="/reports" className="mt-2 inline-flex min-h-touch items-center gap-0.5 text-sm">
              All reports <Icon name="arrowRight" size={16} />
            </Link>
          </div>
        </div>
        <div className="md:col-span-7 md:col-start-6">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <ReportRowSkeleton key={i} />)
            : data?.items.map((r) => <ReportRow key={r.id} report={r} />)}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ lifecycle */

const STEPS: { status: string; who: string; what: string; you: string }[] = [
  { status: 'reported', who: 'Anyone with an account', what: 'A report arrives with a location, a category and usually a photo or voice note. The local AI model suggests a category; the reporter picks the final one.', you: 'The barrier appears on the map straight away, marked low confidence.' },
  { status: 'under_review', who: 'Access Monitor, then staff', what: 'The intake agent checks for missing evidence and nearby duplicates and writes its findings into the audit trail. Staff see the report in their queue.', you: 'Other people nearby are asked whether they see it too.' },
  { status: 'confirmed', who: 'Infrastructure staff', what: 'Staff confirm the barrier, usually after independent reports or a call to the site owner.', you: 'Wheelchair routes now avoid the segment completely.' },
  { status: 'assigned', who: 'Infrastructure staff', what: 'The issue is assigned to a named person at the agency or property responsible.', you: 'The report shows who is handling it.' },
  { status: 'in_progress', who: 'The assignee', what: 'Work has started. Notes from the crew are added to the audit trail.', you: 'Status updates appear on the report page.' },
  { status: 'resolved', who: 'The assignee', what: 'The fix is described, with a photo where possible. A resolution can’t be saved without a description of what was done.', you: 'The place profile shows the feature working again, pending confirmation.' },
  { status: 'reverification', who: 'The community', what: 'A week later, the stale-report agent asks people nearby to confirm the fix. If someone says the barrier is back, the issue reopens.', you: 'You can answer “still there” or “cleared” on the report.' },
]

function Lifecycle() {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  return (
    <section className="border-y border-hair bg-paper-sunk" aria-labelledby="life-title">
      <Container className="py-8 md:py-12">
        <div className="grid gap-2 md:grid-cols-12">
          <h2 id="life-title" className="text-3xl leading-snug tracking-[-0.015em] md:col-span-6">
            From a report to a repair
          </h2>
          <p className="text-muted md:col-span-5 md:col-start-8">
            Seven states, each with a named person or agent responsible. Nothing closes until someone on the street
            agrees it’s fixed.
          </p>
        </div>
        <div role="tablist" aria-label="Issue stages" className="scroll-tray mt-4 flex border-b border-rule">
          {STEPS.map((s, idx) => (
            <button
              key={s.status}
              role="tab"
              id={`tab-${s.status}`}
              aria-selected={i === idx}
              aria-controls="life-panel"
              tabIndex={i === idx ? 0 : -1}
              onClick={() => setI(idx)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setI((v) => (v + 1) % STEPS.length)
                if (e.key === 'ArrowLeft') setI((v) => (v - 1 + STEPS.length) % STEPS.length)
              }}
              className={cx(
                'relative flex min-h-touch shrink-0 items-center gap-1 px-2 text-sm transition-colors duration-150',
                i === idx ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:bg-signal' : 'text-muted hover:text-ink',
              )}
            >
              <span className="tabular font-mono text-xs">{String(idx + 1).padStart(2, '0')}</span>
              {ISSUE_STATUS_LABEL[s.status]}
            </button>
          ))}
        </div>
        <div id="life-panel" role="tabpanel" aria-labelledby={`tab-${step.status}`} className="grid gap-4 pt-4 md:grid-cols-12" key={step.status}>
          <div className="fade-up md:col-span-6">
            <p className="meta">Who acts</p>
            <p className="mt-0.5 font-display text-2xl">{step.who}</p>
            <p className="mt-2 max-w-prose leading-relaxed">{step.what}</p>
          </div>
          <div className="fade-up border-l border-rule pl-3 md:col-span-4 md:col-start-9">
            <p className="meta">What you see</p>
            <p className="mt-0.5 leading-relaxed">{step.you}</p>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ routing */

function RouteComparison() {
  const { data, loading, error } = useAsync(async () => {
    const [std, wc] = await Promise.all([
      api.route(DEMO_ROUTE.from, DEMO_ROUTE.to, 'standard', false),
      api.route(DEMO_ROUTE.from, DEMO_ROUTE.to, 'wheelchair', false),
    ])
    return { std, wc } as { std: RouteResponse; wc: RouteResponse }
  }, [])
  const rows = data
    ? [
        { label: 'Shortest walking route', r: data.std.routes[0] },
        { label: 'Wheelchair route', r: data.wc.routes[0] },
      ]
    : []
  const q = `?from=${DEMO_ROUTE.from.join(',')}&to=${DEMO_ROUTE.to.join(',')}&profile=wheelchair`

  return (
    <section aria-labelledby="route-title">
      <Container className="grid gap-6 py-8 md:grid-cols-12 md:py-12">
        <div className="md:order-2 md:col-span-4 md:col-start-9">
          <p className="meta">Routing</p>
          <h2 id="route-title" className="mt-1 text-3xl leading-snug tracking-[-0.015em]">
            Routes that know about this week’s barriers
          </h2>
          <p className="mt-2 leading-relaxed text-muted">
            Crossing Union Square from Broadway to 14th Street. A sidewalk renovation removed the curb cut on the
            southwest corner five days ago. The walking route goes straight over it; the wheelchair route doesn’t.
          </p>
          <Link to={`/route${q}`} className="mt-2 inline-flex min-h-touch items-center gap-0.5 text-sm">
            Open this route <Icon name="arrowRight" size={16} />
          </Link>
        </div>
        <div className="md:order-1 md:col-span-7">
          <div className="scroll-tray border border-hair bg-paper-raised" tabIndex={0} role="region" aria-label="Route comparison table, scrolls sideways on small screens">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Comparison of walking and wheelchair routes across Union Square</caption>
              <thead>
                <tr className="border-b border-hair">
                  <th scope="col" className="meta px-2 py-1 font-normal">Profile</th>
                  <th scope="col" className="meta px-2 py-1 text-right font-normal">Distance</th>
                  <th scope="col" className="meta px-2 py-1 text-right font-normal">Time</th>
                  <th scope="col" className="meta px-2 py-1 text-right font-normal">Barriers on route</th>
                  <th scope="col" className="meta px-2 py-1 text-right font-normal">Missing data</th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  [0, 1].map((i) => (
                    <tr key={i} className="border-b border-hair">
                      {[0, 1, 2, 3, 4].map((j) => (
                        <td key={j} className="px-2 py-2">
                          <Skeleton className="h-[14px]" />
                        </td>
                      ))}
                    </tr>
                  ))}
                {rows.map(({ label, r }) => (
                  <tr key={label} className="border-b border-hair last:border-0">
                    <th scope="row" className="px-2 py-2 font-medium">{label}</th>
                    <td className="tabular px-2 py-2 text-right">{distance(r.distance_m)}</td>
                    <td className="tabular px-2 py-2 text-right">{minutes(r.duration_min)}</td>
                    <td className={cx('tabular px-2 py-2 text-right', r.barriers_on_route > 0 && 'font-medium text-signal-deep')}>
                      {r.barriers_on_route}
                    </td>
                    <td className="tabular px-2 py-2 text-right">{pct(r.unknown_share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="mt-1 text-sm text-muted">Route comparison unavailable: {error.message}</p>}
          {data && (
            <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
              {data.wc.routes[0].explanation.map((e) => (
                <li key={e} className="flex gap-1">
                  <span aria-hidden className="mt-[9px] h-px w-1 shrink-0 bg-muted" />
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ figures */

function Figures() {
  const ov = useAsync(() => api.overview(), [])
  const cov = useAsync(() => api.coverage(), [])
  const quote = useAsync(async () => {
    const page = await api.reports({ status: ['open'], sort: 'severity', limit: 10 })
    return page.items.filter((r) => r.description.length > 90).sort((a, b) => b.description.length - a.description.length)[0] ?? null
  }, [])
  const o = ov.data
  return (
    <section className="border-t border-hair" aria-labelledby="figures-title">
      <Container className="py-8 md:py-12">
        <h2 id="figures-title" className="sr-only">
          The numbers so far
        </h2>
        <div className="grid gap-6 md:grid-cols-12">
          <Figure className="md:col-span-4" value={o ? hours(o.median_resolution_hours) : null} label="median time from report to repair">
            Measured from the first report to the moment staff mark the issue resolved, across {o?.resolved_total ?? '…'} resolved issues.
          </Figure>
          <Figure className="md:col-span-3 md:col-start-6 md:mt-8" value={o ? `${o.places_with_data} of ${o.places_total}` : null} label="places with community data">
            The rest only have what OpenStreetMap volunteers have tagged, which is often nothing.
          </Figure>
          <Figure className="md:col-span-3 md:col-start-10" value={cov.data ? String(cov.data.summary.cells_without_data) : null} label="blocks with no accessibility data">
            Out of {cov.data?.summary.cells ?? '…'} walkable blocks of roughly 250 m in the service area. They’re the shaded cells on the coverage map.
          </Figure>
        </div>

        {quote.data && (
          <figure className="relative mt-12 md:ml-[25%] md:max-w-[56ch]">
            <span aria-hidden className="absolute -left-3 top-0 hidden h-full w-px bg-signal md:block" />
            <blockquote className="font-display text-2xl italic leading-snug md:text-3xl">“{quote.data.description}”</blockquote>
            <figcaption className="mt-2 text-sm text-muted">
              From a{' '}
              <Link to={`/reports/${quote.data.id}`}>report filed {timeAgo(quote.data.reported_at)}</Link>
              {quote.data.address && <> at {quote.data.address}</>}
            </figcaption>
          </figure>
        )}
      </Container>
    </section>
  )
}

function Figure({ value, label, children, className }: { value: string | null; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="font-display text-5xl leading-none tracking-[-0.03em] tabular">
        {value ?? <Skeleton className="inline-block h-[56px] w-[140px]" />}
      </p>
      <p className="mt-1 font-medium">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ contribute */

function Contribute() {
  return (
    <section className="border-t border-hair" aria-labelledby="contrib-title">
      <Container className="grid gap-4 py-8 md:grid-cols-12 md:py-12">
        <div className="md:col-span-6">
          <h2 id="contrib-title" className="text-3xl leading-snug tracking-[-0.015em]">
            Orchard Street has no data at all
          </h2>
          <p className="mt-2 max-w-prose leading-relaxed text-muted">
            Nobody has reported anything on the residential blocks between Rivington and Stanton. That might mean
            every curb cut works, or that nobody has looked. If you’re nearby, a two-minute report helps the next person
            plan their trip.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            <ButtonLink to="/report?lat=40.72060&lng=-73.98930" variant="primary">
              Report from Orchard St
            </ButtonLink>
            <ButtonLink to="/analytics#coverage" variant="ghost">
              See all gaps
            </ButtonLink>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm md:col-span-5 md:col-start-8">
          <div className="border-t border-hair pt-1">
            <dt className="meta">Map data</dt>
            <dd className="mt-0.5">OpenStreetMap, 24,500 path segments</dd>
          </div>
          <div className="border-t border-hair pt-1">
            <dt className="meta">AI</dt>
            <dd className="mt-0.5">Gemma on local hardware, no cloud calls</dd>
          </div>
          <div className="border-t border-hair pt-1">
            <dt className="meta">Cost to run</dt>
            <dd className="mt-0.5">$0 in licences or API keys</dd>
          </div>
          <div className="border-t border-hair pt-1">
            <dt className="meta">Licence</dt>
            <dd className="mt-0.5">MIT code, ODbL data</dd>
          </div>
        </dl>
      </Container>
    </section>
  )
}
