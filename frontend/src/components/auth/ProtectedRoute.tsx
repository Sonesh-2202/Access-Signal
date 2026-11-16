import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { isStaff, useAuth } from '@/stores/auth'
import { Container, EmptyState } from '../layout/Layout'
import { Skeleton } from '../common/Skeleton'

export function ProtectedRoute({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) {
    return (
      <Container className="py-8" >
        <div role="status" aria-label="Checking your session">
          <Skeleton className="h-[40px] w-[50%]" />
          <Skeleton className="mt-2 h-[16px] w-[70%]" />
        </div>
      </Container>
    )
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (staff && !isStaff(user)) {
    return (
      <Container className="py-8">
        <EmptyState title="This area is for infrastructure staff">
          Your account can report barriers and check places. Issue management is limited to city and transit staff
          accounts.
        </EmptyState>
      </Container>
    )
  }
  return <>{children}</>
}
