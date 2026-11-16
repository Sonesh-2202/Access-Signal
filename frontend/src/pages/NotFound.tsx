import { Link } from 'react-router-dom'
import { Container } from '@/components/layout/Layout'
import { useDocumentTitle } from '@/hooks/useAsync'

export function NotFound() {
  useDocumentTitle('Page not found')
  return (
    <Container className="grid py-12 md:grid-cols-12">
      <div className="md:col-span-6 md:col-start-3">
        <p className="meta">404</p>
        <h1 className="mt-1 text-4xl tracking-[-0.02em]">This page doesn’t exist</h1>
        <p className="mt-2 text-lg text-muted">
          The link may be old, or the report it pointed to was removed. Try the <Link to="/map">map</Link> or the{' '}
          <Link to="/reports">list of reports</Link>.
        </p>
      </div>
    </Container>
  )
}
