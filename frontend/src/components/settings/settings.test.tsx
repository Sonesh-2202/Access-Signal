import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WakeBanner } from '@/components/layout/WakeBanner'
import { VoiceRecorder } from '@/components/reports/VoiceRecorder'
import { clearAIKey, useAIKey } from '@/stores/aiKey'
import { useDataSource } from '@/stores/dataSource'
import { axeViolations } from '@/test/a11y'
import { AIKeyPanel } from './AIKeyPanel'

afterEach(() => {
  clearAIKey()
  vi.unstubAllGlobals()
  useDataSource.setState({ mode: 'unknown', reason: null, epoch: 0, attempt: 0, wokeAt: null })
})

describe('AI key panel', () => {
  it('explains where the key lives, saves it for this tab, and removes it', async () => {
    const user = userEvent.setup()
    const { container } = render(<AIKeyPanel />)
    expect(screen.getByText(/deleted when you close the tab/)).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password')
    expect(await axeViolations(container)).toEqual([])

    await user.type(screen.getByLabelText('API key'), 'short')
    await user.click(screen.getByRole('button', { name: 'Use this key' }))
    expect(screen.getByText(/doesn’t look like an API key/)).toBeInTheDocument()
    expect(useAIKey.getState().value).toBeNull()

    await user.clear(screen.getByLabelText('API key'))
    await user.type(screen.getByLabelText('API key'), 'gsk_live_a1b2c3d4e5f6abcdefWXYZ')
    await user.selectOptions(screen.getByLabelText('Provider'), 'groq')
    await user.click(screen.getByRole('button', { name: 'Use this key' }))
    expect(useAIKey.getState().value).toEqual({ provider: 'groq', key: 'gsk_live_a1b2c3d4e5f6abcdefWXYZ' })
    expect(screen.getByText('…WXYZ')).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveValue('') // not left on screen

    await user.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(useAIKey.getState().value).toBeNull()
  })
})

describe('wake banner', () => {
  it('says the demo server is waking instead of showing an error', async () => {
    useDataSource.setState({ mode: 'waking', attempt: 2 })
    const { container } = render(<WakeBanner />)
    expect(screen.getByRole('status')).toHaveTextContent('Demo server waking up — retrying…')
    expect(await axeViolations(container)).toEqual([])
  })

  it('renders nothing in normal operation', () => {
    useDataSource.setState({ mode: 'live' })
    const { container } = render(<WakeBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('voice note without the Web Speech API (Firefox)', () => {
  it('offers recording and says transcription is unavailable before you start', () => {
    vi.stubGlobal('MediaRecorder', class {})
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
    render(<VoiceRecorder onDone={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument()
    expect(screen.getByText(/can’t transcribe it as you speak/)).toBeInTheDocument()
  })

  it('falls back to typing when recording is unsupported', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    render(<VoiceRecorder onDone={() => undefined} />)
    expect(screen.getByText(/Type a description instead/)).toBeInTheDocument()
  })
})
