import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/a11y'
import { passwordChecks, PasswordStrength } from '@/pages/Auth'
import { severityBand, timeAgo } from '@/utils/format'
import { FeatureStatusMark, SeverityMark } from './Badge'
import { Button } from './Button'
import { ConfidenceBreakdownView } from './Confidence'
import { Checkbox, Field, Input, Segmented } from './Field'

describe('Field', () => {
  it('links label, hint and error to the control', () => {
    render(
      <Field label="Email" hint="We never show it" error="Required">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('We never show it Required')
  })

  it('keeps a description passed on the child', () => {
    render(
      <>
        <Field label="Password">
          <Input aria-describedby="extra" />
        </Field>
        <p id="extra">Strength: good</p>
      </>,
    )
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Strength: good')
  })
})

describe('Segmented', () => {
  it('is a radio group operable by keyboard', async () => {
    const onChange = vi.fn()
    render(<Segmented legend="Profile" value="a" onChange={onChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />)
    const group = screen.getByRole('group', { name: 'Profile' })
    expect(group).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Status marks', () => {
  it('carry text, not colour alone', () => {
    render(
      <>
        <SeverityMark value={0.9} />
        <FeatureStatusMark status="unavailable" />
      </>,
    )
    expect(screen.getByText('critical')).toBeInTheDocument()
    expect(screen.getByText('Not working')).toBeInTheDocument()
  })

  it('severity bands match backend priority thresholds', () => {
    expect(severityBand(0.85)).toBe('critical')
    expect(severityBand(0.65)).toBe('high')
    expect(severityBand(0.4)).toBe('medium')
    expect(severityBand(0.39)).toBe('low')
  })
})

describe('Password rules mirror the API', () => {
  it('requires 10 characters and three character classes', () => {
    expect(passwordChecks('short1A!').length).toBe(false)
    expect(passwordChecks('alllowercase').variety).toBe(false)
    const ok = passwordChecks('Correct-horse-9')
    expect(ok.length && ok.variety && ok.bytes).toBe(true)
  })
  it('announces strength politely', () => {
    render(<PasswordStrength value="Correct-horse-9" id="s" />)
    expect(document.getElementById('s')).toHaveAttribute('aria-live', 'polite')
  })
})

describe('timeAgo', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    expect(timeAgo('2026-11-16T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-11-16T09:00:00Z', now)).toBe('3 hours ago')
    expect(timeAgo('2026-11-14T12:00:00Z', now)).toBe('2 days ago')
  })
})

describe('axe', () => {
  it('finds no violations in a typical form', async () => {
    const { container } = render(
      <MemoryRouter>
        <form>
          <Field label="Description" hint="What is blocking access">
            <Input />
          </Field>
          <Checkbox label="Keep me signed in" />
          <Segmented legend="Status" value="open" onChange={() => undefined} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
          <Button variant="primary" type="submit">Send</Button>
        </form>
      </MemoryRouter>,
    )
    expect(await axeViolations(container)).toEqual([])
  })

  it('finds no violations in the confidence breakdown', async () => {
    const { container } = render(
      <ConfidenceBreakdownView
        data={{
          score: 0.64,
          factors: {
            evidence: { value: 0.45, weight: 0.35 },
            corroboration: { value: 0.75, weight: 0.3 },
            recency: { value: 0.9, weight: 0.15 },
            credibility: { value: 0.6, weight: 0.2 },
          },
          explanation: ['Evidence: voice note', '2 independent reports within 50 m', 'Reported 2 days ago', 'Reporter has 5 of 8 reports confirmed'],
          corroborating_ids: [],
          computed_at: new Date().toISOString(),
        }}
      />,
    )
    expect(screen.getByText('64')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })
})
