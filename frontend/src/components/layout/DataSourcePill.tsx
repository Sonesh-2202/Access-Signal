import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useDataSource } from '@/stores/dataSource'

/**
 * Shown only when the API is unreachable and pages are reading the local dataset.
 * Quiet by design: a status, not an error.
 */
export function DataSourcePill() {
  const { mode, reason } = useDataSource()
  const still = useReducedMotion()
  return (
    <AnimatePresence>
      {mode === 'demo' && (
        <motion.p
          role="status"
          initial={still ? false : { opacity: 0, y: -4, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          title={`The AccessSignal API is not reachable${reason ? ` (${reason})` : ''}. Pages are showing a local Midtown and Lower Manhattan dataset.`}
          className="inline-flex h-[28px] items-center gap-[6px] whitespace-nowrap rounded-full border border-stone-300/80 bg-paper-sunk pl-[10px] pr-[12px] text-xs text-ink"
        >
          <span aria-hidden className="relative flex h-[7px] w-[7px]">
            <span className="absolute inset-0 animate-[pill-ping_2.4s_var(--ease-out)_infinite] rounded-full bg-ok/40" />
            <span className="relative h-[7px] w-[7px] rounded-full bg-ok" />
          </span>
          <span className="hidden xl:inline">Live Demo Dataset</span>
          <span className="xl:hidden">Demo data</span>
        </motion.p>
      )}
    </AnimatePresence>
  )
}
