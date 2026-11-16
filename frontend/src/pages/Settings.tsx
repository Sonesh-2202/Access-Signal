import { Container, PageHeader } from '@/components/layout/Layout'
import { AIKeyPanel } from '@/components/settings/AIKeyPanel'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { useAIKey } from '@/stores/aiKey'
import type { AITier } from '@/types'
import { aiSourceShort } from '@/utils/aiSource'

const KEYWORD_TIER: AITier = { provider: 'heuristic', label: 'Keyword rules', available: true, model: null, base_url: null, vision: false }

export default function Settings() {
  useDocumentTitle('Settings')
  const status = useAsync(() => api.aiStatus(), [])
  const ownKey = useAIKey((s) => s.value)
  const tiers = status.data?.tiers?.length ? status.data.tiers : [KEYWORD_TIER]
  const chat = status.data?.chat
  return (
    <Container className="pb-8">
      <PageHeader eyebrow="Settings" title="AI models and chat">
        Which cloud model answers, how the assistant works, and how to use your own key.
      </PageHeader>
      <div className="grid gap-6 pt-4 md:grid-cols-12">
        <section aria-labelledby="tiers-h" className="md:col-span-5">
          <h2 id="tiers-h" className="text-2xl leading-snug">On this server</h2>
          <p className="mt-1 text-sm text-muted">
            Cloud models are tried in order. Keyword rules answer when none does, and every suggestion says which one answered.
          </p>
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
                {tiers.map((t) => (
                  <tr key={t.provider} className="border-b border-hair">
                    <th scope="row" className="py-1 text-left font-medium">
                      {aiSourceShort(t.provider)}
                    </th>
                    <td className="py-1 font-mono text-xs">{t.model ?? '—'}</td>
                    <td className="py-1">
                      {t.provider === 'heuristic'
                        ? 'Always on, used last'
                        : t.available
                          ? t.vision
                            ? 'Key set, reads photos'
                            : 'Key set, text only'
                          : 'No key set'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 border-t border-hair pt-2">
            <h2 className="text-xl leading-snug">Assistant</h2>
            <p className="mt-1 text-sm">
              {ownKey
                ? `Chat uses your ${ownKey.provider} key in this tab.`
                : chat?.available
                  ? `Chat uses ${aiSourceShort(chat.tier ?? undefined)} on this server.`
                  : 'Chat needs an AI key. Add your own below, or ask the site operator to set one.'}
            </p>
            <p className="mt-1 text-sm text-muted">
              The assistant can read reports, places and routes, and answer questions. It cannot file reports, change statuses or take any other action.
              Each person is limited to {chat?.rate_limit_per_minute ?? 10} questions a minute.
            </p>
          </div>
        </section>

        <section aria-labelledby="byok-h" className="md:col-span-6 md:col-start-7">
          <h2 id="byok-h" className="text-2xl leading-snug">Use your own AI key</h2>
          <div className="mt-2">
            <AIKeyPanel status={status.data} />
          </div>
          <div className="mt-4 border-t border-hair pt-2">
            <h2 className="text-xl leading-snug">What is sent, and where</h2>
            <p className="mt-1 text-sm">
              Chat questions, the report or place or route they are about, and any descriptions or photos you attach to a report are sent to the cloud
              provider that answers. That is your own key’s provider when you add one, otherwise the first server tier with a key.
              AccessSignal doesn’t store your key.
            </p>
          </div>
        </section>
      </div>
    </Container>
  )
}
