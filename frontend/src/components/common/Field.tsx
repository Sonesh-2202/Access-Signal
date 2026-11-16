import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cx } from '@/utils/cx'
import { Icon } from './Icon'

const control =
  'w-full min-h-touch rounded-sm border border-rule bg-paper-raised px-2 text-base text-ink placeholder:text-muted/80 transition-colors duration-150 ease-out hover:border-ink/40 focus-visible:border-signal aria-[invalid=true]:border-signal'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  className?: string
  children: ReactElement
  hideLabel?: boolean
}

/** Wires label, hint and error to the child control with ids and aria attributes. */
export function Field({ label, hint, error, optional, className, children, hideLabel }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const own = isValidElement(children) ? (children.props as Record<string, unknown>)['aria-describedby'] : undefined
  const describedBy = [hintId, errId, own as string | undefined].filter(Boolean).join(' ') || undefined
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <label htmlFor={id} className={cx('text-sm font-medium text-ink', hideLabel && 'sr-only')}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted">optional</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {child}
      {error && (
        <p id={errId} className="flex items-center gap-0.5 text-sm text-signal">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(control, className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(control, 'min-h-[120px] py-1 leading-relaxed', className)} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(control, 'appearance-none pr-5', className)} {...rest}>
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={16}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  )
})

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId()
  return (
    <div className={cx('flex min-h-touch items-start gap-1 py-0.5', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-signal"
        aria-describedby={description ? `${id}-d` : undefined}
        {...rest}
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-snug">
        <span className="text-ink">{label}</span>
        {description && (
          <span id={`${id}-d`} className="block text-muted">
            {description}
          </span>
        )}
      </label>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  legend: string
  value: T
  options: { value: T; label: ReactNode; hint?: string }[]
  onChange: (v: T) => void
  className?: string
  hideLegend?: boolean
}

/** Radio group styled as a segmented control. Arrow keys work natively. */
export function Segmented<T extends string>({ legend, value, options, onChange, className, hideLegend }: SegmentedProps<T>) {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend className={cx('mb-0.5 text-sm font-medium', hideLegend && 'sr-only')}>{legend}</legend>
      <div className="flex flex-wrap gap-px overflow-hidden rounded-sm border border-rule bg-rule">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.hint}
            className={cx(
              'relative flex min-h-touch flex-1 cursor-pointer items-center justify-center whitespace-nowrap px-1 text-sm sm:px-2 transition-colors duration-150 ease-out has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal',
              value === o.value ? 'bg-ink text-paper' : 'bg-paper-raised text-ink hover:bg-paper-sunk',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
