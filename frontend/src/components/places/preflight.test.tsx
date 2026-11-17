import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { axeViolations } from '@/test/a11y'
import type { PreflightBrief } from '@/types'
import { PreflightCard } from './PreflightCard'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, preflight: vi.fn() } }
})

const preflight = vi.mocked(api.preflight)

const BRIEF: PreflightBrief = {
  place_id: 'p1',
  place_name: 'Hall With Lift',
  status: 'blocked',
  status_label: 'Blocked',
  reasons: ['[R1] Open report: Blocked ramp, severity 0.90. It blocks a wheelchair user.', '[P1] Elevator is recorded as out of service.'],
  summary: 'Blocked. [R1] Open report: Blocked ramp, severity 0.90.',
  source: 'rules',
  sources: [
    { tag: 'P1', kind: 'place', label: 'Hall With Lift', url: '/places/p1' },
    { tag: 'R1', kind: 'report', label: 'Blocked ramp', url: '/reports/r1' },
  ],
  screen_reader: 'Hall With Lift. Preflight status: Blocked. Open report: Blocked ramp.',
}

function renderCard() {
  return render(
    <MemoryRouter>
      <PreflightCard placeId="p1" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  preflight.mockReset().mockResolvedValue(BRIEF)
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

  it('says the status is worked out from rules, and offers no AI option', async () => {
    renderCard()
    await screen.findByText('Status: Blocked')
    expect(screen.getByText(/Worked out from rules/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /AI/ })).not.toBeInTheDocument()
  })

  it('gives a screen-reader sentence that is linked to the card', async () => {
    renderCard()
    const section = await screen.findByRole('region', { name: 'Before you go' })
    expect(section).toHaveAccessibleDescription('Hall With Lift. Preflight status: Blocked. Open report: Blocked ramp.')
  })

  it('passes axe', async () => {
    const { container } = renderCard()
    await screen.findByText('Status: Blocked')
    expect(await axeViolations(container)).toEqual([])
  })
})
