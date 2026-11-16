import { useState, type FormEvent } from 'react'
import { Button } from '@/components/common/Button'
import { Field, Input, Select } from '@/components/common/Field'
import { clearAIKey, maskedKey, setAIKey, useAIKey } from '@/stores/aiKey'
import type { AIStatus, CloudProvider } from '@/types'
import { announce } from '@/utils/announce'

const PROVIDERS: { value: CloudProvider; label: string; hint: string; link: string }[] = [
  { value: 'gemini', label: 'Google Gemini (text and photos)', hint: 'Free key from Google AI Studio, about 30 seconds with a Google account.', link: 'https://aistudio.google.com/apikey' },
  { value: 'groq', label: 'Groq (text only)', hint: 'Free key from the GroqCloud console. Photos are not sent.', link: 'https://console.groq.com/keys' },
  { value: 'nebius', label: 'Nebius Token Factory', hint: 'Uses the model this server is configured with.', link: 'https://tokenfactory.nebius.com/project/api-keys' },
]

// Same shape the API accepts; anything else is rejected there too.
const KEY_SHAPE = /^[A-Za-z0-9_\-.:]{16,200}$/

/** Bring-your-own-key form. Used on /settings and in a dialog in the report flow. */
export function AIKeyPanel({ status, onSaved }: { status?: AIStatus; onSaved?: () => void }) {
  const current = useAIKey((s) => s.value)
  const [provider, setProvider] = useState<CloudProvider>(current?.provider ?? 'gemini')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const info = PROVIDERS.find((p) => p.value === provider)!
  const disabled = status?.byok && !status.byok.enabled

  function save(e: FormEvent) {
    e.preventDefault()
    if (!KEY_SHAPE.test(key.trim())) {
      setError('That doesn’t look like an API key. Paste the whole key, with no spaces.')
      return
    }
    setAIKey(provider, key)
    setKey('')
    setError(null)
    announce('AI key saved for this tab')
    onSaved?.()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-prose text-sm leading-relaxed">
        <p>
          Server keys are shared and can run out at busy times. Paste your own key and suggestions and assistant answers use it instead.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-muted [&_li]:ml-3 [&_li]:list-disc">
          <li>The key stays in this browser tab and is deleted when you close the tab.</li>
          <li>It is sent only with “Suggest category”, “Draft this report” and assistant requests. The AccessSignal API passes it to the provider and does not store or log it.</li>
          <li>Anyone using this browser tab can read it. Use a key you can revoke, and remove it when you’re done.</li>
        </ul>
      </div>

      {current && (
        <div className="flex flex-wrap items-center justify-between gap-1 border border-hair bg-paper-raised p-2" role="status">
          <p className="text-sm">
            Using your <span className="font-medium">{PROVIDERS.find((p) => p.value === current.provider)?.label.split(' (')[0]}</span> key{' '}
            <span className="font-mono">{maskedKey(current.key)}</span>
          </p>
          <Button variant="danger" size="sm" onClick={() => { clearAIKey(); announce('AI key removed') }}>
            Remove key
          </Button>
        </div>
      )}

      {disabled ? (
        <p className="text-sm text-muted">This server doesn’t accept personal AI keys.</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-2" noValidate>
          <Field label="Provider" hint={<>{info.hint} <a href={info.link} target="_blank" rel="noreferrer">Get a key</a></>}>
            <Select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="API key" error={error}>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              maxLength={200}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={!key.trim()}>
              {current ? 'Replace key' : 'Use this key'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
