import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { axeViolations } from '@/test/a11y'
import type { RouteRisk } from '@/types'
import { RiskBreakdown } from './RiskBreakdown'

const RISK: RouteRisk = {
  enabled: true,
  threshold: 0.5,
  high_risk_avoided: 3,
  avoided_streets: ['East 14th Street', 'Broadway', 'Park Avenue South'],
  extra_m: 170,
  summary: 'Avoids 3 high-risk corridors (East 14th Street, Broadway, Park Avenue South), +170 m compared with the shortest walk.',
  formula: 'Corridor risk is 0 to 1 for each street segment.',
  on_route: [
    {
      street: 'Union Square West',
      risk: 0.64,
      breakdown: { hotspots: 1, open_issues: 3, mean_confidence: 0.8, time_multiplier: 1.2, risk: 0.64 },
    },
  ],
}

describe('corridor risk breakdown', () => {
  it('states the trade-off in words and lists each risky street with its inputs', () => {
    render(<RiskBreakdown risk={RISK} />)
    expect(screen.getByRole('region', { name: 'Corridor risk' })).toBeInTheDocument()
    expect(screen.getByText(/Avoids 3 high-risk corridors/)).toBeInTheDocument()
    const item = screen.getByText(/Union Square West: risk 0\.64/)
    expect(item).toHaveTextContent('1 hotspot')
    expect(item).toHaveTextContent('3 open reports')
    expect(item).toHaveTextContent('mean confidence 0.80')
    expect(item).toHaveTextContent('time factor 1.20')
  })

  it('links to the methodology section that explains the formula', () => {
    render(<RiskBreakdown risk={RISK} />)
    expect(screen.getByRole('link', { name: 'methodology' })).toHaveAttribute('href', '/methodology#reliable-routes')
  })

  it('says so when no street on the route is high risk', () => {
    render(<RiskBreakdown risk={{ ...RISK, on_route: [], high_risk_avoided: 0 }} />)
    expect(screen.getByText('No street on this route has high corridor risk.')).toBeInTheDocument()
  })

  it('passes axe', async () => {
    const { container } = render(<RiskBreakdown risk={RISK} />)
    expect(await axeViolations(container)).toEqual([])
    expect(within(container).getByRole('heading', { name: 'Corridor risk' })).toBeInTheDocument()
  })
})
