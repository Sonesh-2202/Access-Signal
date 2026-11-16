import axe from 'axe-core'

/** Runs axe-core against a rendered container and returns violations as readable strings. */
export async function axeViolations(container: Element): Promise<string[]> {
  const res = await axe.run(container, {
    // jsdom has no layout engine, so colour contrast can't be computed here.
    // Contrast is verified separately against the design tokens (docs/ACCESSIBILITY_AUDIT.md).
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
}
