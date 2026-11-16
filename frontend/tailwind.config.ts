import type { Config } from 'tailwindcss'

/**
 * AccessSignal design tokens.
 *
 * Core colours:
 *   paper  #F8F6F1  warm off-white surface (sunk #EFECE6 for secondary containers)
 *   ink    #1A1917  primary text (16.6:1 on paper, AAA)
 *   muted  #5F5A51  secondary text (6.4:1 on paper; borders use ink at 10-18% alpha)
 *   signal #B83A24  terracotta accent: critical barriers, primary actions, focus (5.3:1 on paper)
 *   tint   #E7DCC3  understated ochre wash for tags and selected rows
 * State colours: ok #1F6E43 (resolved / verified), warn #D97706 (under review / repair).
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
      paper: { DEFAULT: '#F8F6F1', raised: '#FCFBF8', sunk: '#EFECE6' },
      ink: { DEFAULT: '#1A1917', soft: '#2E2C28' },
      muted: { DEFAULT: '#5F5A51' },
      signal: { DEFAULT: '#B83A24', deep: '#93301D', wash: '#F6E4DE' },
      tint: { DEFAULT: '#E7DCC3', deep: '#D9CBA9' },
      // State colours. Used for status marks only, never as decoration.
      // `ok` 6.2:1 on paper. `warn` is a fill colour; text uses `warn.deep` (7.4:1).
      ok: { DEFAULT: '#1F6E43', wash: '#E2EDE5' },
      warn: { DEFAULT: '#D97706', deep: '#8A4B05', wash: '#FBEEDA' },
      stone: { 200: '#E5E0D8', 300: '#D6D3D1' },
      // Structural lines: ink at low alpha, not additional colours.
      hair: 'rgba(26, 25, 23, 0.10)',
      rule: 'rgba(26, 25, 23, 0.18)',
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
