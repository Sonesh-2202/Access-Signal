import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IssueStatusBadge, SeverityMark } from '@/components/common/Badge'
import { ButtonLink } from '@/components/common/Button'
import { ConfidenceBreakdownView, ConfidenceMeter } from '@/components/common/Confidence'
import { CountUp } from '@/components/common/CountUp'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { NearbyCard } from '@/components/alerts/NearbyCard'
import { HeroVisual } from '@/components/hero/HeroVisual'
import { Container } from '@/components/layout/Layout'
import { CategoryGlyph } from '@/components/reports/ReportRow'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { catLabel, subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api, ApiError } from '@/services/api'
import type { ReportDetail, RouteResponse } from '@/types'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { distance, hours, ISSUE_STATUS_LABEL, minutes, pct, timeAgo } from '@/utils/format'

// Union Square, either side of the reported missing curb cut at Broadway & E 14th St.
const DEMO_ROUTE = { from: [40.7338, -73.9925] as [number, number], to: [40.7362, -73.9893] as [number, number] }

const EASE = [0.16, 1, 0.3, 1] as const

export function Home() {
  useDocumentTitle('')
  return (
    <>
      <Hero />
      <NearbyCard />
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
  const o = overview.data
  return (
    <section className="overflow-hidden border-b border-hair" aria-labelledby="hero-title">
      <Container className="grid items-center gap-6 pb-8 pt-6 lg:grid-cols-12 lg:gap-4 lg:pb-10 lg:pt-10">
        <div className="lg:col-span-6">
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
          <dl className="mt-5 grid max-w-[480px] grid-cols-3 border-t border-hair pt-2">
            {[
              { k: 'Open barriers', v: o?.open_reports, tone: 'text-ink' },
              { k: 'Critical', v: o?.critical_open, tone: 'text-signal-deep' },
              { k: 'Reports, 30 days', v: o?.reports_last_30d, tone: 'text-ink' },
            ].map((x) => (
              <div key={x.k}>
                <dt className="meta">{x.k}</dt>
                <dd className={cx('mt-0.5 font-display text-3xl leading-none', x.tone)}>
                  {x.v == null ? <Skeleton className="h-[30px] w-[56px]" /> : <CountUp value={x.v} />}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-6">
          <HeroVisual />
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------------ recent */

function RecentReports() {
  const feed = useAsync(async () => {
    const page = await api.reports({ status: ['open'], sort: 'recent', limit: 3 })
    return Promise.all(page.items.map((r) => api.report(r.id)))
  }, [])
  const featured = useAsync(async () => {
    const page = await api.reports({ status: ['open'], sort: 'confidence', limit: 1 })
    return page.items[0] ? api.report(page.items[0].id) : null
  }, [])

  return (
    <section aria-labelledby="recent-title">
      <Container className="grid gap-6 py-8 md:grid-cols-12 md:py-12">
        <div className="md:col-span-5 lg:col-span-4">
          <h2 id="recent-title" className="text-3xl leading-snug tracking-[-0.015em]">
            Reported in the last few days
          </h2>
          <p className="mt-1 text-muted">
            Newest first. If you’re near one of these, tell the next person whether it’s still there.
          </p>
          <Link to="/reports" className="mt-2 inline-flex min-h-touch items-center gap-0.5 text-sm">
            All reports <Icon name="arrowRight" size={16} />
          </Link>
          <div className="mt-4 hidden md:block">
            {featured.data && <FeaturedReport report={featured.data} />}
          </div>
        </div>
        <div className="md:col-span-7 md:col-start-6 lg:col-start-6">
          <ol className="flex flex-col gap-2" aria-label="Latest open reports">
            {feed.loading
              ? [0, 1, 2].map((i) => (
                  <li key={i}>
                    <FeedCardSkeleton />
                  </li>
                ))
              : feed.data?.map((r, i) => (
                  <motion.li key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: i * 0.06, ease: EASE }}>
                    <FeedCard report={r} />
                  </motion.li>
                ))}
          </ol>
        </div>
      </Container>
    </section>
  )
}

function FeedCardSkeleton() {
  return (
    <div className="border border-hair bg-paper-raised p-2" aria-hidden>
      <Skeleton className="h-[12px] w-[35%]" />
      <Skeleton className="mt-1 h-[22px] w-[70%]" />
      <Skeleton className="mt-1 h-[14px] w-[90%]" />
      <Skeleton className="mt-2 h-[40px] w-full" />
    </div>
  )
}

type Vote = 'still' | 'fixed' | null

/** Optimistic confirm/dispute. The count moves on press; the request settles in the background. */
function FeedCard({ report: r }: { report: ReportDetail }) {
  const t = useTaxonomy()
  const still = useReducedMotion()
  const [vote, setVote] = useState<Vote>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const base = { still: r.corroborating.length + 1, fixed: 0 }
  const counts = { still: base.still + (vote === 'still' ? 1 : 0), fixed: base.fixed + (vote === 'fixed' ? 1 : 0) }

  async function cast(v: Exclude<Vote, null>) {
    const prev = vote
    const next = vote === v ? null : v
    setVote(next)
    setNeedsSignIn(false)
    if (!next) return
    announce(next === 'still' ? 'Recorded: still broken' : 'Recorded: fixed')
    try {
      await api.verifyReport(r.id, next === 'still')
    } catch (e) {
      setVote(prev)
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setNeedsSignIn(true)
      announce('Could not save your confirmation')
    }
  }

  const status = r.issue_status
  return (
    <article className="group relative border border-hair bg-paper-raised transition-colors duration-200 hover:border-rule" aria-labelledby={`feed-${r.id}`}>
      <div className="grid grid-cols-[32px_1fr] gap-x-1 px-2 pt-2">
        <CategoryGlyph category={r.category} className="mt-[2px]" />
        <div className="min-w-0">
          <p className="meta flex flex-wrap items-center gap-x-1">
            <span>{catLabel(t, r.category)}</span>
            <span aria-hidden>·</span>
            <time dateTime={r.reported_at} className="tabular">{timeAgo(r.reported_at)}</time>
            {status && status !== 'reported' && (
              <>
                <span aria-hidden>·</span>
                <StatusDot status={status} />
              </>
            )}
          </p>
          <h3 id={`feed-${r.id}`} className="mt-0.5 font-sans text-base font-medium leading-snug">
            <Link to={`/reports/${r.id}`} className="no-underline hover:underline">
              {subLabel(t, r.category, r.subcategory)}
            </Link>
          </h3>
          <p className="text-sm text-muted">{r.address}</p>
          <p className="mt-1 line-clamp-2 text-sm">{r.description}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <SeverityMark value={r.severity_score} />
            <ConfidenceMeter value={r.confidence_score} compact />
            {r.ai_analysis && (
              <span className="tabular font-mono text-[11px] text-muted">
                AI {Math.round(r.ai_analysis.confidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] border-t border-hair">
        <VoteButton active={vote === 'still'} count={counts.still} onClick={() => cast('still')} tone="signal" still={!!still}>
          I’m on the street — still broken
        </VoteButton>
        <VoteButton active={vote === 'fixed'} count={counts.fixed} onClick={() => cast('fixed')} tone="ok" still={!!still} className="border-l border-hair">
          Fixed
        </VoteButton>
      </div>
      {needsSignIn && (
        <p className="border-t border-hair px-2 py-1 text-sm" role="status">
          <Link to={`/login?next=/reports/${r.id}`}>Sign in</Link> to add your confirmation.
        </p>
      )}
    </article>
  )
}

function StatusDot({ status }: { status: string }) {
  const tone = status === 'resolved' || status === 'reverification' ? 'bg-ok' : status === 'under_review' ? 'bg-warn' : 'bg-ink'
  return (
    <span className="inline-flex items-center gap-0.5">
      <span aria-hidden className={cx('h-[6px] w-[6px] rounded-full', tone)} />
      {ISSUE_STATUS_LABEL[status]}
    </span>
  )
}

function VoteButton({ active, count, onClick, tone, still, className, children }: { active: boolean; count: number; onClick: () => void; tone: 'signal' | 'ok'; still: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'flex min-h-[48px] items-center justify-between gap-1 px-2 text-left text-sm transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98]',
        active ? (tone === 'signal' ? 'bg-signal-wash text-signal-deep' : 'bg-ok-wash text-ok') : 'text-ink hover:bg-paper-sunk',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className={cx('flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors duration-150', active ? (tone === 'signal' ? 'border-signal bg-signal text-paper' : 'border-ok bg-ok text-paper') : 'border-rule')}>
          {active && <Icon name="check" size={12} />}
        </span>
        {children}
      </span>
      <span className="relative inline-flex h-[20px] min-w-[2ch] justify-end overflow-hidden font-mono text-sm tabular">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={count}
            initial={still ? false : { y: active ? 14 : -14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={still ? undefined : { y: active ? -14 : 14, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {count}
          </motion.span>
        </AnimatePresence>
        <span className="sr-only"> confirmations</span>
      </span>
    </button>
  )
}

function FeaturedReport({ report: r }: { report: ReportDetail }) {
  const t = useTaxonomy()
  return (
    <figure className="fade-up">
      <article className="relative border border-rule bg-paper-raised">
        <header className="border-b border-hair px-2 py-2">
          <p className="meta flex items-center gap-1">
            <CategoryGlyph category={r.category} />
            Most corroborated open report
          </p>
          <h3 className="mt-1 font-sans text-lg font-medium leading-snug">
            <Link to={`/reports/${r.id}`} className="no-underline hover:underline">
              {subLabel(t, r.category, r.subcategory)}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {r.place_name ?? r.address} · {timeAgo(r.reported_at)}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <SeverityMark value={r.severity_score} />
            {r.issue_status && <IssueStatusBadge status={r.issue_status} />}
          </div>
        </header>
        <div className="px-2 py-2">
          <ConfidenceBreakdownView data={r.confidence_breakdown} />
        </div>
      </article>
      <figcaption className="mt-1 text-sm text-muted">
        Every score shows the reasons behind it. <Link to="/methodology">How scoring works</Link>
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------ lifecycle */

interface Step {
  status: string
  who: string
  accountable: string
  when: string
  what: string
  you: string
}

/** One real-shaped report followed through every stage: the Broadway & E 14th St curb cut. */
const STEPS: Step[] = [
  { status: 'reported', who: 'Anyone with an account', accountable: 'Reporter · Andre W. · photo + voice note', when: 'Mon 08:12', what: 'A report arrives with a location, a category and a photo. A cloud model can suggest a category from the photo; the reporter picks the final one.', you: 'The barrier appears on the map straight away, marked low confidence.' },
  { status: 'under_review', who: 'Infrastructure staff', accountable: 'Staff queue · 2 nearby matches', when: 'Mon 08:13', what: 'Staff review the report in their queue. Similar reports nearby are offered to the reporter before filing, so a duplicate becomes a confirmation instead of a new entry.', you: 'Other people nearby can confirm they see it too.' },
  { status: 'confirmed', who: 'Infrastructure staff', accountable: 'DOT Borough Office · 311 Ticket #89421', when: 'Mon 11:40', what: 'Staff confirm the barrier after three independent reports and a call to the contractor on site.', you: 'Wheelchair routes now avoid the corner completely.' },
  { status: 'assigned', who: 'Infrastructure staff', accountable: 'DOT Sidewalk Inspection · R. Alvarez', when: 'Mon 14:05', what: 'The issue is assigned to a named person at the agency responsible for the curb.', you: 'The report shows who is handling it.' },
  { status: 'in_progress', who: 'The assignee', accountable: 'Contractor crew · temporary ramp ordered', when: 'Tue 07:30', what: 'Work has started. Notes from the crew are added to the audit trail.', you: 'Status updates appear on the report page.' },
  { status: 'resolved', who: 'The assignee', accountable: 'DOT Sidewalk Inspection · fix photo attached', when: 'Wed 16:20', what: 'The fix is described, with a photo. A resolution can’t be saved without a description of what was done.', you: 'The place profile shows the curb cut working again, pending confirmation.' },
  { status: 'reverification', who: 'The community', accountable: 'Community check-ins', when: 'Wed +7 days', what: 'Once a fix is marked done, people nearby are asked to confirm it. If someone says the barrier is back, the issue reopens.', you: 'You can answer “still broken” or “fixed” on the report.' },
]

const STEP_MS = 6500

function Lifecycle() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const still = useReducedMotion()
  const step = STEPS[i]
  const auto = !still && !paused
  const fixed = step.status === 'resolved' || step.status === 'reverification'

  const go = (n: number) => setI((n + STEPS.length) % STEPS.length)

  return (
    <section
      className="border-y border-hair bg-paper-sunk"
      aria-labelledby="life-title"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
    >
      <Container className="py-8 md:py-12">
        <div className="grid gap-2 md:grid-cols-12">
          <h2 id="life-title" className="text-3xl leading-snug tracking-[-0.015em] md:col-span-6">
            From a report to a repair
          </h2>
          <p className="text-muted md:col-span-5 md:col-start-8">
            Seven states, each with a named person or team responsible. Nothing closes until someone on the street
            agrees it’s fixed. Followed here for the Broadway &amp; E 14th St curb cut.
          </p>
        </div>

        <div role="tablist" aria-label="Issue stages" className="scroll-tray mt-4 grid auto-cols-[minmax(132px,1fr)] grid-flow-col">
          {STEPS.map((s, idx) => {
            const active = i === idx
            return (
              <button
                key={s.status}
                role="tab"
                id={`tab-${s.status}`}
                aria-selected={active}
                aria-controls="life-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => go(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault()
                    const n = (idx + (e.key === 'ArrowRight' ? 1 : -1) + STEPS.length) % STEPS.length
                    go(n)
                    ;(e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus()
                  }
                }}
                className={cx(
                  'group relative flex min-h-[64px] flex-col justify-center gap-0.5 px-1 pb-1 pt-1 text-left text-sm transition-colors duration-150 sm:px-2',
                  active ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {/* Track: complete for past stages, filling for the current one. */}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-rule">
                  {idx < i && <span className="absolute inset-0 bg-ink" />}
                  {active && (
                    <span
                      key={`${i}-${still}`}
                      className="absolute inset-y-0 left-0 bg-signal"
                      style={
                        still
                          ? { width: '100%' }
                          : { width: '100%', transformOrigin: 'left', animation: `step-fill ${STEP_MS}ms linear forwards`, animationPlayState: auto ? 'running' : 'paused' }
                      }
                      // The global reduced-motion rule shortens animations to ~0; only a full run advances.
                      onAnimationEnd={(e) => e.elapsedTime * 1000 >= STEP_MS - 50 && go(i + 1)}
                    />
                  )}
                </span>
                <span className={cx('tabular font-mono text-xs', active ? 'text-signal-deep' : 'text-muted')}>{String(idx + 1).padStart(2, '0')}</span>
                <span className="whitespace-nowrap">{ISSUE_STATUS_LABEL[s.status]}</span>
              </button>
            )
          })}
        </div>

        <div id="life-panel" role="tabpanel" aria-labelledby={`tab-${step.status}`} className="pt-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.status}
              className="grid gap-4 md:grid-cols-12"
              initial={still ? false : { opacity: 0, y: 8, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={still ? undefined : { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.14 } }}
              transition={{ duration: 0.26, ease: EASE }}
            >
              <div className="md:col-span-6">
                <p className="meta">Who acts</p>
                <p className="mt-0.5 font-display text-2xl">{step.who}</p>
                <p className="mt-1 inline-flex flex-wrap items-center gap-x-1 rounded-sm border border-stone-300/80 bg-paper-raised px-1 py-0.5 text-sm">
                  <span className="meta">Accountable</span>
                  <span className="tabular">{step.accountable}</span>
                </p>
                <p className="mt-2 max-w-prose leading-relaxed">{step.what}</p>
                <div className="mt-3 border-l border-rule pl-2">
                  <p className="meta">What you see</p>
                  <p className="mt-0.5 leading-relaxed">{step.you}</p>
                </div>
              </div>
              <div className="md:col-span-5 md:col-start-8">
                <EvidencePhoto fixed={fixed} when={step.when} />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </Container>
    </section>
  )
}

/** Illustrated stand-in for the report photo, with the model's reading overlaid. */
function EvidencePhoto({ fixed, when }: { fixed: boolean; when: string }) {
  return (
    <figure className="border border-hair bg-paper-raised p-1">
      <div className="relative">
        <svg viewBox="0 0 400 300" className="block w-full" role="img" aria-label={fixed ? 'Photo of the corner with the curb ramp restored and clear' : 'Photo of the corner with a steel plate covering the curb ramp'}>
          <rect width="400" height="300" fill="#EFECE6" />
          {/* building wall and windows */}
          <rect x="0" y="0" width="400" height="118" fill="#E2DCD1" />
          {[24, 104, 184, 264, 344].map((x) => (
            <rect key={x} x={x} y="22" width="40" height="60" fill="#CFC8BC" stroke="#1A1917" strokeOpacity="0.15" />
          ))}
          {/* sidewalk */}
          <path d="M0 118 H400 V196 H0Z" fill="#E5E0D8" />
          {[60, 150, 240, 330].map((x) => (
            <line key={x} x1={x} y1="118" x2={x - 30} y2="196" stroke="#1A1917" strokeOpacity="0.12" />
          ))}
          {/* curb and road */}
          <path d="M0 196 H400 V206 H0Z" fill="#CFC8BC" />
          <path d="M0 206 H400 V300 H0Z" fill="#3B3936" />
          {[30, 90, 150, 210, 270, 330].map((x) => (
            <rect key={x} x={x} y="236" width="34" height="64" fill="#F1EEE8" opacity="0.85" />
          ))}
          {/* curb ramp */}
          <path d="M150 166 L250 166 L270 206 L130 206 Z" fill="#D6CFC4" stroke="#1A1917" strokeOpacity="0.25" />
          <rect x="140" y="196" width="120" height="10" fill="#D9CBA9" />
          {!fixed && (
            <g>
              <path d="M128 162 L272 160 L286 210 L116 212 Z" fill="#6E6A63" stroke="#1A1917" strokeOpacity="0.5" />
              {[[140, 168], [262, 167], [130, 204], [272, 203]].map(([x, y]) => (
                <circle key={`${x}${y}`} cx={x} cy={y} r="2.5" fill="#4A4743" />
              ))}
              <path d="M116 212 L286 210 L286 216 L116 218 Z" fill="#4A4743" />
            </g>
          )}
          {/* the model's bounding box */}
          <rect
            x={fixed ? 126 : 108}
            y={fixed ? 160 : 152}
            width={fixed ? 150 : 186}
            height={fixed ? 52 : 72}
            fill="none"
            stroke={fixed ? '#1F6E43' : '#B83A24'}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
        <span className={cx('absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-[3px] font-mono text-[11px] text-paper', fixed ? 'bg-ok' : 'bg-signal')}>
          <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-paper/90" />
          {fixed ? 'AI reading: 91% confidence · Curb ramp clear' : 'AI reading: 94% confidence · Curb ramp obstruction'}
        </span>
      </div>
      <figcaption className="flex flex-wrap justify-between gap-x-2 px-0.5 pt-1 text-xs text-muted">
        <span>{fixed ? 'Fix photo, attached by DOT' : 'Reporter’s photo, EXIF stripped on upload'}</span>
        <span className="tabular font-mono">{when} · 40.73500, −73.99090</span>
      </figcaption>
    </figure>
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
                    <th scope="row" className="px-2 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden className={cx('h-[3px] w-2', r.barriers_on_route > 0 ? 'bg-signal' : 'bg-ok')} />
                        {label}
                      </span>
                    </th>
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
          {error && <p className="mt-1 text-sm text-muted">The route comparison couldn’t be calculated just now.</p>}
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
            <dd className="mt-0.5">Cloud models with your own key or a server key, keyword rules when none answers. The AI reads messy text and photos, and can translate a draft. Nothing else.</dd>
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
