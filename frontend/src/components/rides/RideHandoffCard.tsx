import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/common/Button'
import { Textarea } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { DispatcherDraft, RideOption } from '@/types'
import { announce } from '@/utils/announce'

interface Props {
  pickup: string
  dropoff: string
  /** The specific barrier on the walking route, e.g. "missing curb cut". */
  barrier: string
  passengers?: number
}

/**
 * Shown when no step-free route exists. It lists local accessible ride services and drafts a
 * dispatcher message. Nothing is booked or sent: the person calls, or copies or reads the draft.
 */
export function RideHandoffCard({ pickup, dropoff, barrier, passengers = 1 }: Props) {
  const headingId = useId()
  const draftId = useId()
  const user = useAuth((s) => s.user)
  const [rides, setRides] = useState<RideOption[] | null>(null)
  const [draft, setDraft] = useState<DispatcherDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.rides().then(setRides).catch(() => setRides([]))
  }, [])

  async function makeDraft(useAi: boolean) {
    setBusy(true)
    setError(null)
    try {
      const d = await api.rideDraft({ pickup, dropoff, barrier, passengers, use_ai: useAi })
      setDraft(d)
      announce(d.source === 'ai' ? 'AI draft ready for review' : 'Draft ready for review')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copyDraft() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft.text)
      announce('Draft copied')
    } catch {
      announce('Copy failed. Select the text and copy it by hand.')
    }
  }

  function readDraftAloud() {
    if (!draft || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(draft.text))
  }

  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window

  return (
    <section aria-labelledby={headingId} className="border border-hair bg-paper-raised p-2">
      <h3 id={headingId} className="text-base font-medium">
        No step-free route between these points
      </h3>
      <p className="mt-0.5 text-sm">
        A wheelchair-accessible ride may be the practical option. These services are listed by the city or the transit
        agency. AccessSignal doesn’t book them.
      </p>

      <h4 className="meta mt-1">Ride services</h4>
      {rides === null && <p className="mt-0.5 text-sm text-muted">Loading ride services…</p>}
      {rides !== null && rides.length === 0 && (
        <p className="mt-0.5 text-sm">
          No ride list is available here. Call 311 and ask for accessible taxi or Access-A-Ride information.
        </p>
      )}
      {rides !== null && rides.length > 0 && (
        <ul className="mt-0.5 flex flex-col gap-1 text-sm">
          {rides.map((r) => (
            <li key={r.id} className="border-t border-hair pt-1 first:border-t-0 first:pt-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-muted">{r.notes}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2">
                {r.phone && r.tel && (
                  <a className="underline" href={`tel:${r.tel}`}>
                    Call {r.phone}
                  </a>
                )}
                {r.url && (
                  <a className="underline" href={r.url} rel="noopener noreferrer">
                    Website
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h4 className="meta mt-2">Message for the dispatcher</h4>
      <p className="mt-0.5 text-sm text-muted">
        Make a draft to read, copy or read aloud. It is not sent.
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" busy={busy} onClick={() => makeDraft(false)}>
          Make a draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!user || busy}
          onClick={() => makeDraft(true)}
          aria-describedby={user ? undefined : 'ride-ai-hint'}
        >
          Write it with AI
        </Button>
      </div>
      {!user && (
        <p id="ride-ai-hint" className="mt-0.5 text-xs text-muted">
          Sign in to write the draft with AI. The standard draft works without it.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-0.5 text-sm text-signal">
          {error}
        </p>
      )}
      {draft && (
        <div className="mt-1">
          <label htmlFor={draftId} className="text-sm font-medium">
            {draft.source === 'ai' ? 'AI draft — review before sending' : 'Template draft — review before sending'}
          </label>
          <Textarea id={draftId} readOnly rows={7} value={draft.text} className="mt-0.5 font-mono text-sm" />
          {draft.note && <p className="mt-0.5 text-xs text-muted">{draft.note}</p>}
          <p className="mt-0.5 text-xs text-muted">{draft.label}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={copyDraft}>
              Copy draft
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={readDraftAloud} disabled={!speechAvailable}>
              Read aloud
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
