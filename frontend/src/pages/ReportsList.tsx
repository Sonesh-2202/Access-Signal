import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/common/Button'
import { Field, Input, Segmented, Select } from '@/components/common/Field'
import { ReportRowSkeleton } from '@/components/common/Skeleton'
import { Container, EmptyState, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { ReportRow } from '@/components/reports/ReportRow'
import { useDebounced, useDocumentTitle } from '@/hooks/useAsync'
import { useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { ReportSummary } from '@/types'
import { announce } from '@/utils/announce'

const PAGE = 20

export default function ReportsList() {
  useDocumentTitle('Reports')
  const t = useTaxonomy()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? ''
  const status = (params.get('status') as 'open' | 'resolved' | 'all') ?? 'open'
  const sort = params.get('sort') ?? 'recent'
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q, 350)

  const [items, setItems] = useState<ReportSummary[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<number | null>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const gen = useRef(0)

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  useEffect(() => setParam('q', dq), [dq]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(
    async (offset: number, reset = false) => {
      const g = reset ? ++gen.current : gen.current
      setLoading(true)
      setError(null)
      try {
        const page = await api.reports({
          category: category ? [category] : undefined,
          status: status === 'all' ? ['open', 'resolved'] : [status],
          sort,
          q: dq,
          offset,
          limit: PAGE,
        })
        if (g !== gen.current) return
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
        setTotal(page.total)
        setNext(page.next_offset)
        if (reset) announce(`${page.total} reports found`)
      } catch (e) {
        if (g === gen.current) setError(e as Error)
      } finally {
        if (g === gen.current) setLoading(false)
      }
    },
    [category, status, sort, dq],
  )

  useEffect(() => {
    load(0, true)
  }, [load])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && next !== null && !loading) load(next)
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, loading, load])

  return (
    <Container>
      <PageHeader eyebrow="All reports" title="Barrier reports" aside={<ButtonLink to="/map?view=list" variant="ghost">Open on map</ButtonLink>}>
        Every report filed in the service area. Confirmations of the same barrier are folded into the original.
      </PageHeader>

      <div className="grid gap-4 py-4 md:grid-cols-12">
        <form className="flex flex-col gap-2 md:col-span-3" role="search" onSubmit={(e) => e.preventDefault()} aria-label="Filter reports">
          <div className="md:sticky md:top-[96px] flex flex-col gap-2">
            <Field label="Search descriptions and addresses">
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. elevator, 34th" />
            </Field>
            <Segmented
              legend="Status"
              value={status}
              onChange={(v) => setParam('status', v === 'open' ? '' : v)}
              options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]}
            />
            <Field label="Barrier type">
              <Select value={category} onChange={(e) => setParam('category', e.target.value)}>
                <option value="">All types</option>
                {t?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Sort by">
              <Select value={sort} onChange={(e) => setParam('sort', e.target.value === 'recent' ? '' : e.target.value)}>
                <option value="recent">Most recent</option>
                <option value="severity">Most severe</option>
                <option value="confidence">Highest confidence</option>
              </Select>
            </Field>
          </div>
        </form>

        <section className="md:col-span-8 md:col-start-5" aria-labelledby="results-h" aria-busy={loading}>
          <h2 id="results-h" className="meta border-b border-hair pb-1">
            {loading && !items.length ? 'Loading…' : `${total} report${total === 1 ? '' : 's'}`}
          </h2>
          {error && <ErrorNote error={error} onRetry={() => load(0, true)} />}
          {!loading && !error && items.length === 0 && (
            <EmptyState title="Nothing matches">Try a different type or clear the search.</EmptyState>
          )}
          {items.map((r) => <ReportRow key={r.id} report={r} headingLevel="h3" />)}
          {loading && Array.from({ length: items.length ? 2 : 5 }).map((_, i) => <ReportRowSkeleton key={i} />)}
          <div ref={sentinel} />
          {next !== null && !loading && items.length > 0 && (
            <div className="py-2">
              <Button variant="ghost" onClick={() => load(next)}>Load more</Button>
            </div>
          )}
        </section>
      </div>
    </Container>
  )
}
