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
    { id: 'bg', type: 'background', paint: { 'background-color': '#F8F6F1' } },
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
  paper: '#F8F6F1',
  raised: '#FCFBF8',
  sunk: '#EFECE6',
  ink: '#1A1917',
  muted: '#5F5A51',
  signal: '#B83A24',
  tint: '#E7DCC3',
  ok: '#1F6E43',
  warn: '#D97706',
  stone: '#E5E0D8',
}
