import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Field, Select, Textarea } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { TranslationRecord, TranslateReply } from '@/types'
import { announce } from '@/utils/announce'
import { LANGUAGES, languageName, preferredLanguage } from '@/utils/language'

interface Props {
  /** The reporter's text as it is now. */
  text: string
  /** Called when the reporter chooses to file the translation. The original is passed along to keep. */
  onUse: (translated: string, record: TranslationRecord) => void
}

/**
 * Translate a report draft for the reporter to read and correct. The translation is a draft: the
 * reporter edits it and chooses whether to use it. The original text is always kept.
 */
export function TranslatePanel({ text, onUse }: Props) {
  const user = useAuth((s) => s.user)
  const [from, setFrom] = useState(() => (preferredLanguage() && preferredLanguage() !== 'en' ? preferredLanguage()! : 'es'))
  const [to, setTo] = useState('en')
  const [result, setResult] = useState<TranslateReply | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) {
    return (
      <p className="text-sm text-muted">
        <Link to="/login" className="underline">
          Sign in
        </Link>{' '}
        to translate your description. You can file in any language without it.
      </p>
    )
  }

  async function translate() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.translate({ text, target: to })
      setResult(r)
      setDraft(r.translation)
      announce('Translation ready for review')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function use() {
    if (!result) return
    onUse(draft.trim(), {
      language: from,
      original: text,
      source: result.source,
      model: result.model,
      reviewed: true,
    })
    setResult(null)
    announce('Translation used. Your original text is kept with the report.')
  }

  return (
    <section aria-label="Translate this description" className="mt-2 flex flex-col gap-2 border-t border-hair pt-2">
      <p className="text-sm font-medium">Translate for review (optional)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="I wrote in">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {LANGUAGES.filter((l) => l.tag !== to).map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Translate into">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {LANGUAGES.filter((l) => l.tag !== from).map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="button" variant="ghost" size="sm" busy={busy} disabled={!text.trim() || from === to} onClick={translate}>
          Translate for review
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-1 border border-hair bg-paper-raised p-2">
          <p className="text-sm font-medium">{result.label}</p>
          <Field label={`Translation into ${languageName(to)}`}>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} maxLength={4000} />
          </Field>
          <p className="text-xs text-muted">Your original text, kept with the report:</p>
          <blockquote className="text-sm text-muted">{result.original}</blockquote>
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="primary" size="sm" onClick={use} disabled={!draft.trim()}>
              Use this translation
            </Button>
            <Button type="button" variant="quiet" size="sm" onClick={() => setResult(null)}>
              Keep my text
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
