import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { Skeleton } from './components/common/Skeleton'
import { Container, Layout } from './components/layout/Layout'
import { refreshSession } from './services/api'
import { readRefreshToken, useAuth } from './stores/auth'
import { Home } from './pages/Home'
import { LoginPage, RegisterPage } from './pages/Auth'
import { NotFound } from './pages/NotFound'
import { AccessibilityStatement, Methodology, Privacy, Terms } from './pages/Legal'

// Map-heavy and staff pages are split out so the landing page stays light.
const MapPage = lazy(() => import('./pages/MapPage'))
const ReportNew = lazy(() => import('./pages/ReportNew'))
const ReportDetailPage = lazy(() => import('./pages/ReportDetail'))
const ReportsList = lazy(() => import('./pages/ReportsList'))
const RoutePlanner = lazy(() => import('./pages/RoutePlanner'))
const PlacesPage = lazy(() => import('./pages/Places'))
const PlaceProfile = lazy(() => import('./pages/PlaceProfile'))
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
const IssueDetailPage = lazy(() => import('./pages/dashboard/IssueDetail'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Settings = lazy(() => import('./pages/Settings'))

function PageFallback() {
  return (
    <Container className="py-8">
      <div role="status" aria-label="Loading page">
        <Skeleton className="h-[12px] w-[120px]" />
        <Skeleton className="mt-2 h-[44px] w-[60%]" />
        <Skeleton className="mt-2 h-[18px] w-[45%]" />
        <Skeleton className="mt-6 h-[320px] w-full" />
      </div>
    </Container>
  )
}

function useSessionBootstrap() {
  useEffect(() => {
    if (readRefreshToken()) refreshSession().finally(() => useAuth.getState().markReady())
    else useAuth.getState().markReady()
  }, [])
}

export function App() {
  useSessionBootstrap()
  const s = (el: React.ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>
  return (
    <Routes>
      <Route element={<Layout fullBleed />}>
        <Route path="/map" element={s(<MapPage />)} />
      </Route>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/route" element={s(<RoutePlanner />)} />
        <Route path="/reports" element={s(<ReportsList />)} />
        <Route path="/reports/:id" element={s(<ReportDetailPage />)} />
        <Route path="/report" element={s(<ProtectedRoute><ReportNew /></ProtectedRoute>)} />
        <Route path="/places" element={s(<PlacesPage />)} />
        <Route path="/places/:id" element={s(<PlaceProfile />)} />
        <Route path="/analytics" element={s(<Analytics />)} />
        <Route path="/settings" element={s(<Settings />)} />
        <Route path="/dashboard" element={s(<ProtectedRoute staff><Dashboard /></ProtectedRoute>)} />
        <Route path="/dashboard/issues/:id" element={s(<ProtectedRoute staff><IssueDetailPage /></ProtectedRoute>)} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/accessibility" element={<AccessibilityStatement />} />
        <Route path="/methodology" element={<Methodology />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
