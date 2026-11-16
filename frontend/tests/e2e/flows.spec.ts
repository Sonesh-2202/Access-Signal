import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const PASSWORD = 'Signal-demo-2026'

/** Path prefix of the site under test, e.g. /Access-Signal on GitHub Pages ('' locally). */
const BASE_PATH = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5180').pathname.replace(/\/+$/, '')

/** App paths are written as '/map'; resolve them under the site's base path. */
const go = (page: Page, path: string) => page.goto(path.replace(/^\//, ''))

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axeSource })
  return page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })
    return r.violations.map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`)
  })
}

async function signIn(page: Page, email: string, next = '/') {
  await go(page, `/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => u.pathname === BASE_PATH + next.split('?')[0])
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('home shows live data and passes axe', async ({ page }) => {
  await go(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('before you leave')
  await expect(page.getByText(/open barriers/i).first()).toBeVisible()
  await expect(page.getByRole('table', { name: /Comparison of walking and wheelchair routes/ })).toBeVisible()
  await noHorizontalOverflow(page)
  expect(await axe(page)).toEqual([])
})

test('skip link moves focus to main content', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard test')
  await go(page, '/reports')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#main$/)
})

test('map offers a list-only view with the same reports', async ({ page }) => {
  await go(page, '/map')
  await page.getByText('List only').click()
  await expect(page.getByRole('heading', { name: 'All matching reports' })).toBeVisible()
  await expect(page.locator('article').first()).toBeVisible()
  await noHorizontalOverflow(page)
})

test('wheelchair route avoids the Union Square curb cut', async ({ page }) => {
  await go(page, '/route?from=40.7338,-73.9925&to=40.7362,-73.9893&profile=wheelchair')
  await expect(page.getByText(/Avoids 1 reported barrier on the shortest walking route/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Directions' })).toBeVisible()
  await noHorizontalOverflow(page)
})

test('community member files a report end to end', async ({ page }) => {
  await signIn(page, 'priya.raman@example.org', '/report?lat=40.74800&lng=-73.98570')
  await expect(page.getByRole('heading', { name: 'Where is the barrier?' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Description').fill('Scaffolding has closed the sidewalk with no covered walkway, the detour goes into the bike lane.')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: 'Suggest category' }).click()
  await expect(page.getByText(/Keyword rules|Local AI|Cloud AI/).first()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByLabel('Category')).toHaveValue('sidewalk')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Has someone already reported this?' })).toBeVisible()
  await page.getByRole('button', { name: /Send report|Confirm existing report/ }).click()
  await expect(page.getByText(/Thanks\./)).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/construction/i)
})

test('manager moves an issue through review', async ({ page }) => {
  await signIn(page, 'dana.whitfield@city.example.org', '/dashboard')
  await expect(page.getByRole('heading', { name: 'Issue queue' })).toBeVisible()
  await page.getByRole('button', { name: /Reported/ }).first().click()
  const first = page.getByRole('table').getByRole('link').first()
  await first.click()
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible()
  await page.getByLabel('Move to').selectOption('under_review')
  await page.getByLabel('Note for the audit trail').fill('Checking with the property manager')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Checking with the property manager')).toBeVisible()
})

test('staff pages are closed to community accounts', async ({ page }) => {
  await signIn(page, 'priya.raman@example.org', '/dashboard')
  await expect(page.getByText('This area is for infrastructure staff')).toBeVisible()
})

test.describe('390 px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'phone layout checks run in the mobile project'))

  test('report location step leads with search and "Use my location", not the map', async ({ page }) => {
    await signIn(page, 'priya.raman@example.org', '/report')
    await expect(page.getByRole('heading', { name: 'Where is the barrier?' })).toBeVisible()
    const search = page.getByRole('combobox', { name: 'Address or place' })
    const locate = page.getByRole('button', { name: 'Use my location' })
    await expect(search).toBeVisible()
    await expect(locate).toBeVisible()
    // Both sit above the map, inside the first screen, so nobody needs a pointer to place the pin.
    for (const el of [search, locate]) {
      const box = (await el.boundingBox())!
      expect(box.y + box.height).toBeLessThan(844)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    await noHorizontalOverflow(page)
  })

  test('map list view and route planner fit the screen', async ({ page }) => {
    await go(page, '/map')
    await page.getByText('List only').click()
    await expect(page.getByRole('heading', { name: 'All matching reports' })).toBeVisible()
    await noHorizontalOverflow(page)
    await go(page, '/route?from=40.7338,-73.9925&to=40.7362,-73.9893&profile=wheelchair')
    await expect(page.getByText(/Avoids 1 reported barrier on the shortest walking route/)).toBeVisible()
    await noHorizontalOverflow(page)
  })
})

for (const path of ['/terms', '/privacy', '/accessibility', '/methodology', '/places', '/analytics', '/login', '/settings']) {
  test(`${path} has no axe violations or overflow`, async ({ page }) => {
    await go(page, path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await noHorizontalOverflow(page)
    expect(await axe(page)).toEqual([])
  })
}
