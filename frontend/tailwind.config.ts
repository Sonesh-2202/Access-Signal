import type { Config } from 'tailwindcss'

/**
 * AccessSignal design tokens.
 *
 * Five colours only:
 *   paper  #F4F1EA  warm off-white surface
 *   ink    #1C1B19  primary text (15.3:1 on paper, AAA)
 *   muted  #5F5A51  secondary text (6.1:1 on paper, 5.0:1 on tint; borders use ink at 6-18% alpha)
 *   signal #A8360F  the single accent: critical barriers, primary actions, focus (5.8:1 on paper)
 *   tint   #E7DCC3  understated ochre wash for tags and selected rows
 * (Ratios measured with the WCAG 2.x relative luminance formula.)
 *
 * Spacing is a strict 8px scale. Tailwind's default numeric spacing is replaced so
 * that `p-1` = 8px, `p-2` = 16px, etc. Half-steps exist only for hairline UI (4px).
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      paper: { DEFAULT: '#F4F1EA', raised: '#FAF8F3', sunk: '#ECE7DC' },
      ink: { DEFAULT: '#1C1B19', soft: '#2E2C28' },
      muted: { DEFAULT: '#5F5A51' },
      signal: { DEFAULT: '#A8360F', deep: '#862B0C', wash: '#F3E2D8' },
      tint: { DEFAULT: '#E7DCC3', deep: '#D9CBA9' },
      // Structural lines: ink at low alpha, not additional colours.
      hair: 'rgba(28, 27, 25, 0.10)',
      rule: 'rgba(28, 27, 25, 0.18)',
      white: '#FFFFFF',
    },
    spacing: {
      0: '0px',
      px: '1px',
      0.5: '4px',
      1: '8px',
      2: '16px',
      3: '24px',
      4: '32px',
      5: '40px',
      6: '48px',
      7: '56px',
      8: '64px',
      10: '80px',
      12: '96px',
      16: '128px',
      20: '160px',
      24: '192px',
    },
    fontFamily: {
      display: ['"Newsreader Variable"', 'Georgia', 'serif'],
      sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1rem' }],
      sm: ['0.875rem', { lineHeight: '1.375rem' }],
      base: ['1rem', { lineHeight: '1.625rem' }],
      lg: ['1.125rem', { lineHeight: '1.75rem' }],
      xl: ['1.375rem', { lineHeight: '1.875rem' }],
      '2xl': ['1.75rem', { lineHeight: '2.125rem' }],
      '3xl': ['2.25rem', { lineHeight: '2.5rem' }],
      '4xl': ['3rem', { lineHeight: '3.25rem' }],
      '5xl': ['4rem', { lineHeight: '4.125rem' }],
    },
    borderRadius: {
      none: '0',
      sm: '2px',
      DEFAULT: '4px',
      md: '6px',
      full: '9999px',
    },
    extend: {
      maxWidth: {
        prose: '64ch',
        page: '1280px',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
}

export default config
