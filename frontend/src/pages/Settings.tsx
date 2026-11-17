import { Container, PageHeader } from '@/components/layout/Layout'
import { Inbox } from '@/components/alerts/Inbox'
import { Field, Select } from '@/components/common/Field'
import { LANGUAGES, preferredLanguage, setPreferredLanguage } from '@/utils/language'
import { useState } from 'react'
import { AlertSettings } from '@/components/alerts/AlertSettings'
import { NearbySettings } from '@/components/alerts/NearbySettings'
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
  const textAI = status.data?.text_ai
  return (
    <Container className="pb-8">
      <PageHeader eyebrow="Settings" title="AI models">
        Which cloud model answers, what the AI is used for, and how to use your own key.
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
            <h2 className="text-xl leading-snug">Describing routes and translating</h2>
            <p className="mt-1 text-sm">
              {ownKey
                ? `These use your ${ownKey.provider} key in this tab.`
                : textAI?.available
                  ? `These use ${aiSourceShort(textAI.tier ?? undefined)} on this server.`
                  : 'Describing a route and translating a draft need an AI key. Add your own below, or ask the site operator to set one.'}
            </p>
            <p className="mt-1 text-sm text-muted">
              A route description reads one sentence and returns a route the router plans. A translation returns a draft you review before you file it. Neither can file, change or take any other action.
              Each person is limited to {textAI?.rate_limit_per_minute ?? 10} requests a minute.
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
              Route descriptions and translation drafts, the text you type for them, and any descriptions or photos you attach to a report are sent to the cloud
              provider that answers. That is your own key’s provider when you add one, otherwise the first server tier with a key.
              AccessSignal doesn’t store your key.
            </p>
          </div>
        </section>
      </div>
      <LanguagePanel />
      <section id="alerts" aria-labelledby="alerts-page-h" className="border-t border-hair pt-6 mt-6">
        <h2 id="alerts-page-h" className="text-2xl leading-snug">Route alerts</h2>
        <p className="mt-1 max-w-[60ch] text-sm text-muted">
          Save a route and AccessSignal tells you when a confirmed barrier or an out-of-service feature affects it. Alerts are opt-in, and each one says only what changed. Push alerts need your browser's permission. The inbox works without it.
        </p>
        <NearbySettings />
        <AlertSettings />
        <Inbox />
      </section>
    </Container>
  )
}

/** The default language for translating a report draft. Stored on this device only. */
function LanguagePanel() {
  const [lang, setLang] = useState<string>(preferredLanguage() ?? 'en')
  return (
    <section aria-labelledby="lang-h" className="mt-6 border-t border-hair pt-6">
      <h2 id="lang-h" className="text-2xl leading-snug">
        Language
      </h2>
      <p className="mt-1 max-w-[60ch] text-sm text-muted">
        The default language for translating a report draft. It is saved on this device only.
        Nothing is sent until you ask for a translation or an answer.
      </p>
      <div className="mt-2 max-w-[320px]">
        <Field label="Preferred language">
          <Select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value)
              setPreferredLanguage(e.target.value)
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </section>
  )
}
