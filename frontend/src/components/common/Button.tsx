import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cx } from '@/utils/cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium no-underline transition-[background-color,border-color,color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 select-none'

const variants: Record<Variant, string> = {
  primary: 'bg-signal text-paper border border-signal hover:bg-signal-deep hover:border-signal-deep',
  secondary: 'bg-transparent text-ink border border-ink/80 hover:bg-ink hover:text-paper',
  ghost: 'bg-transparent text-ink border border-hair hover:border-rule hover:bg-hair',
  quiet: 'bg-transparent text-ink border border-transparent hover:bg-hair',
  danger: 'bg-transparent text-signal border border-signal/60 hover:bg-signal-wash',
}

const sizes: Record<Size, string> = {
  sm: 'min-h-touch px-2 text-sm rounded-sm',
  md: 'min-h-touch px-2 text-sm rounded-sm sm:px-3',
  lg: 'min-h-[52px] px-3 text-base rounded-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  busy?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(base, variants[variant], sizes[size], className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <BusyBar /> : icon}
      {children}
    </button>
  )
})

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={cx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}

/** Three short bars that pulse in sequence. Used instead of a spinner while a button is busy. */
function BusyBar() {
  return (
    <span className="inline-flex h-2 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] bg-current"
          style={{ height: 8, animation: `fade-up 600ms ${i * 120}ms var(--ease-out) infinite alternate` }}
        />
      ))}
    </span>
  )
}
