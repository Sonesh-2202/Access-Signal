import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { clearConversation, openAssistant, useAssistant } from '@/stores/assistant'
import { axeViolations } from '@/test/a11y'
import { AskButton } from './AskButton'
import { AssistantPanel } from './AssistantPanel'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, chat: vi.fn() } }
})

const chat = vi.mocked(api.chat)

const REPLY = {
  answer: 'A delivery truck is parked across the ramp [R1].',
  sources: [{ tag: 'R1', kind: 'report' as const, label: 'Blocked ramp, 5th Ave', url: '/reports/rep-1' }],
  source: 'gemini' as const,
  model: 'gemini-test',
  truncated: false,
}

const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

function Harness({ context = { kind: 'report' as const, id: 'rep-1' }, label = 'report at 5th Ave' }) {
  return (
    <MemoryRouter>
      <AskButton context={context} label={label}>
        Open assistant
      </AskButton>
      <AssistantPanel />
    </MemoryRouter>
  )
}

function openPanel(user = userEvent.setup()) {
  return user.click(screen.getByRole('button', { name: 'Open assistant' }))
}

beforeEach(() => {
  useAuth.setState({ user: USER, accessToken: 'token' })
  chat.mockReset()
  chat.mockResolvedValue(REPLY)
})

afterEach(() => {
  useAssistant.setState({ open: false, context: { kind: 'none' }, contextLabel: '', turns: [] })
  useAuth.setState({ user: null, accessToken: null })
})

describe('assistant panel', () => {
  it('states that it is read-only and cites where answers come from', async () => {
    render(<Harness />)
    await openPanel()
    expect(screen.getByRole('dialog', { name: /Ask about report at 5th Ave/ })).toBeInTheDocument()
    expect(screen.getByText('This assistant can read but cannot file reports or change anything.')).toBeInTheDocument()
    expect(screen.getByText(/grounded in the data on this page/)).toBeInTheDocument()
  })

  it('moves focus into the question on open and back to the opener on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open assistant' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByLabelText('Your question')).toHaveFocus())

    fireEvent(screen.getByRole('dialog', { hidden: true }), new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(useAssistant.getState().open).toBe(false))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('closes with the close button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(useAssistant.getState().open).toBe(false)
  })

  it('sends the question with the context and renders the complete answer with source links', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    await user.type(screen.getByLabelText('Your question'), 'Is the ramp blocked?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(screen.getByText(REPLY.answer)).toBeInTheDocument())
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Is the ramp blocked?' }],
        context: { kind: 'report', id: 'rep-1' },
      }),
    )
    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveTextContent('Cloud AI (Gemini)')

    const sources = screen.getByRole('region', { name: 'Sources' })
    const link = within(sources).getByRole('link', { name: /Blocked ramp, 5th Ave/ })
    expect(link).toHaveAttribute('href', '/reports/rep-1')
    expect(within(sources).getByText('[R1]')).toBeInTheDocument()
  })

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    const box = screen.getByLabelText('Your question')
    await user.type(box, 'First{Shift>}{Enter}{/Shift}second')
    expect(box).toHaveValue('First\nsecond')
    expect(chat).not.toHaveBeenCalled()
    await user.type(box, '{Enter}')
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1))
  })

  it('shows the server message when the assistant cannot answer, and never a stack or key', async () => {
    chat.mockRejectedValueOnce(new ApiError(503, 'The AI assistant needs a cloud AI key.'))
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    await user.type(screen.getByLabelText('Your question'), 'Hello?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('The AI assistant needs a cloud AI key.')).toBeInTheDocument()
  })

  it('clears the conversation on request', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    await user.type(screen.getByLabelText('Your question'), 'Hello?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(REPLY.answer)
    await user.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(screen.queryByText(REPLY.answer)).not.toBeInTheDocument()
    expect(useAssistant.getState().turns).toEqual([])
  })

  it('starts a new conversation when opened about a different object', () => {
    openAssistant({ kind: 'report', id: 'a' }, 'A')
    useAssistant.setState({ turns: [{ role: 'user', content: 'about a' }] })
    openAssistant({ kind: 'report', id: 'a' }, 'A')
    expect(useAssistant.getState().turns).toHaveLength(1)
    openAssistant({ kind: 'place', id: 'b' }, 'B')
    expect(useAssistant.getState().turns).toEqual([])
    clearConversation()
  })

  it('asks people to sign in and disables the question box when signed out', async () => {
    useAuth.setState({ user: null, accessToken: null })
    const user = userEvent.setup()
    render(<Harness />)
    await openPanel(user)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.getByLabelText('Your question')).toBeDisabled()
  })

  it('passes an accessible dialog with no violations', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)
    await openPanel(user)
    await user.type(screen.getByLabelText('Your question'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText(REPLY.answer)
    expect(await axeViolations(container)).toEqual([])
  })
})
