import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl'
import { severityBand } from '@/utils/format'
import { COLORS } from './config'

export interface PulseProps {
  id: string
  severity: number
  confidence: number
  status: string
  label?: string
  address?: string
}

const BAND_COLOR = { critical: COLORS.signal, high: COLORS.signal, medium: COLORS.warn, low: COLORS.muted } as const
const BAND_PERIOD = { critical: 1.6, high: 2.2, medium: 3, low: 3.6 } as const
const BAND_SIZE = { critical: 30, high: 26, medium: 22, low: 20 } as const

/** Stable 0..1 value from an id, used to stagger pulses so they never beat in sync. */
function phase(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

/**
 * Report marker. Severity sets colour, size and pulse speed; verification sets the ring:
 * solid = confidence ≥ 60 (corroborated), dashed = not yet verified. Resolved reports
 * get an emerald check and no pulse. Shape and ring style carry the meaning without colour.
 */
export function pulseMarkerEl(p: PulseProps, emphasis = false): HTMLElement {
  const resolved = p.status === 'resolved'
  const band = severityBand(p.severity)
  const color = resolved ? COLORS.ok : BAND_COLOR[band]
  const size = emphasis ? 36 : resolved ? 18 : BAND_SIZE[band]
  const verified = p.confidence >= 0.6
  const el = document.createElement('div')
  el.className = 'as-marker'
  el.style.setProperty('--period', `${BAND_PERIOD[band]}s`)
  el.style.setProperty('--delay', `${-phase(p.id) * BAND_PERIOD[band]}s`)
  el.style.width = el.style.height = `${size}px`
  el.dataset.id = p.id
  el.setAttribute('aria-hidden', 'true')
  const core = band === 'critical' || emphasis ? 6.5 : band === 'high' ? 6 : 5
  el.innerHTML = `
    <svg viewBox="0 0 32 32" width="${size}" height="${size}">
      ${resolved ? '' : `<circle class="as-marker-pulse" cx="16" cy="16" r="${core + 1}" fill="${color}"/>`}
      <circle cx="16" cy="16" r="${core + 4.5}" fill="${COLORS.raised}" fill-opacity="0.92" stroke="${color}" stroke-width="1.5" ${verified ? '' : 'stroke-dasharray="2.6 2.2"'}/>
      ${
        resolved
          ? `<path d="m11.5 16.3 3 3 6-6.4" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
          : band === 'high'
            ? `<circle cx="16" cy="16" r="${core}" fill="${COLORS.raised}" stroke="${color}" stroke-width="2.5"/>`
            : `<circle cx="16" cy="16" r="${core}" fill="${color}"/>`
      }
    </svg>`
  return el
}

/**
 * Mirrors the unclustered points of the `reports` source as HTML markers. Clusters stay
 * on the canvas. The circle layer is kept, transparent, for hover rings and hit tests.
 */
export function syncReportMarkers(map: MLMap, onClick: (p: PulseProps, lngLat: [number, number]) => void): { refresh: () => void; destroy: () => void } {
  const markers = new Map<string, Marker>()
  map.setPaintProperty('report-points', 'circle-opacity', 0)
  map.setPaintProperty('report-points', 'circle-stroke-opacity', 0)

  const update = () => {
    if (!map.getSource('reports')) return
    const visible = map.getLayoutProperty('report-points', 'visibility') !== 'none'
    const seen = new Set<string>()
    if (visible) {
      for (const f of map.querySourceFeatures('reports')) {
        const props = f.properties as Record<string, unknown>
        if (props.cluster) continue
        const id = String(props.id)
        if (seen.has(id)) continue
        seen.add(id)
        if (markers.has(id)) continue
        const p: PulseProps = { id, severity: Number(props.severity), confidence: Number(props.confidence), status: String(props.status), label: String(props.label ?? ''), address: props.address ? String(props.address) : undefined }
        const at = (f.geometry as GeoJSON.Point).coordinates as [number, number]
        const el = pulseMarkerEl(p)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onClick(p, at)
        })
        markers.set(id, new maplibregl.Marker({ element: el, pitchAlignment: 'viewport' }).setLngLat(at).addTo(map))
      }
    }
    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        m.remove()
        markers.delete(id)
      }
    }
  }

  const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
    if (e.sourceId === 'reports' && e.isSourceLoaded) update()
  }
  map.on('sourcedata', onData)
  map.on('moveend', update)
  update()
  return {
    refresh: update,
    destroy: () => {
      map.off('sourcedata', onData)
      map.off('moveend', update)
      markers.forEach((m) => m.remove())
      markers.clear()
    },
  }
}

/** Static set of markers from a FeatureCollection (no clustering), e.g. on the route map. */
export function placeMarkers(map: MLMap, fc: GeoJSON.FeatureCollection, emphasis?: (id: string) => boolean): Marker[] {
  return fc.features.map((f) => {
    const props = f.properties as Record<string, unknown>
    const p: PulseProps = { id: String(props.id), severity: Number(props.severity), confidence: Number(props.confidence), status: String(props.status ?? 'open') }
    return new maplibregl.Marker({ element: pulseMarkerEl(p, emphasis?.(p.id)), pitchAlignment: 'viewport' })
      .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
      .addTo(map)
  })
}

