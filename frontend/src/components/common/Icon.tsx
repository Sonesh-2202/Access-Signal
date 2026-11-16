import type { SVGProps } from 'react'

/**
 * Hand-drawn 20x20 line icons, 1.5px stroke to match IBM Plex Sans at 14-16px.
 * Decorative by default (aria-hidden); pass `title` to make one meaningful.
 */
const paths: Record<string, string> = {
  map: 'M2.5 5.5 7 3.5l6 2.5 4.5-2v11l-4.5 2-6-2.5-4.5 2Z M7 3.5v11 M13 6v11',
  route: 'M5 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M15 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M6.5 15H12a2.5 2.5 0 0 0 0-5H8a2.5 2.5 0 0 1 0-5h5.5',
  pin: 'M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.5 5.5 9.5 5.5 9.5Z M10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  camera: 'M3 6.5h3l1.5-2h5l1.5 2h3v9H3Z M10 13.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z',
  mic: 'M10 12.5a2.5 2.5 0 0 0 2.5-2.5V5a2.5 2.5 0 0 0-5 0v5a2.5 2.5 0 0 0 2.5 2.5Z M5 9.5a5 5 0 0 0 10 0 M10 14.5v3',
  stop: 'M5.5 5.5h9v9h-9Z',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z m4.25-1.75L17 17',
  close: 'm5 5 10 10M15 5 5 15',
  chevronDown: 'm5.5 8 4.5 4.5L14.5 8',
  chevronRight: 'm8 5.5 4.5 4.5L8 14.5',
  chevronLeft: 'm12 5.5-4.5 4.5 4.5 4.5',
  arrowRight: 'M3.5 10h13 M12 5.5l4.5 4.5-4.5 4.5',
  locate: 'M10 14.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z M10 2.5v3 M10 14.5v3 M2.5 10h3 M14.5 10h3',
  layers: 'm10 3 7.5 4L10 11 2.5 7Z M2.5 10.5 10 14.5l7.5-4 M2.5 13.5 10 17.5l7.5-4',
  list: 'M7 5.5h10 M7 10h10 M7 14.5h10 M3.5 5.5h.5 M3.5 10h.5 M3.5 14.5h.5',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  alert: 'M10 3 18 16.5H2Z M10 8v4 M10 14.25v.25',
  filter: 'M3 5h14 M5.5 10h9 M8 15h4',
  upload: 'M10 13V3.5 M6 7.5l4-4 4 4 M3.5 13v3.5h13V13',
  download: 'M10 3.5V13 M6 9l4 4 4-4 M3.5 13v3.5h13V13',
  menu: 'M3 6h14 M3 10h14 M3 14h14',
  user: 'M10 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z M3.5 17a6.5 6.5 0 0 1 13 0',
  cube: 'm10 2.5 6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5Z M3.5 6.25 10 10l6.5-3.75 M10 10v7.5',
  clock: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z M10 6v4l2.5 2.5',
  external: 'M11 3.5h5.5V9 M16.5 3.5 9 11 M14 12.5v4H3.5V6h4',
  plus: 'M10 4v12 M4 10h12',
  minus: 'M4 10h12',
  play: 'M6.5 4.5v11l9-5.5Z',
  trash: 'M4 6h12 M8 6V4h4v2 M5.5 6l.75 10.5h7.5L14.5 6',
  // category pictograms
  ramp: 'M2.5 15.5h15 M2.5 15.5 14 8h3.5v7.5 M5 10.5V9',
  elevator: 'M4 2.5h12v15H4Z M10 2.5v15 M6.5 8 7.25 6.5 8 8 M12 6.5l.75 1.5.75-1.5',
  sidewalk: 'M2.5 13h6l1.5-3h7.5 M2.5 16.5h15 M12 13.5v3',
  crossing: 'M3 4v12 M17 4v12 M6.5 6h7 M6.5 10h7 M6.5 14h7',
  entrance: 'M4.5 17.5V3.5h8v14 M12.5 5.5l3 1v11 M10 10.5v1 M2.5 17.5h15',
  transit: 'M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8H3.5V5A1.5 1.5 0 0 1 5 3.5Z M3.5 9.5h13 M6.5 13 5 16.5 M13.5 13l1.5 3.5 M6.5 11.25h.5 M13 11.25h.5',
  restroom: 'M6.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M13.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M5 8h3v4.5H7v5H6v-5H5Z M13.5 8l2 6h-4Z M13 14v3.5 M14 14v3.5 M10 2.5v15',
  wayfinding: 'M10 2.5v15 M10 4.5h6l1.5 1.75L16 8h-6 M10 10H4l-1.5 1.75L4 13.5h6',
  other: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z M10 6.5v4.5 M10 13.5v.25',
}

export type IconName = keyof typeof paths

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName | string
  size?: number
  title?: string
}

export function Icon({ name, size = 20, title, className, ...rest }: Props) {
  const d = paths[name] ?? paths.other
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      className={className}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  )
}
