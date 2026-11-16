import type { StyleSpecification } from 'maplibre-gl'

/**
 * Tile source is configurable:
 *   VITE_MAP_STYLE_URL  any MapLibre style JSON (default: OpenFreeMap Positron, free, no key)
 *   VITE_MAP_STYLE=raster  plain OSM raster tiles (no 3D buildings)
 */
export const MANHATTAN: [number, number] = [-73.9855, 40.7420]
export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-74.06, 40.68],
  [-73.92, 40.79],
]

const RASTER: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: [import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#F4F1EA' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-opacity': 0.9 } },
  ],
}

export function mapStyle(): string | StyleSpecification {
  if (import.meta.env.VITE_MAP_STYLE === 'raster') return RASTER
  return import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron'
}

export const LABEL_FONT = ['Noto Sans Regular']
export const LABEL_FONT_BOLD = ['Noto Sans Bold']

export const COLORS = {
  paper: '#F4F1EA',
  raised: '#FAF8F3',
  ink: '#1C1B19',
  muted: '#5F5A51',
  signal: '#A8360F',
  tint: '#E7DCC3',
}
