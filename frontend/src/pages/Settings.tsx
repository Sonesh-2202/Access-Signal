import { Container, PageHeader } from '@/components/layout/Layout'
import { AIKeyPanel } from '@/components/settings/AIKeyPanel'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { aiSourceShort } from '@/utils/aiSource'

export default function Settings() {
  useDocumentTitle('Settings')
  const status = useAsync(() => api.aiStatus(), [])
  const tiers = status.data?.tiers ?? []
  return (
    <Container className="pb-8">
      <PageHeader eyebrow="Settings" title="AI classification">
        Which model suggests a category for new reports, and how to use your own key.
      </PageHeader>
      <div className="grid gap-6 pt-4 md:grid-cols-12">
        <section aria-labelledby="tiers-h" className="md:col-span-5">
          <h2 id="tiers-h" className="text-2xl leading-snug">On this server</h2>
          <p className="mt-1 text-sm text-muted">Tried in order. Keyword rules answer when no model does, and every suggestion says which one answered.</p>
          {status.loading ? (
            <p className="mt-2 text-sm text-muted">Checking…</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">AI tiers in the order they are tried</caption>
              <thead>
                <tr className="border-b border-hair text-left text-muted">
                  <th scope="col" className="py-1 font-normal">Tier</th>
                  <th scope="col" className="py-1 font-normal">Model</th>
                  <th scope="col" className="py-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {(tiers.length ? tiers : [{ provider: 'heuristic' as const, label: 'Keyword rules', available: true, model: null, base_url: null, vision: false }]).map((t) => (
                  <tr key={t.provider} className="border-b border-hair">
                    <th scope="row" className="py-1 text-left font-medium">
                      {t.provider === 'lmstudio' || t.provider === 'ollama' ? `Local AI (${t.label})` : aiSourceShort(t.provider)}
                    </th>
                    <td className="py-1 font-mono text-xs">{t.model ?? '—'}</td>
                    <td className="py-1">{t.available ? (t.vision ? 'Ready, reads photos' : 'Ready, text only') : 'Not available'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section aria-labelledby="byok-h" className="md:col-span-6 md:col-start-7">
          <h2 id="byok-h" className="text-2xl leading-snug">Use your own AI key</h2>
          <div className="mt-2">
            <AIKeyPanel status={status.data} />
          </div>
        </section>
      </div>
    </Container>
  )
}
