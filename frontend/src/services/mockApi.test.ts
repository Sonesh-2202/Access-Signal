import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_TRIPS, OVERVIEW, PRESET_ROUTES, REPORTS } from '@/data/mockManhattanData'
import { useDataSource } from '@/stores/dataSource'
import { api, resetDataSourceProbe } from './api'
import * as local from './mockApi'

describe('local Manhattan dataset', () => {
  it('has the headline figures the pages quote', () => {
    expect(REPORTS.length).toBeGreaterThanOrEqual(25)
    expect(OVERVIEW.open_reports).toBe(42)
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length)
  })

  it('filters, sorts and pages reports like the API', () => {
    const page = local.reports({ status: ['open'], sort: 'severity', limit: 5 })
    expect(page.items).toHaveLength(5)
    expect(page.total).toBe(42)
    expect(page.next_offset).toBe(5)
    const sev = page.items.map((r) => r.severity_score)
    expect([...sev].sort((a, b) => b - a)).toEqual(sev)
    expect(local.reports({ q: 'EL204' }).items[0].id).toBe('rpt-0001')
  })

  it('builds a blocked direct route and a step-free detour for every demo trip', () => {
    for (const t of DEMO_TRIPS) {
      const wc = PRESET_ROUTES[t.id].wheelchair
      const [stepFree, direct] = wc.routes
      expect(direct.barriers_on_route).toBe(1)
      expect(stepFree.barriers_on_route).toBe(0)
      expect(stepFree.barriers_avoided).toBe(1)
      expect(stepFree.distance_m).toBeGreaterThan(direct.distance_m)
      // The blocked route really passes through the barrier's coordinates.
      const b = direct.segments.flatMap((s) => s.barriers)[0]
      const r = REPORTS.find((x) => x.id === b.report_id)!
      const near = direct.geometry.coordinates.some(([lng, lat]) => Math.hypot((lng - r.lng) * 84_000, (lat - r.lat) * 110_540) < 5)
      expect(near).toBe(true)
    }
  })

  it('resolves corroborating report ids to a detail', () => {
    const d = local.report('rpt-0005')
    expect(d.corroborating.length).toBeGreaterThan(0)
    expect(local.report(d.corroborating[0].id).duplicate_of).toBe('rpt-0005')
  })
})

describe('api fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useDataSource.setState({ mode: 'unknown', reason: null })
    resetDataSourceProbe()
  })

  it('answers from the local dataset when the API returns 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }))
    const page = await api.reports({ status: ['open'], limit: 3 })
    expect(page.items).toHaveLength(3)
    expect(useDataSource.getState().mode).toBe('demo')
  })

  it('answers from the local dataset on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const o = await api.overview()
    expect(o.open_reports).toBe(42)
  })

  it('passes real client errors through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Report not found' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    )
    await expect(api.report('nope')).rejects.toThrow('Report not found')
    expect(useDataSource.getState().mode).toBe('unknown')
  })
})
