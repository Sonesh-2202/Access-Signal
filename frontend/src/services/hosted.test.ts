import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAIKey, setAIKey } from '@/stores/aiKey'
import { beginWaking, configureWake, resetWake, useDataSource } from '@/stores/dataSource'
import { aiPrivacyNote, aiSourceLabel, aiSourceShort } from '@/utils/aiSource'
import { api, apiUrl, resetDataSourceProbe, setColdStart } from './api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function reset() {
  vi.restoreAllMocks()
  useDataSource.setState({ mode: 'unknown', reason: null, epoch: 0, attempt: 0, wokeAt: null })
  resetDataSourceProbe()
  resetWake()
  setColdStart(false)
  clearAIKey()
}

describe('hosted demo: sleeping server', () => {
  beforeEach(reset)
  afterEach(reset)

  it('shows local data at once, pings with backoff, then switches to live data', async () => {
    setColdStart(true)
    let pings = 0
    configureWake(async () => ++pings >= 3, async () => undefined)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const modes: string[] = []
    const unsub = useDataSource.subscribe((s, prev) => s.mode !== prev.mode && modes.push(s.mode))
    const o = await api.overview()
    expect(o.open_reports).toBe(42) // bundled dataset, no error shown
    await vi.waitFor(() => expect(useDataSource.getState().mode).toBe('live'))
    unsub()
    expect(modes).toEqual(['waking', 'live'])
    expect(pings).toBe(3)
    expect(useDataSource.getState().epoch).toBe(1) // pages refetch
  })

  it('drops to the demo dataset if the server never answers', async () => {
    configureWake(async () => false, async () => undefined)
    expect(await beginWaking('test')).toBe(false)
    expect(useDataSource.getState().mode).toBe('demo')
    expect(useDataSource.getState().reason).toContain('no answer after')
  })

  it('holds a write until the server is awake, then sends it once', async () => {
    setColdStart(true)
    let wake!: () => void
    configureWake(() => new Promise<boolean>((r) => (wake = () => r(true))), async () => undefined)
    void beginWaking('asleep')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 60, user: {} }))
    const login = api.login('a@b.org', 'x')
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
    wake()
    await login
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries a write that failed to connect, after waking', async () => {
    setColdStart(true)
    configureWake(async () => true, async () => undefined)
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 60, user: {} }))
    await api.login('a@b.org', 'x')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('local mode keeps the old behaviour: straight to demo data, no banner', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await api.overview()
    expect(useDataSource.getState().mode).toBe('demo')
  })
})

describe('bring your own key', () => {
  beforeEach(reset)
  afterEach(reset)

  it('sends the key only to classification, and keeps it out of localStorage', async () => {
    setAIKey('gemini', 'AIzaTestKey-0123456789abcdef')
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ items: [], total: 0, next_offset: null, category: 'other', subcategory: 'other', severity: 0, summary: '', confidence: 0, source: 'gemini', model: 'm' }),
    )
    await api.classify('ramp blocked', [])
    await api.reports({ limit: 1 })
    const headersOf = (i: number) => (fetch.mock.calls[i][1]?.headers ?? {}) as Record<string, string>
    expect(String(fetch.mock.calls[0][0])).toContain('/api/reports/classify')
    expect(headersOf(0)['X-AI-Key']).toBe('AIzaTestKey-0123456789abcdef')
    expect(headersOf(0)['X-AI-Provider']).toBe('gemini')
    expect(headersOf(1)['X-AI-Key']).toBeUndefined()
    expect(sessionStorage.getItem('accesssignal.aiKey')).toContain('gemini')
    expect(JSON.stringify({ ...localStorage })).not.toContain('AIzaTestKey')
    clearAIKey()
    expect(sessionStorage.getItem('accesssignal.aiKey')).toBeNull()
  })
})

describe('explainability labels', () => {
  it('names the tier that produced each result', () => {
    expect(aiSourceLabel('lmstudio')).toBe('Local AI (LM Studio)')
    expect(aiSourceLabel('ollama')).toBe('Local AI (Ollama)')
    expect(aiSourceLabel('gemini')).toBe('Cloud AI (Gemini)')
    expect(aiSourceLabel('groq')).toBe('Cloud AI (Groq)')
    expect(aiSourceLabel('heuristic')).toBe('Keyword rules, AI offline')
    expect(aiSourceShort('nebius')).toBe('Cloud AI (Nebius)')
  })

  it('tells reporters where their evidence goes', () => {
    expect(aiPrivacyNote({ available: true, provider: 'ollama', model: 'm', fallback_enabled: true }, false)).toContain('own server')
    expect(aiPrivacyNote({ available: true, provider: 'gemini', model: 'm', fallback_enabled: true }, false)).toContain('Gemini')
    expect(aiPrivacyNote({ available: false, model: null, fallback_enabled: true }, false)).toContain('keyword rules')
    expect(aiPrivacyNote(undefined, true)).toContain('key you added')
  })

  it('points evidence links at the API origin', () => {
    expect(apiUrl('/api/evidence/1/file')).toBe('/api/evidence/1/file') // same origin in tests
    expect(apiUrl('blob:abc')).toBe('blob:abc')
    expect(apiUrl(null)).toBeUndefined()
  })
})
