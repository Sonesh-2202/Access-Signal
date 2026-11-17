import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import type { DescribeReply, RoutePlanResult } from '@/types'
import { DescribeRoute } from './DescribeRoute'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, describeRoute: vi.fn() } }
})

const describeRoute = vi.mocked(api.describeRoute)
const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

const PLAN: RoutePlanResult = {
  status: 'planned',
  intent: { profile: 'wheelchair', start: 'Union Square', end: 'Grand Central Terminal', avoid_features: [], max_detour_pct: 10, max_incline: null },
  start: { id: 'p1', name: 'Union Square', lat: 40.7349, lng: -73.9906 },
  end: { id: 'p2', name: 'Grand Central Terminal', lat: 40.7527, lng: -73.9772 },
  route: {
    label: 'Recommended',
    distance_m: 1240,
    duration_min: 21,
    cost: 1300,
    accessibility_score: 0.92,
    unknown_share: 0,
    barriers_avoided: 1,
    barriers_on_route: 0,
    explanation: [],
    geometry: { type: 'LineString', coordinates: [] },
    segments: [],
  },
  notes: ['Detour: the route is +6% compared with the shortest walk. Your limit is 10%, so this is within the limit.'],
  unsupported: [],
  message: 'Route from Union Square to Grand Central Terminal.',
}

const REPLY: DescribeReply = {
  answer: 'The walk is about 1.2 km and avoids one reported barrier [T1].',
  source: 'gemini',
  model: 'gemini-test',
  route: PLAN,
}

function renderPanel(onShow = vi.fn()) {
  render(
    <MemoryRouter>
      <DescribeRoute onShow={onShow} />
    </MemoryRouter>,
  )
  return onShow
}

beforeEach(() => {
  describeRoute.mockReset().mockResolvedValue(REPLY)
  useAuth.setState({ user: null, accessToken: null })
})

describe('describe a route in plain words', () => {
  it('asks people to sign in, and says the form works without an account', () => {
    renderPanel()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('Your request')).not.toBeInTheDocument()
  })

  it('shows the explanation with its source and the router’s summary, and draws nothing yet', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    const onShow = renderPanel()
    await user.type(screen.getByLabelText('Your request'), 'Step-free route from Union Square to Grand Central')
    await user.click(screen.getByRole('button', { name: 'Plan from my words' }))
    expect(await screen.findByText(REPLY.answer)).toBeInTheDocument()
    expect(screen.getByText('Explained by Cloud AI (Gemini)')).toBeInTheDocument()
    expect(screen.getByText(/Detour: the route is \+6%/)).toBeInTheDocument()
    expect(onShow).not.toHaveBeenCalled()
  })

  it('hands the planned route to the planner only when the person asks', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    const onShow = renderPanel()
    await user.type(screen.getByLabelText('Your request'), 'Route to Grand Central')
    await user.click(screen.getByRole('button', { name: 'Plan from my words' }))
    await user.click(await screen.findByRole('button', { name: 'Show this route on the map' }))
    expect(onShow).toHaveBeenCalledWith(PLAN)
  })

  it('says so when no model wrote the explanation', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    describeRoute.mockResolvedValueOnce({ ...REPLY, source: null, model: null, answer: PLAN.message })
    const user = userEvent.setup()
    renderPanel()
    await user.type(screen.getByLabelText('Your request'), 'Route to Grand Central')
    await user.click(screen.getByRole('button', { name: 'Plan from my words' }))
    expect(await screen.findByText(/no model wrote an explanation/)).toBeInTheDocument()
  })

  it('shows the honest offline message from the server', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    describeRoute.mockRejectedValueOnce(new ApiError(503, 'Describing a route needs cloud AI.'))
    const user = userEvent.setup()
    renderPanel()
    await user.type(screen.getByLabelText('Your request'), 'Route to Grand Central')
    await user.click(screen.getByRole('button', { name: 'Plan from my words' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Describing a route needs cloud AI.')
  })

  it('passes axe', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const { container } = render(
      <MemoryRouter>
        <DescribeRoute onShow={vi.fn()} />
      </MemoryRouter>,
    )
    expect(await axeViolations(container)).toEqual([])
  })
})
