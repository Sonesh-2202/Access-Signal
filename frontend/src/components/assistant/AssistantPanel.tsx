import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Dialog } from '@/components/common/Dialog'
import { Textarea } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { addTurn, type AssistantTurn, clearConversation, closeAssistant, useAssistant } from '@/stores/assistant'
import type { ChatCitation } from '@/types'
import { aiSourceShort, chatPrivacyNote } from '@/utils/aiSource'
import { announce } from '@/utils/announce'

const EXAMPLES: Record<'none' | 'report' | 'place' | 'route', string[]> = {
  report: ['What is blocking access here?', 'Who does this barrier affect most?'],
  place: ['Is there a step-free entrance?', 'Are any reports open here?'],
  route: ['Why was this route chosen?', 'Where are the least certain parts?'],
  none: ['How do I report a blocked ramp?', 'What does “unknown” mean on a route?'],
}

/**
 * Read-only chat panel. Answers arrive as complete text, not streamed, so a screen reader
 * announces each one whole. Sources link back to the report, place or route the answer used.
 */
export function AssistantPanel() {
  const open = useAssistant((s) => s.open)
  const context = useAssistant((s) => s.context)
  const label = useAssistant((s) => s.contextLabel)
  const turns = useAssistant((s) => s.turns)
  const user = useAuth((s) => s.user)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  // Dialog opens in its own effect, which runs before this one (it is a child). So focus
  // lands in the question box instead of the close button.
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || pending || !user) return
    const history = [...useAssistant.getState().turns, { role: 'user' as const, content: text }]
    addTurn({ role: 'user', content: text })
    setDraft('')
    setPending(true)
    try {
      const lang = navigator.language
      const reply = await api.chat({
        // Failed turns stay on screen but are not sent back as history.
        messages: history.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
        context,
        language: lang && !/^en\b/i.test(lang) ? lang : undefined,
      })
      addTurn({ role: 'assistant', content: reply.answer, sources: reply.sources, source: reply.source })
      announce('Answer ready')
    } catch (err) {
      addTurn({ role: 'assistant', content: (err as Error).message || 'The assistant couldn’t answer.', error: true })
    } finally {
      setPending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line. Enter during IME composition is left alone.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  const heading = context.kind === 'none' ? 'Ask AccessSignal' : `Ask about ${label || 'this page'}`

  return (
    <Dialog open={open} onClose={closeAssistant} title={heading} variant="sheet" className="sm:max-w-[600px]">
      <div className="flex flex-col gap-2">
        <p className="border-l-2 border-ink pl-2 text-sm font-medium">This assistant can read but cannot file reports or change anything.</p>
        <p className="text-xs text-muted">{chatPrivacyNote} Your questions are sent to the cloud provider that answers.</p>

        {!user && (
          <p className="text-sm">
            <Link to="/login" onClick={closeAssistant} className="underline">
              Sign in
            </Link>{' '}
            to ask questions.
          </p>
        )}

        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Conversation"
          className="max-h-[42vh] min-h-[120px] overflow-y-auto border border-hair bg-paper-raised p-2"
        >
          {turns.length === 0 && user && (
            <div className="text-sm text-muted">
              <p>Try asking:</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {EXAMPLES[context.kind].map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      className="min-h-touch text-left text-ink underline decoration-rule underline-offset-[3px] hover:decoration-ink"
                      onClick={() => setDraft(q)}
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {turns.map((t, i) => (
            <TurnView key={i} turn={t} />
          ))}
          {pending && (
            <p role="status" className="mt-1 text-sm text-muted">
              Thinking…
            </p>
          )}
        </div>

        <form onSubmit={send} className="flex flex-col gap-1">
          <label htmlFor="assistant-question" className="text-sm font-medium">
            Your question
          </label>
          <Textarea
            id="assistant-question"
            ref={input}
            rows={2}
            maxLength={4000}
            value={draft}
            disabled={!user}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby="assistant-hint"
            className="min-h-[64px]"
          />
          <p id="assistant-hint" className="text-xs text-muted">
            Press Enter to send. Shift+Enter starts a new line.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <Button variant="quiet" size="sm" onClick={clearConversation} disabled={turns.length === 0 || pending}>
              Clear conversation
            </Button>
            <Button type="submit" variant="primary" busy={pending} disabled={!user || !draft.trim()}>
              Ask
            </Button>
          </div>
        </form>

        <p className="text-xs text-muted">
          Need a different provider?{' '}
          <Link to="/settings" onClick={closeAssistant} className="underline">
            Add your own AI key in Settings
          </Link>
          .
        </p>
      </div>
    </Dialog>
  )
}

function TurnView({ turn }: { turn: AssistantTurn }) {
  const who = turn.role === 'user' ? 'You' : 'Assistant'
  const tier = turn.role === 'assistant' && turn.source && !turn.error ? ` · ${aiSourceShort(turn.source)}` : ''
  return (
    <div className="border-t border-hair py-1 first:border-t-0 first:pt-0">
      <p className="meta">
        {who}
        {tier}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{turn.content}</p>
      {turn.sources && turn.sources.length > 0 && <Sources sources={turn.sources} />}
    </div>
  )
}

function Sources({ sources }: { sources: ChatCitation[] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="mt-1">
      <h3 id={headingId} className="meta">
        Sources
      </h3>
      <ul className="mt-0.5 flex flex-col gap-0.5 text-sm">
        {sources.map((s) => (
          <li key={`${s.kind}-${s.url}`}>
            <span className="font-mono text-xs text-muted">[{s.tag}]</span>{' '}
            <Link to={s.url} onClick={closeAssistant} className="underline decoration-rule underline-offset-[3px] hover:decoration-ink">
              {s.label}
            </Link>{' '}
            <span className="text-muted">({s.kind})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
