import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import type { Taxonomy } from '@/types'

let cache: Taxonomy | null = null
let pending: Promise<Taxonomy> | null = null

export function loadTaxonomy(): Promise<Taxonomy> {
  if (cache) return Promise.resolve(cache)
  pending ??= api.taxonomy().then((t) => (cache = t))
  return pending
}

export function useTaxonomy(): Taxonomy | null {
  const [t, setT] = useState<Taxonomy | null>(cache)
  useEffect(() => {
    if (!cache) loadTaxonomy().then(setT).catch(() => (pending = null))
  }, [])
  return t
}

export function subLabel(t: Taxonomy | null, category: string, sub: string): string {
  const c = t?.categories.find((x) => x.key === category)
  return c?.subcategories.find((s) => s.key === sub)?.label ?? sub.replace(/_/g, ' ')
}

export function catLabel(t: Taxonomy | null, category: string): string {
  return t?.categories.find((x) => x.key === category)?.label ?? category
}
