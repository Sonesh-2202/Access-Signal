import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import { COLORS, LABEL_FONT, LABEL_FONT_BOLD } from './config'

export function setData(map: MLMap, id: string, data: GeoJSON.GeoJSON) {
  const src = map.getSource(id) as GeoJSONSource | undefined
  if (src) src.setData(data as GeoJSON.FeatureCollection)
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
}

/** Reports as clustered points. Severity is encoded by size *and* fill/outline so it
 *  doesn't rely on colour alone. */
export function addReportLayers(map: MLMap) {
  if (map.getSource('reports')) return
  map.addSource('reports', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 36,
    clusterMaxZoom: 16,
    clusterProperties: { maxSeverity: ['max', ['get', 'severity']] },
  })
  map.addLayer({
    id: 'report-clusters',
    type: 'circle',
    source: 'reports',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['case', ['>=', ['get', 'maxSeverity'], 0.85], COLORS.signal, COLORS.ink],
      'circle-radius': ['step', ['get', 'point_count'], 14, 5, 18, 15, 22],
      'circle-stroke-color': COLORS.paper,
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'report-cluster-count',
    type: 'symbol',
    source: 'reports',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': LABEL_FONT_BOLD, 'text-size': 12 },
    paint: { 'text-color': COLORS.paper },
  })
  map.addLayer({
    id: 'report-points',
    type: 'circle',
    source: 'reports',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['step', ['get', 'severity'], 5, 0.4, 6, 0.65, 7, 0.85, 8],
      'circle-color': [
        'case',
        ['==', ['get', 'status'], 'resolved'], COLORS.raised,
        ['>=', ['get', 'severity'], 0.85], COLORS.signal,
        ['>=', ['get', 'severity'], 0.65], COLORS.raised,
        ['>=', ['get', 'severity'], 0.4], COLORS.ink,
        COLORS.raised,
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'status'], 'resolved'], COLORS.muted,
        ['>=', ['get', 'severity'], 0.65], COLORS.signal,
        COLORS.ink,
      ],
      'circle-stroke-width': ['case', ['>=', ['get', 'severity'], 0.85], 2, 2],
    },
  })
  map.addLayer({
    id: 'report-selected',
    type: 'circle',
    source: 'reports',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': COLORS.ink, 'circle-stroke-width': 2 },
  })
  map.on('click', 'report-clusters', async (e) => {
    const f = e.features?.[0]
    if (!f) return
    const src = map.getSource('reports') as GeoJSONSource
    const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id)
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
  })
  for (const l of ['report-clusters', 'report-points']) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  }
}

export function addPlaceLayer(map: MLMap) {
  if (map.getSource('places')) return
  map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'place-points',
    type: 'circle',
    source: 'places',
    // Places only appear at street level, drawn small and muted so they never read as reports.
    minzoom: 15,
    paint: {
      'circle-radius': 3,
      'circle-color': ['match', ['get', 'verification'], 'disputed', COLORS.tint, 'verified', COLORS.muted, COLORS.raised],
      'circle-stroke-color': COLORS.muted,
      'circle-stroke-width': 1,
    },
  }, 'report-clusters')
  map.addLayer({
    id: 'place-labels',
    type: 'symbol',
    source: 'places',
    minzoom: 15,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': LABEL_FONT,
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-max-width': 10,
    },
    paint: { 'text-color': COLORS.muted, 'text-halo-color': COLORS.paper, 'text-halo-width': 1.5 },
  })
  map.on('mouseenter', 'place-points', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'place-points', () => (map.getCanvas().style.cursor = ''))
}

export function addHeatLayer(map: MLMap) {
  if (map.getSource('heat')) return
  map.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'heat',
    maxzoom: 17,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 4],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 22, 16, 48],
      'heatmap-opacity': 0.85,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(248,246,241,0)',
        0.25, 'rgba(231,220,195,0.7)',
        0.6, 'rgba(217,203,169,0.9)',
        1, COLORS.signal,
      ],
    },
  }, firstSymbolLayer(map))
}

export function addHotspotLayer(map: MLMap) {
  if (map.getSource('hotspots')) return
  map.addSource('hotspots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'hotspot-fill',
    type: 'fill',
    source: 'hotspots',
    paint: { 'fill-color': COLORS.signal, 'fill-opacity': ['*', 0.18, ['get', 'severity']] },
  }, firstSymbolLayer(map))
  map.addLayer({
    id: 'hotspot-line',
    type: 'line',
    source: 'hotspots',
    paint: { 'line-color': COLORS.signal, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  })
}

export function addCoverageLayer(map: MLMap) {
  if (map.getSource('coverage')) return
  map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'coverage-fill',
    type: 'fill',
    source: 'coverage',
    paint: {
      'fill-color': ['match', ['get', 'level'], 'none', COLORS.ink, 'low', COLORS.tint, 'rgba(0,0,0,0)'],
      'fill-opacity': ['match', ['get', 'level'], 'none', 0.12, 'low', 0.45, 0],
    },
  }, firstSymbolLayer(map))
  map.addLayer({
    id: 'coverage-line',
    type: 'line',
    source: 'coverage',
    filter: ['==', ['get', 'level'], 'none'],
    paint: { 'line-color': COLORS.ink, 'line-opacity': 0.2, 'line-width': 0.5 },
  })
}

export function setVisible(map: MLMap, ids: string[], on: boolean) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

/** Camera for "3D street perspective": tilted, and rotated so avenues run straight up the screen. */
export const STREET_PERSPECTIVE = { pitch: 50, bearing: -29 }

/** Extruded buildings from the OpenMapTiles schema (OpenFreeMap). No-op for raster styles. */
export function set3D(map: MLMap, on: boolean, opts: { animate?: boolean } = {}): boolean {
  const hasVector = !!map.getSource('openmaptiles')
  if (on && hasVector && !map.getLayer('buildings-3d')) {
    // Draw below whichever data layer comes first so pins and routes stay on top.
    const before = ['route-casing', 'route-line', 'hotspot-fill', 'heat', 'coverage-fill', 'report-clusters', 'plist'].find((id) => map.getLayer(id))
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13.5,
      paint: {
        // Warm limestone, a little darker as buildings get taller.
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, '#EFECE6', 40, '#E5E0D8', 180, '#D6CFC4'],
        // Grow out of the ground as the tiles load rather than popping in.
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, ['coalesce', ['get', 'render_height'], 0]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': true,
      },
    }, before)
    map.setLight({ anchor: 'viewport', color: '#FFF8EE', intensity: 0.32, position: [1.2, 200, 35] })
  }
  if (map.getLayer('buildings-3d')) setVisible(map, ['buildings-3d'], on)
  const target = on ? { ...STREET_PERSPECTIVE, zoom: Math.max(map.getZoom(), 15) } : { pitch: 0, bearing: 0 }
  const still = opts.animate === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (still) map.jumpTo(target)
  else map.easeTo({ ...target, duration: 1100, easing: (t) => 1 - Math.pow(1 - t, 4) })
  return hasVector
}
