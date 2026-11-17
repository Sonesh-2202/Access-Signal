import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import type { RideOption } from '@/types'
import { RideHandoffCard } from './RideHandoffCard'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, rides: vi.fn(), rideDraft: vi.fn() } }
})

const rides = vi.mocked(api.rides)
const draft = vi.mocked(api.rideDraft)

const LIST: RideOption[] = [
  {
    id: 'aar',
    name: 'Access-A-Ride (MTA paratransit)',
    kind: 'paratransit',
    phone: '877-337-2017',
    tel: '+18773372017',
    url: 'https://www.mta.info/accessibility/access-a-ride',
    notes: 'Pre-approved paratransit.',
    source_url: 'https://www.mta.info/accessibility/access-a-ride/book-and-manage-trips',
  },
]

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

function renderCard() {
  return render(<RideHandoffCard pickup="Union Square" dropoff="Grand Central Terminal" barrier="missing curb cut" />)
}

beforeEach(() => {
  rides.mockReset()
  rides.mockResolvedValue(LIST)
  draft.mockReset()
  draft.mockResolvedValue({
    text: 'Accessible ride request. Pickup: Union Square. Drop-off: Grand Central Terminal.',
    source: 'template',
    model: null,
    preview: true,
    label: 'Draft for you to review before sending. Nothing is sent or booked.',
    note: null,
  })
  useAuth.setState({ user: null, accessToken: null })
})

afterEach(() => {
  useAuth.setState({ user: null, accessToken: null })
})

describe('accessible ride handoff card', () => {
  it('lists ride services as tel: and https links only', async () => {
    renderCard()
    const call = await screen.findByRole('link', { name: 'Call 877-337-2017' })
    expect(call).toHaveAttribute('href', 'tel:+18773372017')
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://www.mta.info/accessibility/access-a-ride')
  })

  it('makes a template draft that is labelled for review and is read-only', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: 'Make a draft' }))
    const box = await screen.findByLabelText('Template draft — review before sending')
    expect(box).toHaveAttribute('readonly')
    expect((box as HTMLTextAreaElement).value).toContain('Union Square')
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ use_ai: false, barrier: 'missing curb cut' }))
  })

  it('keeps AI drafts behind sign-in, and labels them as AI drafts', async () => {
    const user = userEvent.setup()
    draft.mockResolvedValueOnce({
      text: 'Please send an accessible taxi from Union Square.',
      source: 'ai',
      model: 'gemini-test',
      preview: true,
      label: 'x',
      note: null,
    })
    renderCard()
    expect(screen.getByRole('button', { name: 'Write it with AI' })).toBeDisabled()
    useAuth.setState({ user: USER, accessToken: 'token' })
    await user.click(screen.getByRole('button', { name: 'Write it with AI' }))
    expect(await screen.findByLabelText('AI draft — review before sending')).toBeInTheDocument()
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ use_ai: true }))
  })

  it('says where to get help when no ride list is available', async () => {
    rides.mockRejectedValueOnce(new Error('offline'))
    renderCard()
    expect(await screen.findByText(/Call 311 and ask for accessible taxi/)).toBeInTheDocument()
  })

  it('passes axe with the draft shown', async () => {
    const user = userEvent.setup()
    const { container } = renderCard()
    await screen.findByRole('link', { name: 'Call 877-337-2017' })
    await user.click(screen.getByRole('button', { name: 'Make a draft' }))
    await screen.findByLabelText('Template draft — review before sending')
    expect(await axeViolations(container)).toEqual([])
  })

  it('shows the list and the draft inside one region a screen reader can find', async () => {
    renderCard()
    const region = screen.getByRole('region', { name: 'No step-free route between these points' })
    await waitFor(() => expect(within(region).getByRole('link', { name: 'Call 877-337-2017' })).toBeInTheDocument())
  })
})
