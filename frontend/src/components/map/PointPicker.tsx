import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { COLORS } from './config'
import { MapView } from './MapView'

interface Props {
  value: { lat: number; lng: number } | null
  onChange: (p: { lat: number; lng: number }) => void
  className?: string
}

function markerEl(): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 35s12-11 12-21A12 12 0 0 0 2 14c0 10 12 21 12 21Z" fill="${COLORS.signal}" stroke="${COLORS.paper}" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="${COLORS.paper}"/></svg>`
  el.style.cursor = 'grab'
  return el
}

/** Click or drag to set a point. Keyboard users set location via search or "use my location". */
export function PointPicker({ value, onChange, className }: Props) {
  const map = useRef<MLMap | null>(null)
  const marker = useRef<Marker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    const m = map.current
    if (!m || !value) return
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ element: markerEl(), draggable: true, anchor: 'bottom' })
        .setLngLat([value.lng, value.lat])
        .addTo(m)
      marker.current.on('dragend', () => {
        const ll = marker.current!.getLngLat()
        cb.current({ lat: ll.lat, lng: ll.lng })
      })
    } else {
      marker.current.setLngLat([value.lng, value.lat])
    }
    const c = m.getCenter()
    if (Math.abs(c.lat - value.lat) > 0.002 || Math.abs(c.lng - value.lng) > 0.002) m.easeTo({ center: [value.lng, value.lat], zoom: Math.max(m.getZoom(), 16) })
  }, [value])

  return (
    <MapView
      label="Location picker map. Click to place the report marker."
      center={value ? [value.lng, value.lat] : undefined}
      zoom={value ? 17 : 13}
      className={className}
      onReady={(m) => {
        map.current = m
        m.on('click', (e) => cb.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
        if (value) {
          // trigger marker creation
          cb.current({ ...value })
        }
      }}
    />
  )
}
