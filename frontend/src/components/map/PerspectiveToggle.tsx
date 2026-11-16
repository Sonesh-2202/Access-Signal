import { motion, useReducedMotion } from 'framer-motion'
import { useId } from 'react'
import { cx } from '@/utils/cx'

const OPTIONS = [
  { value: false, label: '2D Flat', short: '2D' },
  { value: true, label: '3D Street Perspective', short: '3D' },
] as const

/**
 * Floating pill over the map. A radio group, so arrow keys move between the two views
 * and screen readers announce the current one.
 */
export function PerspectiveToggle({ value, onChange, className }: { value: boolean; onChange: (v: boolean) => void; className?: string }) {
  const id = useId()
  const still = useReducedMotion()
  return (
    <div
      role="radiogroup"
      aria-label="Map perspective"
      className={cx(
        'z-10 inline-flex rounded-full border border-stone-300/80 bg-paper/75 p-[3px] shadow-[0_1px_0_rgba(26,25,23,0.04),0_10px_28px_-14px_rgba(26,25,23,0.45)] backdrop-blur-[10px] backdrop-saturate-150',
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault()
                onChange(!value)
                const sib = (e.currentTarget.parentElement?.querySelectorAll('button')[value ? 0 : 1]) as HTMLButtonElement | undefined
                sib?.focus()
              }
            }}
            className={cx(
              'relative flex min-h-[36px] items-center rounded-full px-[14px] text-xs font-medium transition-colors duration-150 active:scale-[0.97]',
              active ? 'text-paper' : 'text-ink/70 hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-thumb`}
                className="absolute inset-0 rounded-full bg-ink"
                transition={still ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
              />
            )}
            <span className="relative hidden sm:inline">{o.label}</span>
            <span className="relative sm:hidden">{o.short}</span>
          </button>
        )
      })}
    </div>
  )
}
