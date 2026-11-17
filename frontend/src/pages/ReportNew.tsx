import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, SeverityMark } from '@/components/common/Badge'
import { Button } from '@/components/common/Button'
import { Dialog } from '@/components/common/Dialog'
import { AIKeyPanel } from '@/components/settings/AIKeyPanel'
import { Field, Input, Select, Textarea } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote } from '@/components/layout/Layout'
import { LocationSearch } from '@/components/map/LocationSearch'
import { PointPicker } from '@/components/map/PointPicker'
import { CategoryGlyph } from '@/components/reports/ReportRow'
import { VoiceRecorder, type VoiceNote } from '@/components/reports/VoiceRecorder'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api, reverseGeocode } from '@/services/api'
import { maskedKey, useAIKey } from '@/stores/aiKey'
import type { Classification, DuplicateCandidate, Evidence, TranslationRecord } from '@/types'
import { TranslatePanel } from '@/components/reports/TranslatePanel'
import { aiPrivacyNote, aiSourceLabel, isModelSource } from '@/utils/aiSource'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { distance, timeAgo } from '@/utils/format'

const STEPS = ['Location', 'What you saw', 'Category', 'Check and send'] as const

interface Photo {
  key: string
  url: string
  name: string
  status: 'uploading' | 'done' | 'error'
  evidence?: Evidence
  error?: string
  alt: string
}

