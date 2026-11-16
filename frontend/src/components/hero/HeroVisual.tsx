import { motion, useReducedMotion } from 'framer-motion'
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { cx } from '@/utils/cx'
import { hasWebGL } from '@/utils/webgl'
import { HERO_STATS, type HeroRouteMode } from './heroGeometry'

// three.js is ~600 KB; load it after the headline has painted.
const HeroCityScene = lazy(() => import('./HeroCityScene'))

const MODES: { value: HeroRouteMode; label: string; short: string }[] = [
  { value: 'standard', label: 'Standard Route (Blocked)', short: 'Standard' },
  { value: 'stepfree', label: 'AccessSignal Step-Free Route', short: 'Step-free' },
]

function SceneSkeleton() {
  return (
    <div aria-hidden className="absolute inset-0 flex items-center justify-center">
      <div className="skeleton h-[46%] w-[62%] rotate-[-30deg] skew-x-[30deg] rounded-md opacity-70" />
    </div>
  )
}

function NoWebGL() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center border border-hair bg-paper-sunk p-3">
      <p className="meta">Fig. 1</p>
      <p className="mt-1 font-display text-xl">14th St &amp; Broadway, this morning</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        <li><span className="font-medium text-signal-deep">Elevator outage, 14th St.</span> Blocks the direct route.</li>
        <li><span className="font-medium text-ok">Ramp verified, Broadway.</span> The step-free route crosses here.</li>
        <li><span className="font-medium text-warn-deep">Curb cut under repair.</span> Avoided by both routes.</li>
      </ul>
    </div>
  )
}

export function HeroVisual() {
  const id = useId()
  const still = useReducedMotion()
  const [mode, setMode] = useState<HeroRouteMode>('standard')
  const [inView, setInView] = useState(true)
  const [webgl] = useState(() => hasWebGL())
  const touched = useRef(false)
  const box = useRef<HTMLDivElement>(null)

  // Pause rendering when scrolled away; there is no reason to spend GPU on it.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Tell the story once: show the blocked route, then the detour. Never after the user picks.
  useEffect(() => {
    if (still) return
    const t = setTimeout(() => {
      if (!touched.current) setMode('stepfree')
    }, 3200)
    return () => clearTimeout(t)
  }, [still])

  function choose(m: HeroRouteMode) {
    touched.current = true
    setMode(m)
  }

  const s = HERO_STATS
  const extraM = s.stepfree.metres - s.standard.metres
  const extraMin = s.stepfree.minutes - s.standard.minutes

  return (
    <figure className="relative" aria-labelledby={`${id}-cap`}>
      <div
        role="radiogroup"
        aria-label="Route shown in the illustration"
        className="relative z-10 inline-flex rounded-full border border-stone-300/80 bg-paper-raised p-[3px]"
      >
        {MODES.map((m) => {
          const active = mode === m.value
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(m.value)}
              onKeyDown={(e) => {
                if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                  e.preventDefault()
                  const next = mode === 'standard' ? 'stepfree' : 'standard'
                  choose(next)
                  ;(e.currentTarget.parentElement?.querySelectorAll('button')[next === 'standard' ? 0 : 1] as HTMLButtonElement | undefined)?.focus()
                }
              }}
              className={cx(
                'relative flex min-h-touch items-center gap-[6px] rounded-full px-2 text-sm transition-colors duration-150 active:scale-[0.97]',
                active ? 'text-paper' : 'text-muted hover:text-ink',
              )}
            >
              {active && (
                <motion.span
                  layoutId={`${id}-thumb`}
                  className={cx('absolute inset-0 rounded-full', m.value === 'standard' ? 'bg-signal' : 'bg-ok')}
                  transition={still ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 38, mass: 0.8 }}
                />
              )}
              <span aria-hidden className="relative">
                <svg width="18" height="6">
                  {m.value === 'standard' ? (
                    <line x1="1" y1="3" x2="17" y2="3" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3.5 2.5" />
                  ) : (
                    <line x1="1" y1="3" x2="17" y2="3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  )}
                </svg>
              </span>
              <span className="relative hidden sm:inline">{m.label}</span>
              <span className="relative sm:hidden">{m.short}</span>
            </button>
          )
        })}
      </div>

      <div ref={box} className="relative -mx-2 mt-1 h-[380px] sm:mx-0 sm:h-[480px] lg:h-[520px]">
        {webgl ? (
          <Suspense fallback={<SceneSkeleton />}>
            <HeroCityScene mode={mode} running={inView} />
          </Suspense>
        ) : (
          <NoWebGL />
        )}
      </div>

      <figcaption id={`${id}-cap`} className="mt-1 grid gap-x-3 gap-y-0.5 border-t border-hair pt-1 text-sm sm:grid-cols-[auto_1fr]">
        <span className="meta pt-[2px]">Fig. 1</span>
        <span className="text-muted" aria-live="polite">
          {mode === 'standard' ? (
            <>
              <span className="font-medium text-ink">Standard route:</span> <span className="tabular">{s.standard.metres} m</span>, about{' '}
              <span className="tabular">{s.standard.minutes} min</span>, straight into the elevator outage on the north-east corner.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">Step-free route:</span> <span className="tabular">+{extraM} m</span>,{' '}
              <span className="tabular">+{extraMin} min</span>. Crosses at the verified ramp mid-block and skips both reported corners.
            </>
          )}
        </span>
      </figcaption>
    </figure>
  )
}
