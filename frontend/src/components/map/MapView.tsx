import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl, { type Map as MLMap } from 'maplibre-gl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { hasWebGL, prefersReducedMotion } from '@/utils/webgl'
import { MANHATTAN, MAX_BOUNDS, mapStyle } from './config'

interface Props {
  label: string
  center?: [number, number]
  zoom?: number
  onReady?: (map: MLMap) => void
  className?: string
  /** Rendered when WebGL is unavailable. Pages pass their list view here. */
  fallback?: ReactNode
  interactive?: boolean
  children?: ReactNode
}

/**
 * MapLibre wrapper. The map is supplementary: every page that uses it also offers the
 * same information as text (list view, directions, tables), per WCAG 1.1.1.
 */
export function MapView({ label, center = MANHATTAN, zoom = 13, onReady, className, fallback, interactive = true, children }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(() => !hasWebGL())
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  useEffect(() => {
    if (failed || !el.current) return
    let map: MLMap
    try {
      map = new maplibregl.Map({
        container: el.current,
        style: mapStyle(),
        center,
        zoom,
        maxBounds: MAX_BOUNDS,
        attributionControl: { compact: true },
        interactive,
        fadeDuration: prefersReducedMotion() ? 0 : 200,
        cooperativeGestures: false,
      })
    } catch {
      setFailed(true)
      return
    }
    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    }
    map.getCanvas().setAttribute('aria-label', `${label}. Use arrow keys to pan, plus and minus to zoom.`)
    map.getCanvas().setAttribute('role', 'application')
    map.on('load', () => {
      // The container may have been laid out after construction; re-measure and re-centre.
      map.resize()
      map.jumpTo({ center, zoom })
      if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map
      readyRef.current?.(map)
    })
    map.on('error', (e) => {
      // Tile/style errors are logged but the map keeps working with what it has.
      console.warn('map error', e.error?.message)
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed])

  if (failed) {
    return (
      <div className={cx('flex flex-col justify-center border border-hair bg-paper-sunk p-3', className)} role="note">
        <p className="font-display text-lg">Map view isn’t available in this browser</p>
        <p className="mt-0.5 text-sm text-muted">WebGL is turned off or unsupported. The list below has the same information.</p>
        {fallback}
      </div>
    )
  }

  return (
    <div className={cx('relative', className)} role="region" aria-label={label}>
      {/* Inline style: maplibre's own .maplibregl-map rule sets position:relative on this node. */}
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  )
}

export function fitTo(map: MLMap, coords: [number, number][], padding = 64) {
  if (!coords.length) return
  const b = new maplibregl.LngLatBounds(coords[0], coords[0])
  coords.forEach((c) => b.extend(c))
  map.fitBounds(b, { padding, duration: prefersReducedMotion() ? 0 : 400, maxZoom: 17 })
}
