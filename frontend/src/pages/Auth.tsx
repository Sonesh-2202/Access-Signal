import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Checkbox, Field, Input } from '@/components/common/Field'
import { Container, ErrorNote } from '@/components/layout/Layout'
import { useDocumentTitle } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { cx } from '@/utils/cx'

function safeNext(next: string | null): string {
  // Only allow same-site relative paths to avoid open redirects.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

const DEMO = [
  { email: 'priya.raman@example.org', who: 'Community member (wheelchair user)' },
  { email: 'dana.whitfield@city.example.org', who: 'Infrastructure manager, DOT liaison' },
]

function AuthShell({ title, lede, children, aside }: { title: string; lede: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Container className="grid gap-6 py-6 md:grid-cols-12 md:py-12">
      <div className="md:col-span-5 md:col-start-2">
        <h1 className="text-4xl leading-snug tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-lg text-muted">{lede}</p>
        <div className="mt-4">{children}</div>
      </div>
      {aside && <aside className="md:col-span-4 md:col-start-8 md:pt-12">{aside}</aside>}
    </Container>
  )
}

export function LoginPage() {
  useDocumentTitle('Sign in')
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const pair = await api.login(email, password)
      useAuth.getState().setSession(pair, keep)
      nav(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      lede="You need an account to file reports, so that each one can be followed up and weighed by the reporter's track record."
      aside={
        <div className="border-l border-hair pl-3">
          <p className="meta">Demo accounts</p>
          <p className="mt-1 text-sm text-muted">
            This build runs with seeded demo data. Every demo account uses the password{' '}
            <code className="font-mono text-ink">Signal-demo-2026</code>.
          </p>
          <ul className="mt-2 flex flex-col">
            {DEMO.map((d) => (
              <li key={d.email} className="border-t border-hair py-1">
                <button
                  type="button"
                  className="min-h-touch text-left text-sm"
                  onClick={() => {
                    setEmail(d.email)
                    setPassword('Signal-demo-2026')
                  }}
                >
                  <span className="block font-medium underline decoration-rule underline-offset-[3px]">{d.email}</span>
                  <span className="block text-muted">{d.who}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {error && <ErrorNote error={error} />}
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Checkbox label="Keep me signed in on this device" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" busy={busy}>
            Sign in
          </Button>
          <p className="text-sm text-muted">
            New here? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Create an account</Link>
          </p>
        </div>
      </form>
    </AuthShell>
  )
}

export function passwordChecks(pw: string) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return {
    length: pw.length >= 10,
    variety: classes >= 3,
    bytes: new TextEncoder().encode(pw).length <= 72,
    score: Math.min(4, (pw.length >= 10 ? 1 : 0) + (pw.length >= 14 ? 1 : 0) + Math.max(0, classes - 2)),
  }
}

export function PasswordStrength({ value, id }: { value: string; id: string }) {
  const c = passwordChecks(value)
  const words = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  return (
    <div id={id} className="mt-1" aria-live="polite">
      <div className="flex gap-0.5" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-[3px] flex-1', i < c.score ? (c.score >= 3 ? 'bg-ink' : 'bg-signal') : 'bg-hair')} />
        ))}
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {value ? words[c.score] : 'At least 10 characters'}
        {value && !c.variety && '. Mix three of: lowercase, uppercase, numbers, symbols'}
        {value && !c.bytes && '. Too long (72 bytes max)'}
      </p>
    </div>
  )
}

export function RegisterPage() {
  useDocumentTitle('Create an account')
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const checks = passwordChecks(password)
  const valid = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && checks.length && checks.variety && checks.bytes && agree

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const pair = await api.register(email, password, name)
      useAuth.getState().setSession(pair, true)
      nav(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Create an account"
      lede="Your name appears on reports you file. Your email is never shown to other people."
    >
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {error && <ErrorNote error={error} />}
        <Field label="Display name" hint="First name and initial is fine.">
          <Input autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="pw-strength"
              required
            />
          </Field>
          <PasswordStrength value={password} id="pw-strength" />
        </div>
        <Checkbox
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          label={
            <>
              I agree to the <Link to="/terms">terms of service</Link> and have read the <Link to="/privacy">privacy policy</Link>
            </>
          }
        />
        <div>
          <Button type="submit" variant="primary" busy={busy} disabled={!valid}>
            Create account
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}
