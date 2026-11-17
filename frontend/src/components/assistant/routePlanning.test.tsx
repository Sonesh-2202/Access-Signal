import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/services/api'
import { useAssistant, openAssistant } from '@/stores/assistant'
import { useAuth } from '@/stores/auth'
import { consumeRoutePlan, useRoutePlan } from '@/stores/routePlan'
import { axeViolations } from '@/test/a11y'
import type { ChatReply, RoutePlanResult } from '@/types'
import { AssistantPanel } from './AssistantPanel'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, chat: vi.fn() } }
})

const chat = vi.mocked(api.chat)

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

const PLAN: RoutePlanResult = {
  status: 'planned',
  intent: {
    profile: 'wheelchair',
    start: 'Union Square',
    end: 'Grand Central Terminal',
    avoid_features: ['unknown_data'],
    max_detour_pct: 10,
    max_incline: null,
  },
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
    explanation: ['Avoids 1 reported barrier on the shortest walking route: blocked ramp.'],
    geometry: { type: 'LineString', coordinates: [] },
    segments: [],
  },
  notes: ['Detour: the route is +6% compared with the shortest walk. Your limit is 10%, so this is within the limit.'],
  unsupported: [],
  message: 'Route from Union Square to Grand Central Terminal.',
}

const REPLY: ChatReply = {
  answer: 'The walk avoids one blocked ramp and is within your 10% limit [T1].',
  sources: [{ tag: 'T1', kind: 'route', label: 'Walking route (wheelchair), 1240 m', url: '/route?from=40.73490,-73.99060' }],
  source: 'gemini',
  model: 'gemini-test',
  truncated: false,
  route: PLAN,
}

function Harness() {
  return (
    <MemoryRouter initialEntries={['/route']}>
      <AssistantPanel />
      <Routes>
        <Route path="/route" element={<p>Route planner page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

async function askForRoute(question = 'Step-free route from Union Square to Grand Central Terminal.') {
  const user = userEvent.setup()
  openAssistant({ kind: 'none' }, 'a walking route', 'plan_route')
  render(<Harness />)
  await user.type(screen.getByLabelText('Your question'), question)
  await user.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByText(REPLY.answer)
  return user
}

beforeEach(() => {
  useAuth.setState({ user: USER, accessToken: 'token' })
  chat.mockReset()
  chat.mockResolvedValue(REPLY)
  consumeRoutePlan()
})

afterEach(() => {
  useAssistant.setState({ open: false, context: { kind: 'none' }, contextLabel: '', intent: 'answer', turns: [] })
  useAuth.setState({ user: null, accessToken: null })
  consumeRoutePlan()
})

describe('route planning in the assistant', () => {
  it('opens scoped to a route, asks with the plan_route intent, and shows the planned route as text', async () => {
    await askForRoute()
    expect(screen.getByRole('dialog', { name: 'Ask for a route' })).toBeInTheDocument()
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ intent: 'plan_route' }))

    const card = screen.getByRole('region', { name: 'Planned route' })
    expect(within(card).getByText(/From Union Square to Grand Central Terminal, Wheelchair profile\./)).toBeInTheDocument()
    expect(within(card).getByText(/Detour: the route is \+6%/)).toBeInTheDocument()
    expect(within(card).getByText(/router from OpenStreetMap paths/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Apply to map' })).toBeInTheDocument()
  })

  it('Apply to map hands the plan to the planner, closes the panel and opens the planner', async () => {
    const user = await askForRoute()
    await user.click(screen.getByRole('button', { name: 'Apply to map' }))
    expect(useRoutePlan.getState().pending).toEqual(PLAN)
    expect(useAssistant.getState().open).toBe(false)
    expect(await screen.findByText('Route planner page')).toBeInTheDocument()
  })

  it('shows the source of the answer and the citation link to the route', async () => {
    await askForRoute()
    const sources = screen.getByRole('region', { name: 'Sources' })
    expect(within(sources).getByRole('link', { name: /Walking route/ })).toHaveAttribute('href', '/route?from=40.73490,-73.99060')
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveTextContent('Cloud AI (Gemini)')
  })

  it('shows the honest offline message from the server and no route card', async () => {
    chat.mockRejectedValueOnce(new ApiError(503, 'Route planning needs cloud AI. Add your own key in Settings.'))
    const user = userEvent.setup()
    openAssistant({ kind: 'none' }, 'a walking route', 'plan_route')
    render(<Harness />)
    await user.type(screen.getByLabelText('Your question'), 'Route to the library')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('Route planning needs cloud AI. Add your own key in Settings.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Planned route' })).not.toBeInTheDocument()
  })

  it('passes axe with a planned route on screen', async () => {
    const user = userEvent.setup()
    openAssistant({ kind: 'none' }, 'a walking route', 'plan_route')
    const { container } = render(<Harness />)
    await user.type(screen.getByLabelText('Your question'), 'Route please')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('region', { name: 'Planned route' })
    expect(await axeViolations(container)).toEqual([])
  })
})
