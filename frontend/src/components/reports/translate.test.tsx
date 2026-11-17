import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import { setPreferredLanguage, preferredLanguage, languageName } from '@/utils/language'
import { TranslatePanel } from './TranslatePanel'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return { ...actual, api: { ...actual.api, translate: vi.fn() } }
})

const translate = vi.mocked(api.translate)
const SPANISH = 'La rampa de la entrada esta bloqueada por un camion.'
const USER = { id: 'u1', email: 'a@example.org', display_name: 'Alex', role: 'user' as const, created_at: '2026-01-01T00:00:00Z' }

beforeEach(() => {
  translate.mockReset().mockResolvedValue({
    original: SPANISH,
    translation: 'The entrance ramp is blocked by a truck.',
    target: 'en',
    source: 'gemini',
    model: 'gemini-test',
    label: 'AI translation. Review it before you file. Your original text is kept with the report.',
  })
  setPreferredLanguage(null)
})

afterEach(() => {
  useAuth.setState({ user: null, accessToken: null })
  setPreferredLanguage(null)
})

function renderPanel(onUse = vi.fn()) {
  render(
    <MemoryRouter>
      <TranslatePanel text={SPANISH} onUse={onUse} />
    </MemoryRouter>,
  )
  return onUse
}

describe('translation for review', () => {
  it('asks people to sign in and says they can file without it', () => {
    renderPanel()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.getByText(/You can file in any language without it/)).toBeInTheDocument()
  })

  it('shows the translation as an editable draft, labelled for review, with the original kept', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Translate for review' }))
    expect(await screen.findByText(/AI translation\. Review it before you file/)).toBeInTheDocument()
    expect(screen.getByLabelText('Translation into English')).toHaveValue('The entrance ramp is blocked by a truck.')
    expect(screen.getByText(SPANISH)).toBeInTheDocument()
    expect(translate).toHaveBeenCalledWith({ text: SPANISH, target: 'en' })
  })

  it('files the reviewed text and records the original and its language', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    const onUse = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Translate for review' }))
    const box = await screen.findByLabelText('Translation into English')
    await user.clear(box)
    await user.type(box, 'The entrance ramp is blocked by a delivery truck.')
    await user.click(screen.getByRole('button', { name: 'Use this translation' }))
    expect(onUse).toHaveBeenCalledWith('The entrance ramp is blocked by a delivery truck.', {
      language: 'es',
      original: SPANISH,
      source: 'gemini',
      model: 'gemini-test',
      reviewed: true,
    })
  })

  it('can keep the original text and discard the translation', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    const onUse = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Translate for review' }))
    await user.click(await screen.findByRole('button', { name: 'Keep my text' }))
    expect(onUse).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Translation into English')).not.toBeInTheDocument()
  })

  it('passes axe with a translation on screen', async () => {
    useAuth.setState({ user: USER, accessToken: 'token' })
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <TranslatePanel text={SPANISH} onUse={vi.fn()} />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Translate for review' }))
    await screen.findByLabelText('Translation into English')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('language preference on this device', () => {
  it('remembers a supported language and ignores anything else', () => {
    setPreferredLanguage('zh')
    expect(preferredLanguage()).toBe('zh')
    expect(languageName('zh')).toBe('Chinese')
    localStorage.setItem('accesssignal.language', '</script>')
    expect(preferredLanguage()).toBeNull()
  })
})
