import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import type { AlertCorridor, Inbox as InboxData } from '@/types'
import { urlBase64ToUint8Array } from '@/utils/push'
import { AlertSettings } from './AlertSettings'
import { Inbox } from './Inbox'
import { SaveRoute } from './SaveRoute'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      inbox: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      alertPush: vi.fn(),
      corridors: vi.fn(),
      updateCorridor: vi.fn(),
      deleteCorridor: vi.fn(),
      saveCorridor: vi.fn(),
    },
  }
})

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

const INBOX: InboxData = {
  unread: 1,
  items: [
    {
      id: 'n1',
      kind: 'report',
      title: 'A confirmed barrier was reported near a saved walk',
      body: 'Open the route planner to see how it affects your route.',
      corridor_id: 'c1',
      corridor_name: 'Gym route',
      created_at: '2026-05-01T12:00:00Z',
      read: false,
    },
  ],
}

const CORRIDOR: AlertCorridor = {
  id: 'c1',
  name: 'Gym route',
  origin: [40.735, -73.993],
  destination: [40.739, -73.989],
  profile: 'wheelchair',
  notify_reports: true,
  notify_outages: true,
  notify_route_changes: true,
  last_checked_at: null,
  created_at: '2026-05-01T12:00:00Z',
}

beforeEach(() => {
  vi.mocked(api.inbox).mockReset().mockResolvedValue(INBOX)
  vi.mocked(api.markRead).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.alertPush).mockReset().mockResolvedValue({ enabled: false, public_key: null })
  vi.mocked(api.corridors).mockReset().mockResolvedValue([CORRIDOR])
  vi.mocked(api.updateCorridor).mockReset().mockResolvedValue({ ...CORRIDOR, notify_outages: false })
  vi.mocked(api.deleteCorridor).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.saveCorridor).mockReset().mockResolvedValue(CORRIDOR)
  useAuth.setState({ user: USER, accessToken: 'token' })
})

describe('in-app inbox', () => {
  it('shows each alert with its kind, saved route and unread state', async () => {
    render(<Inbox />)
    expect(await screen.findByText('A confirmed barrier was reported near a saved walk')).toBeInTheDocument()
    expect(screen.getByText('1 unread')).toBeInTheDocument()
    expect(screen.getByText(/Saved route: Gym route/)).toBeInTheDocument()
    expect(screen.getByText('Unread:')).toBeInTheDocument()
  })

  it('marks one alert as read', async () => {
    const user = userEvent.setup()
    render(<Inbox />)
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }))
    expect(api.markRead).toHaveBeenCalledWith('n1')
  })

  it('says so when there is nothing yet, and asks people to sign in when signed out', async () => {
    vi.mocked(api.inbox).mockResolvedValueOnce({ unread: 0, items: [] })
    const { unmount } = render(<Inbox />)
    expect(await screen.findByText(/No alerts yet/)).toBeInTheDocument()
    unmount()
    useAuth.setState({ user: null, accessToken: null })
    render(<Inbox />)
    expect(screen.getByText('Sign in to see your alerts.')).toBeInTheDocument()
  })

  it('passes axe', async () => {
    const { container } = render(<Inbox />)
    await screen.findByText('1 unread')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('alert settings', () => {
  it('says when this browser cannot receive push, and the inbox still works', async () => {
    render(
      <MemoryRouter>
        <AlertSettings />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/can’t receive push alerts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on push alerts' })).not.toBeInTheDocument()
  })

  it('lists saved routes with one checkbox per kind of alert, and changes one preference', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AlertSettings />
      </MemoryRouter>,
    )
    const group = await screen.findByRole('group', { name: 'Alerts for Gym route' })
    await user.click(within(group).getByRole('checkbox', { name: 'Out-of-service features' }))
    expect(api.updateCorridor).toHaveBeenCalledWith('c1', { notify_outages: false })
  })

  it('removes a saved route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AlertSettings />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: 'Remove Gym route' }))
    expect(api.deleteCorridor).toHaveBeenCalledWith('c1')
  })

  it('passes axe', async () => {
    const { container } = render(
      <MemoryRouter>
        <AlertSettings />
      </MemoryRouter>,
    )
    await screen.findByRole('group', { name: 'Alerts for Gym route' })
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('save this route', () => {
  it('saves the planned endpoints, profile and a name, and confirms', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SaveRoute
          from={{ lat: 40.735, lng: -73.993, label: 'Start' }}
          to={{ lat: 40.739, lng: -73.989, label: 'End' }}
          profile="wheelchair"
        />
      </MemoryRouter>,
    )
    const name = screen.getByLabelText('Name this route')
    await user.clear(name)
    await user.type(name, 'Gym route')
    await user.click(screen.getByRole('button', { name: 'Save this route for alerts' }))
    expect(api.saveCorridor).toHaveBeenCalledWith({
      name: 'Gym route',
      origin: [40.735, -73.993],
      destination: [40.739, -73.989],
      profile: 'wheelchair',
    })
    expect(await screen.findByText(/Route saved/)).toBeInTheDocument()
  })

  it('asks people to sign in before saving', () => {
    useAuth.setState({ user: null, accessToken: null })
    render(
      <MemoryRouter>
        <SaveRoute from={{ lat: 1, lng: 1, label: 'a' }} to={{ lat: 2, lng: 2, label: 'b' }} profile="standard" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('push key conversion', () => {
  it('turns the URL-safe VAPID key into the bytes a subscription needs', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('AQID-w'))).toEqual([1, 2, 3, 251])
  })
})
