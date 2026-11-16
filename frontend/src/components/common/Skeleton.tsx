import { cx } from '@/utils/cx'

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx('skeleton block', className)} style={style} />
}

/** Matches the footprint of <ReportRow/>: meta line, title, two lines of text. */
export function ReportRowSkeleton() {
  return (
    <div className="flex flex-col gap-1 border-b border-hair py-2" aria-hidden>
      <Skeleton className="h-[12px] w-[40%]" />
      <Skeleton className="h-[20px] w-[70%]" />
      <Skeleton className="h-[14px] w-[95%]" />
      <Skeleton className="h-[14px] w-[60%]" />
    </div>
  )
}

export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr aria-hidden>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="border-b border-hair px-2 py-2">
          <Skeleton className="h-[14px]" style={{ width: `${50 + ((i * 37) % 45)}%` }} />
        </td>
      ))}
    </tr>
  )
}

export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
