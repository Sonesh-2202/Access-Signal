/** The mark is three rising bars (signal strength) with a single signal-orange dot:
 *  one report, then corroboration. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden focusable="false">
        <path d="M3.5 18v-4.5M8.5 18V9.5M13.5 18V5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        <circle cx="18" cy="5.5" r="2.5" fill="#A8360F" />
      </svg>
      <span className="font-display text-xl tracking-[-0.01em]">
        Access<span className="italic">Signal</span>
      </span>
    </span>
  )
}
