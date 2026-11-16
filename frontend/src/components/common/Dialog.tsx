import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon } from './Icon'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** 'sheet' slides from the bottom on small screens; 'modal' is centred everywhere. */
  variant?: 'modal' | 'sheet'
  className?: string
}

/**
 * Native <dialog>: browser-provided focus trapping, Escape handling, inert background
 * and top-layer stacking. Focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, children, variant = 'modal', className }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement
      d.showModal()
    } else if (!open && d.open) {
      d.close()
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cx(
        'max-h-[90vh] w-full overflow-hidden border border-hair bg-paper p-0 text-ink backdrop:bg-ink/40',
        variant === 'sheet'
          ? 'm-0 mt-auto max-w-none rounded-t-md sm:m-auto sm:max-w-[560px] sm:rounded'
          : 'max-w-[560px] rounded',
        className,
      )}
    >
      {open && (
        <div className="fade-up flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-1">
            {variant === 'sheet' && (
              <span aria-hidden className="absolute left-1/2 top-1 h-0.5 w-5 -translate-x-1/2 rounded-full bg-rule sm:hidden" />
            )}
            <h2 id="dialog-title" className="pt-1 font-display text-xl">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 flex min-h-touch min-w-touch items-center justify-center text-muted hover:text-ink"
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="overflow-y-auto px-3 py-3">{children}</div>
        </div>
      )}
    </dialog>
  )
}
