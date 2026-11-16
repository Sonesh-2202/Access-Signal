import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { useAuth } from '@/stores/auth'
import { axeViolations } from '@/test/a11y'
import { AccessibilityStatement, Privacy, Terms } from './Legal'
import { LoginPage } from './Auth'

describe('legal pages', () => {
  it.each([
    ['Terms of service', Terms],
    ['Privacy policy', Privacy],
    ['Accessibility statement', AccessibilityStatement],
  ])('%s renders with a heading and no axe violations', async (title, Page) => {
    const { container } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('login page', () => {
  it('has labelled fields and no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('ProtectedRoute', () => {
  beforeEach(() => useAuth.setState({ user: null, accessToken: null, ready: true }))
  afterEach(() => vi.restoreAllMocks())

  it('redirects anonymous users to sign in with a return path', () => {
    render(
      <MemoryRouter initialEntries={['/report?lat=1']}>
        <Routes>
          <Route path="/report" element={<ProtectedRoute><p>secret</p></ProtectedRoute>} />
          <Route path="/login" element={<p>login screen</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('login screen')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('blocks community users from staff pages', () => {
    useAuth.setState({ user: { id: '1', email: 'a@b.org', display_name: 'A', role: 'user', created_at: '' }, ready: true })
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute staff><p>queue</p></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('This area is for infrastructure staff')).toBeInTheDocument()
    expect(screen.queryByText('queue')).not.toBeInTheDocument()
  })
})
