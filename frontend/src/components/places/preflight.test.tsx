import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import type { PreflightBrief } from '@/types'
import { PreflightCard } from './PreflightCard'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, preflight: vi.fn(), preflightSummary: vi.fn() } }
})

const preflight = vi.mocked(api.preflight)
const summary = vi.mocked(api.preflightSummary)

const BRIEF: PreflightBrief = {
  place_id: 'p1',
  place_name: 'Hall With Lift',
  status: 'blocked',
  status_label: 'Blocked',
  reasons: ['[R1] Open report: Blocked ramp, severity 0.90. It blocks a wheelchair user.', '[P1] Elevator is recorded as out of service.'],
  summary: 'Blocked. ...',
  source: 'rules',
  sources: [
    { tag: 'P1', kind: 'place', label: 'Hall With Lift', url: '/places/p1' },
    { tag: 'R1', kind: 'report', label: 'Blocked ramp', url: '/reports/r1' },
  ],
  screen_reader: 'Hall With Lift. Preflight status: Blocked. Open report: Blocked ramp.',
}

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

function renderCard() {
  return render(
    <MemoryRouter>
      <PreflightCard placeId="p1" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  preflight.mockReset().mockResolvedValue(BRIEF)
  summary.mockReset().mockResolvedValue({
    summary: 'The elevator is out of service [P1]. An open report blocks the ramp [R1].',
    source: 'gemini',
    model: 'gemini-test',
    sources: BRIEF.sources,
  })
  useAuth.setState({ user: null, accessToken: null })
})

describe('preflight card', () => {
  it('states the status in words with each reason and the record it comes from', async () => {
    renderCard()
    expect(await screen.findByText('Status: Blocked')).toBeInTheDocument()
    expect(screen.getByText(/\[R1\] Open report: Blocked ramp/)).toBeInTheDocument()
    expect(screen.getByText(/\[P1\] Elevator is recorded as out of service/)).toBeInTheDocument()
    const sources = screen.getByText('Sources:').closest('p') as HTMLElement
    expect(within(sources).getByRole('link', { name: 'Blocked ramp' })).toHaveAttribute('href', '/reports/r1')
  })

  it('gives a screen-reader sentence that is linked to the card', async () => {
    renderCard()
    const section = await screen.findByRole('region', { name: 'Before you go' })
    expect(section).toHaveAccessibleDescription('Hall With Lift. Preflight status: Blocked. Open report: Blocked ramp.')
  })

  it('asks people to sign in for an AI summary', async () => {
    renderCard()
    await screen.findByText('Status: Blocked')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: 'Write a short summary with AI' })).not.toBeInTheDocument()
  })

  it('writes a cited AI summary for a signed-in person and says which source wrote it', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Write a short summary with AI' }))
    expect(summary).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/The elevator is out of service \[P1\]/)).toBeInTheDocument()
    expect(screen.getByText(/Cloud AI \(Gemini\)/)).toBeInTheDocument()
  })

  it('labels a rule-based summary as such', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    summary.mockResolvedValueOnce({ summary: 'Blocked. ...', source: 'rules', model: null, sources: [] })
    const user = userEvent.setup()
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Write a short summary with AI' }))
    expect(await screen.findByText(/Rule-based \(no cloud AI answered\)/)).toBeInTheDocument()
  })

  it('passes axe', async () => {
    const { container } = renderCard()
    await screen.findByText('Status: Blocked')
    expect(await axeViolations(container)).toEqual([])
  })
})
