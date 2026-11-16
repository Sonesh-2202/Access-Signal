import { animate, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/**
 * Counts up to `value` the first time it scrolls into view. The final number is in the
 * DOM from the start (sr-only), so screen readers never hear the intermediate values.
 */
export function CountUp({ value, decimals = 0, duration = 1.1, suffix = '', className }: { value: number; decimals?: number; duration?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, margin: '-40px' })
  const still = useReducedMotion()
  const [shown, setShown] = useState(still ? value : 0)

  useEffect(() => {
    if (!seen) return
    if (still) return setShown(value)
    const c = animate(0, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setShown })
    return () => c.stop()
  }, [seen, value, duration, still])

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (
    <span ref={ref} className={className}>
      <span aria-hidden className="tabular">
        {fmt(shown)}
        {suffix}
      </span>
      <span className="sr-only">
        {fmt(value)}
        {suffix}
      </span>
    </span>
  )
}
