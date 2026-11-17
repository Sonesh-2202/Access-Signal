import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import type { InboxItem, NearbyOut, NearbySettings as Settings } from '@/types'
import { NearbyCard } from './NearbyCard'
import { NearbySettings } from './NearbySettings'
import { Inbox } from './Inbox'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      nearbyNow: vi.fn(),
      nearbySettings: vi.fn(),
      setNearbySettings: vi.fn(),
      shareNearbyLocation: vi.fn(),
      forgetNearbyLocation: vi.fn(),
      inbox: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    },
  }
})

const nearbyNow = vi.mocked(api.nearbyNow)
const nearbySettings = vi.mocked(api.nearbySettings)
const setNearbySettings = vi.mocked(api.setNearbySettings)
const shareNearbyLocation = vi.mocked(api.shareNearbyLocation)
const inbox = vi.mocked(api.inbox)

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }
const HERE = { coords: { latitude: 40.7349, longitude: -73.9906 } }

const RESULT: NearbyOut = {
  radius_m: 250,
  checked_at: '2026-05-01T12:00:00Z',
  barriers: [{ id: 'r1', kind: 'barrier', label: 'Ramp blocked', place_name: null, distance_m: 42, url: '/reports/r1', when: null }],
  outages: [{ id: 'f1', kind: 'outage', label: 'Elevator out of service', place_name: 'Herald Square', distance_m: 180, url: '/places/p1', when: null }],
}

const SETTINGS_OFF: Settings = { enabled: false, radius_m: 100, has_location: false, location_expires_at: null }

let getCurrentPosition: ReturnType<typeof vi.fn>

function mockGeolocation(result: 'ok' | 'denied') {
  getCurrentPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) => {
    if (result === 'ok') ok(HERE as unknown as GeolocationPosition)
    else fail({ code: 1, message: 'denied' } as GeolocationPositionError)
  })
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
}

function mockPermission(state: 'granted' | 'prompt') {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
  })
}

beforeEach(() => {
  nearbyNow.mockReset().mockResolvedValue(RESULT)
  nearbySettings.mockReset().mockResolvedValue(SETTINGS_OFF)
  setNearbySettings.mockReset().mockImplementation(async (b) => ({ ...SETTINGS_OFF, enabled: b.enabled, radius_m: b.radius_m }))
  shareNearbyLocation.mockReset().mockResolvedValue({ ...SETTINGS_OFF, enabled: true, has_location: true, location_expires_at: '2026-05-02T12:00:00Z' })
  mockGeolocation('ok')
  mockPermission('prompt')
  useAuth.setState({ user: USER, accessToken: 'token' })
})

afterEach(() => {
  useAuth.setState({ user: null, accessToken: null })
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true })
})

describe('Near you now (home)', () => {
  it('reads the location once on a press and lists what is open nearby', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbyCard />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Check near me' }))
    expect(await screen.findByRole('link', { name: 'Ramp blocked' })).toHaveAttribute('href', '/reports/r1')
    expect(screen.getByText(/Elevator out of service/)).toBeInTheDocument()
    expect(screen.getByText(/at Herald Square/)).toBeInTheDocument()
    expect(nearbyNow).toHaveBeenCalledWith({ lat: 40.7349, lng: -73.9906, radius_m: 250 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('never repeats the location read without another press', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbyCard />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Check near me' }))
    await screen.findByRole('link', { name: 'Ramp blocked' })
    await new Promise((r) => setTimeout(r, 60))
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(nearbyNow).toHaveBeenCalledTimes(1)
  })

  it('explains how to enable location when it was declined, and does not ask again', async () => {
    mockGeolocation('denied')
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbyCard />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Check near me' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is blocked for this site')
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(nearbyNow).not.toHaveBeenCalled()
  })

  it('says plainly when nothing is recorded nearby', async () => {
    nearbyNow.mockResolvedValueOnce({ ...RESULT, barriers: [], outages: [] })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbyCard />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Check near me' }))
    expect(await screen.findByText(/Nothing open is recorded within 250 m/)).toBeInTheDocument()
  })

  it('passes axe with results shown', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <NearbyCard />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Check near me' }))
    await screen.findByRole('link', { name: 'Ramp blocked' })
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('alerts near me (settings)', () => {
  it('asks people to sign in first', () => {
    useAuth.setState({ user: null, accessToken: null })
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('turns on, then shares one location, with a 100 m default', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Alerts near me' }))
    await waitFor(() => expect(shareNearbyLocation).toHaveBeenCalledWith(40.7349, -73.9906))
    expect(setNearbySettings).toHaveBeenCalledWith({ enabled: true, radius_m: 100 })
  })

  it('turning it off stops sharing and forgets the saved location', async () => {
    nearbySettings.mockResolvedValueOnce({ enabled: true, radius_m: 250, has_location: true, location_expires_at: '2026-05-02T12:00:00Z' })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Alerts near me' }))
    expect(setNearbySettings).toHaveBeenCalledWith({ enabled: false, radius_m: 250 })
    expect(shareNearbyLocation).not.toHaveBeenCalled()
    expect(await screen.findByText(/Your location has been forgotten/)).toBeInTheDocument()
  })

  it('refreshes a saved location once on a visit, and only when permission was already granted', async () => {
    nearbySettings.mockResolvedValueOnce({ enabled: true, radius_m: 100, has_location: true, location_expires_at: '2026-05-02T12:00:00Z' })
    mockPermission('granted')
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    await waitFor(() => expect(shareNearbyLocation).toHaveBeenCalledTimes(1))
  })

  it('does not prompt for location on a visit when permission has not been granted', async () => {
    nearbySettings.mockResolvedValueOnce({ enabled: true, radius_m: 100, has_location: false, location_expires_at: null })
    mockPermission('prompt')
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    expect(await screen.findByText('No location saved yet. Alerts need one.')).toBeInTheDocument()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('explains the privacy limits on the page', async () => {
    render(
      <MemoryRouter>
        <NearbySettings />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/contain an address, a place name or report text/)).toBeInTheDocument()
  })
})

describe('inbox filters', () => {
  const ITEMS: InboxItem[] = [
    { id: 'a', kind: 'nearby_report', title: 'A barrier was reported near you', body: 'Open Nearby.', corridor_id: null, corridor_name: null, created_at: '2026-05-01T12:00:00Z', read: false },
    { id: 'b', kind: 'route_change', title: 'A saved walk has changed', body: 'Open the planner.', corridor_id: 'c', corridor_name: 'Gym route', created_at: '2026-05-01T11:00:00Z', read: true },
  ]

  it('shows only nearby alerts under Nearby, and only saved-route alerts under Saved routes', async () => {
    inbox.mockResolvedValue({ unread: 1, items: ITEMS })
    const user = userEvent.setup()
    render(<Inbox />)
    const group = await screen.findByRole('group', { name: 'Filter alerts' })
    await user.click(within(group).getByRole('button', { name: 'Nearby' }))
    expect(screen.getByText('A barrier was reported near you')).toBeInTheDocument()
    expect(screen.queryByText('A saved walk has changed')).not.toBeInTheDocument()
    await user.click(within(group).getByRole('button', { name: 'Saved routes' }))
    expect(screen.queryByText('A barrier was reported near you')).not.toBeInTheDocument()
    expect(screen.getByText('A saved walk has changed')).toBeInTheDocument()
  })
})