export default function ReportNew() {
  useDocumentTitle('Report a barrier')
  const t = useTaxonomy()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const aiStatus = useAsync(() => api.aiStatus(), [])
  const ownKey = useAIKey((s) => s.value)
  const [keyDialog, setKeyDialog] = useState(false)

  const initial = params.get('lat') && params.get('lng') ? { lat: Number(params.get('lat')), lng: Number(params.get('lng')) } : null
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial)
  const [address, setAddress] = useState('')
  const [locError, setLocError] = useState<string | null>(null)

  const [photos, setPhotos] = useState<Photo[]>([])
  const [voice, setVoice] = useState<(VoiceNote & { evidence?: Evidence; status: 'uploading' | 'done' | 'error' }) | null>(null)
  const [description, setDescription] = useState('')
  /** A translation the reporter chose to file. It is sent only while the description still matches it. */
  const [translation, setTranslation] = useState<TranslationRecord | null>(null)

  const [draft, setDraft] = useState<Classification | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState<Error | null>(null)

  const [suggestion, setSuggestion] = useState<Classification | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classifyError, setClassifyError] = useState<Error | null>(null)
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')

  const [dups, setDups] = useState<DuplicateCandidate[] | null>(null)
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<Error | null>(null)

  const area = t?.service_area
  const inArea = !!point && !!area && point.lat >= area.min_lat && point.lat <= area.max_lat && point.lng >= area.min_lng && point.lng <= area.max_lng

  useEffect(() => {
    heading.current?.focus()
  }, [step])

  // Address follows the pin unless the user has typed their own.
  const addressTouched = useRef(false)
  useEffect(() => {
    if (!point || addressTouched.current) return
    const id = setTimeout(() => reverseGeocode(point.lat, point.lng).then((a) => a && !addressTouched.current && setAddress(a)), 600)
    return () => clearTimeout(id)
  }, [point])

  const evidenceIds = useMemo(
    () => [...photos.filter((p) => p.evidence).map((p) => p.evidence!.id), ...(voice?.evidence ? [voice.evidence.id] : [])],
    [photos, voice],
  )
  const uploading = photos.some((p) => p.status === 'uploading') || voice?.status === 'uploading'
  const hasContent = description.trim().length > 0 || evidenceIds.length > 0

  // ------------------------------------------------------------ evidence
  function addPhotos(files: FileList | null) {
    if (!files) return
    const room = 4 - photos.length
    Array.from(files)
      .slice(0, room)
      .forEach((file) => {
        const key = crypto.randomUUID()
        const ph: Photo = { key, url: URL.createObjectURL(file), name: file.name, status: 'uploading', alt: '' }
        setPhotos((p) => [...p, ph])
        if (file.size > 10 * 1024 * 1024) {
          setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: 'error', error: 'Over 10 MB' } : x)))
          return
        }
        api
          .uploadEvidence(file, file.name)
          .then((ev) => setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: 'done', evidence: ev } : x))))
          .catch((e: Error) => setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: 'error', error: e.message } : x))))
      })
  }

  function onVoice(n: VoiceNote) {
    setVoice({ ...n, status: 'uploading' })
    if (n.transcript && !description) setDescription(n.transcript)
    const ext = n.mime.includes('ogg') ? 'ogg' : n.mime.includes('mp4') ? 'm4a' : 'webm'
    api
      .uploadEvidence(n.blob, `voice.${ext}`, { transcription: n.transcript })
      .then((ev) => setVoice((v) => (v ? { ...v, status: 'done', evidence: ev } : v)))
      .catch(() => setVoice((v) => (v ? { ...v, status: 'error' } : v)))
  }

  // ------------------------------------------------------------ draft
  // Runs only when the user asks. It uses the same schema-checked classifier as the category
  // step, because the chat replies in free text and can't reliably fill category fields.
  async function draftReport() {
    setDrafting(true)
    setDraftError(null)
    try {
      setDraft(await api.classify(description, evidenceIds))
    } catch (e) {
      setDraftError(e as Error)
    } finally {
      setDrafting(false)
    }
  }

  /** Copies the draft's category into the form. The summary only fills an empty description. */
  function useDraft() {
    if (!draft) return
    setCategory(draft.category)
    setSubcategory(draft.subcategory)
    setSuggestion(draft)
    if (!description.trim()) setDescription(draft.summary)
    setDraft(null)
    announce(`Draft applied: ${subLabel(t, draft.category, draft.subcategory)}. Check the details before you send.`)
  }

  // ------------------------------------------------------------ classification
  async function classify() {
    setClassifying(true)
    setClassifyError(null)
    try {
      const c = await api.classify(description, evidenceIds)
      setSuggestion(c)
      if (!category) {
        setCategory(c.category)
        setSubcategory(c.subcategory)
      }
      announce(`Suggested category: ${subLabel(t, c.category, c.subcategory)}`)
    } catch (e) {
      setClassifyError(e as Error)
    } finally {
      setClassifying(false)
    }
  }

  // ------------------------------------------------------------ duplicates + submit
  useEffect(() => {
    if (step !== 3 || !point || !category || !subcategory) return
    setDups(null)
    api
      .duplicates({ lat: point.lat, lng: point.lng, category, subcategory, description })
      .then(setDups)
      .catch(() => setDups([]))
  }, [step, point, category, subcategory, description])

  async function submit() {
    if (!point) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const r = await api.createReport({
        lat: point.lat,
        lng: point.lng,
        address: address.trim() || null,
        category,
        subcategory,
        description: description.trim(),
        evidence_ids: evidenceIds,
        ai_analysis: suggestion,
        user_confirmed: !!suggestion && suggestion.subcategory === subcategory,
        duplicate_of: duplicateOf,
        translation: translation && translation.original === description ? translation : null,
      })
      announce('Report submitted')
      nav(`/reports/${r.id}?new=1`)
    } catch (e) {
      setSubmitError(e as Error)
      setSubmitting(false)
    }
  }

  const canNext = [inArea, hasContent && !uploading, !!category && !!subcategory, true][step]
  const subs = t?.categories.find((c) => c.key === category)?.subcategories ?? []

  return (
    <Container className="grid gap-4 py-4 md:grid-cols-12 md:py-8">
      <div className="md:col-span-3">
        <p className="meta">New report</p>
        <ol className="mt-2 flex gap-1 md:flex-col md:gap-0" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={cx(
                'flex flex-1 items-center gap-1 border-t-2 pt-1 text-sm md:flex-none md:border-l-2 md:border-t-0 md:py-1 md:pl-2 md:pt-1',
                i === step ? 'border-signal text-ink' : i < step ? 'border-ink text-ink' : 'border-hair text-muted',
              )}
            >
              <span className="tabular font-mono text-xs">{i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
              {i < step && <Icon name="check" size={14} className="hidden md:inline" />}
            </li>
          ))}
        </ol>
      </div>

      <div className="md:col-span-8 md:col-start-5">
        <h1 ref={heading} tabIndex={-1} className="text-3xl leading-snug tracking-[-0.015em] focus:outline-none">
          {['Where is the barrier?', 'What did you see?', 'What kind of barrier is it?', 'Check and send'][step]}
        </h1>

        {step === 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-muted">Search for an address, use your location, or click the map and drag the pin to the exact spot.</p>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end">
              <LocationSearch className="flex-1" label="Address or place" placeholder="e.g. Broadway and 14th St" onSelect={(r) => { addressTouched.current = false; setPoint({ lat: r.lat, lng: r.lng }) }} />
              <Button
                icon={<Icon name="locate" size={16} />}
                onClick={() => {
                  setLocError(null)
                  navigator.geolocation?.getCurrentPosition(
                    (p) => setPoint({ lat: p.coords.latitude, lng: p.coords.longitude }),
                    () => setLocError('Couldn’t get your location. Search or use the map instead.'),
                    { enableHighAccuracy: true, timeout: 8000 },
                  )
                }}
              >
                Use my location
              </Button>
            </div>
            {locError && <p className="text-sm text-signal">{locError}</p>}
            <PointPicker value={point} onChange={setPoint} className="h-[320px] border border-hair md:h-[400px]" />
            {point && (
              <p className={cx('text-sm', inArea ? 'text-muted' : 'text-signal')} aria-live="polite">
                {inArea
                  ? `Pin at ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
                  : 'That point is outside the area we cover (Midtown and Lower Manhattan, below 59th St).'}
              </p>
            )}
            <Field label="Address or description of the spot" hint="Filled in from the map. Add detail like “east entrance” or “SW corner”." optional>
              <Input value={address} onChange={(e) => { addressTouched.current = true; setAddress(e.target.value) }} maxLength={255} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="mt-3 flex flex-col gap-4">
            <section aria-labelledby="ph-h">
              <h2 id="ph-h" className="font-sans text-base font-medium">Photos</h2>
              <p className="text-sm text-muted">Up to 4. Location data is removed from the photo before it’s stored.</p>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {photos.map((p) => (
                  <figure key={p.key} className="relative border border-hair bg-paper-raised">
                    <img src={p.url} alt={p.alt || `Photo ${p.name}`} className="aspect-square w-full object-cover" />
                    <figcaption className="flex items-center justify-between gap-0.5 px-1 py-0.5 text-xs">
                      <span className={cx(p.status === 'error' ? 'text-signal' : 'text-muted')}>
                        {p.status === 'uploading' ? 'Uploading…' : p.status === 'error' ? p.error ?? 'Failed' : 'Attached'}
                      </span>
                      <button type="button" className="min-h-touch min-w-touch text-muted hover:text-ink" aria-label={`Remove photo ${p.name}`} onClick={() => setPhotos((x) => x.filter((y) => y.key !== p.key))}>
                        <Icon name="close" size={16} />
                      </button>
                    </figcaption>
                  </figure>
                ))}
                {photos.length < 4 && (
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-0.5 border border-dashed border-rule text-sm text-muted hover:border-ink hover:text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal">
                    <Icon name="camera" />
                    Add photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </section>

            <section aria-labelledby="vo-h">
              <h2 id="vo-h" className="font-sans text-base font-medium">Voice note</h2>
              <p className="mb-1 text-sm text-muted">Easier than typing on the street. Supported browsers transcribe as you speak.</p>
              {voice ? (
                <div className="flex flex-wrap items-center gap-2 border border-hair bg-paper-raised p-1">
                  <audio controls src={voice.url} className="h-5 max-w-full" aria-label="Your voice note" />
                  <span className="text-sm text-muted">{voice.status === 'uploading' ? 'Uploading…' : voice.status === 'error' ? 'Upload failed' : `${voice.seconds}s, attached`}</span>
                  <Button variant="quiet" size="sm" onClick={() => setVoice(null)} icon={<Icon name="trash" size={16} />}>Remove</Button>
                </div>
              ) : (
                <VoiceRecorder onDone={onVoice} />
              )}
            </section>

            <Field label="Description" hint="What’s blocking access, and who it affects. Mention the exact spot if the pin can’t show it.">
              <Textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setTranslation(null)
              }}
              maxLength={4000}
              rows={5}
            />
            </Field>
            {description.trim() && (
              <TranslatePanel text={description} onUse={(t, record) => {
                setDescription(t)
                setTranslation(record)
              }} />
            )}
            {!hasContent && <p className="text-sm text-muted">Add a description, photo or voice note to continue.</p>}

            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="max-w-prose text-sm text-muted">
                  Optional. Drafts a category and one-line summary from what you wrote and attached. Nothing is filed, and you can edit every field.
                </p>
                <Button variant="secondary" size="sm" disabled={!hasContent || uploading} busy={drafting} onClick={draftReport}>
                  Draft this report
                </Button>
              </div>
              {draftError && <ErrorNote error={draftError} />}
              {draft && (
                <section aria-labelledby="draft-h" className="fade-up border border-rule bg-paper-raised p-2">
                  <p className="meta">Draft, not filed</p>
                  <h2 id="draft-h" className="mt-0.5 font-sans text-base font-medium">
                    {subLabel(t, draft.category, draft.subcategory)}
                  </h2>
                  <p className="mt-0.5 text-sm">{draft.summary}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <Badge tone={isModelSource(draft.source) ? 'ink' : 'outline'}>{aiSourceLabel(draft.source)}</Badge>{' '}
                    Your report is only sent when you press Send on the last step.
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button variant="primary" size="sm" onClick={useDraft}>
                      Use these details
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                      Discard
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="border border-hair bg-paper-raised p-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div>
                  <p className="font-medium">Suggest a category from your evidence</p>
                  <p className="text-sm text-muted">{aiPrivacyNote(aiStatus.data, !!ownKey)}</p>
                  {aiStatus.data?.byok?.enabled && (
                    <p className="text-sm text-muted">
                      {ownKey ? `Using your ${ownKey.provider} key ${maskedKey(ownKey.key)}. ` : ''}
                      <button type="button" className="min-h-touch underline" onClick={() => setKeyDialog(true)}>
                        {ownKey ? 'Change AI key' : 'Use your own AI key'}
                      </button>
                    </p>
                  )}
                </div>
                <Button onClick={classify} busy={classifying} variant={suggestion ? 'ghost' : 'secondary'}>
                  {suggestion ? 'Ask again' : 'Suggest category'}
                </Button>
              </div>
              {classifying && (
                <div className="mt-2" aria-hidden>
                  <Skeleton className="h-[20px] w-[60%]" />
                  <Skeleton className="mt-1 h-[14px] w-[90%]" />
                </div>
              )}
              {classifyError && <div className="mt-2"><ErrorNote error={classifyError} /></div>}
              {suggestion && !classifying && (
                <div className="fade-up mt-2 border-t border-hair pt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <CategoryGlyph category={suggestion.category} />
                    <p className="font-medium">{subLabel(t, suggestion.category, suggestion.subcategory)}</p>
                    <Badge tone={isModelSource(suggestion.source) ? 'ink' : 'outline'}>{aiSourceLabel(suggestion.source)}</Badge>
                    {suggestion.model && <span className="font-mono text-xs text-muted">{suggestion.model}</span>}
                  </div>
                  <p className="mt-1 text-sm">{suggestion.summary}</p>
                  {suggestion.fallback_reason && <p className="mt-0.5 text-xs text-muted">Why this tier: {suggestion.fallback_reason}.</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <SeverityMark value={suggestion.severity} />
                    <span>Model confidence {Math.round(suggestion.confidence * 100)}%</span>
                    {suggestion.detected_features.length > 0 && <span>Noticed: {suggestion.detected_features.join(', ')}</span>}
                  </div>
                  {(category !== suggestion.category || subcategory !== suggestion.subcategory) && (
                    <Button size="sm" className="mt-1" onClick={() => { setCategory(suggestion.category); setSubcategory(suggestion.subcategory) }}>
                      Use this suggestion
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Category">
                <Select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory('') }}>
                  <option value="">Choose…</option>
                  {t?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="Specific problem">
                <Select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} disabled={!category}>
                  <option value="">Choose…</option>
                  {subs.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
            </div>
            <p className="text-sm text-muted">You make the final choice. If you pick something different from the suggestion, we use your choice.</p>
            <Dialog open={keyDialog} onClose={() => setKeyDialog(false)} title="Use your own AI key" variant="sheet">
              <AIKeyPanel status={aiStatus.data} onSaved={() => setKeyDialog(false)} />
            </Dialog>
          </div>
        )}

        {step === 3 && point && (
          <div className="mt-3 flex flex-col gap-3">
            <dl className="grid grid-cols-[120px_1fr] gap-y-1 border-y border-hair py-2 text-sm">
              <dt className="text-muted">Where</dt>
              <dd>{address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}</dd>
              <dt className="text-muted">Barrier</dt>
              <dd>{subLabel(t, category, subcategory)}</dd>
              <dt className="text-muted">Evidence</dt>
              <dd>{[photos.filter((p) => p.evidence).length && `${photos.filter((p) => p.evidence).length} photo(s)`, voice?.evidence && 'voice note', description.trim() && 'description'].filter(Boolean).join(', ') || 'none'}</dd>
            </dl>

            <section aria-labelledby="dup-h" aria-busy={dups === null}>
              <h2 id="dup-h" className="font-sans text-base font-medium">Has someone already reported this?</h2>
              {dups === null ? (
                <Skeleton className="mt-1 h-[64px] w-full" />
              ) : dups.length === 0 ? (
                <p className="mt-0.5 text-sm text-muted">No similar open reports within 50 m. Yours will be the first.</p>
              ) : (
                <fieldset className="mt-1">
                  <legend className="text-sm text-muted">
                    We found {dups.length} similar open report{dups.length > 1 ? 's' : ''} nearby. If one is the same barrier, choose it. Your report will be added as confirmation, which raises its confidence.
                  </legend>
                  <div className="mt-1 flex flex-col">
                    {dups.map((d) => (
                      <label key={d.report.id} className={cx('flex cursor-pointer gap-1 border-t border-hair py-1 text-sm last:border-b', duplicateOf === d.report.id && 'bg-tint/60')}>
                        <input type="radio" name="dup" className="mt-[3px] h-[18px] w-[18px] accent-signal" checked={duplicateOf === d.report.id} onChange={() => setDuplicateOf(d.report.id)} />
                        <span>
                          <span className="block font-medium">{subLabel(t, d.report.category, d.report.subcategory)}{d.report.address && `, ${d.report.address}`}</span>
                          <span className="block text-muted">{distance(d.distance_m)} away · {timeAgo(d.report.reported_at)} · match {Math.round(d.score * 100)}%</span>
                          {d.report.description && <span className="mt-0.5 line-clamp-2 block text-muted">“{d.report.description}”</span>}
                        </span>
                      </label>
                    ))}
                    <label className={cx('flex min-h-touch cursor-pointer items-center gap-1 py-1 text-sm', duplicateOf === null && 'font-medium')}>
                      <input type="radio" name="dup" className="h-[18px] w-[18px] accent-signal" checked={duplicateOf === null} onChange={() => setDuplicateOf(null)} />
                      No, this is a different barrier
                    </label>
                  </div>
                </fieldset>
              )}
            </section>
            {submitError && <ErrorNote error={submitError} />}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-hair pt-2">
          {step > 0 ? (
            <Button variant="quiet" onClick={() => setStep(step - 1)} icon={<Icon name="chevronLeft" size={16} />}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" busy={submitting} onClick={submit}>
              {duplicateOf ? 'Confirm existing report' : 'Send report'}
            </Button>
          )}
        </div>
      </div>
    </Container>
  )
}
