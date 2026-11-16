import { useEffect, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { Icon } from '../common/Icon'

// Minimal typing for the Web Speech API (not in lib.dom for all browsers).
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function hasRecognition(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return C ? new C() : null
}

export interface VoiceNote {
  blob: Blob
  url: string
  transcript: string
  seconds: number
  mime: string
}

/**
 * Records a voice note with MediaRecorder and, where the browser supports it,
 * transcribes live with the Web Speech API. The transcript stays editable.
 */
export function VoiceRecorder({ onDone, disabled }: { onDone: (n: VoiceNote) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'denied' | 'unsupported'>(() =>
    typeof MediaRecorder === 'undefined' || !navigator.mediaDevices ? 'unsupported' : 'idle',
  )
  const [seconds, setSeconds] = useState(0)
  const [live, setLive] = useState('')
  const rec = useRef<MediaRecorder | null>(null)
  const sr = useRef<SpeechRecognitionLike | null>(null)
  const chunks = useRef<Blob[]>([])
  const finalText = useRef('')
  const timer = useRef<number>()
  const started = useRef(0)

  useEffect(() => () => stopAll(), [])

  function stopAll() {
    window.clearInterval(timer.current)
    rec.current?.stream.getTracks().forEach((t) => t.stop())
    sr.current?.stop()
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      finalText.current = ''
      setLive('')
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      r.onstop = () => {
        const type = r.mimeType || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        const secs = Math.round((Date.now() - started.current) / 1000)
        onDone({ blob, url: URL.createObjectURL(blob), transcript: finalText.current.trim(), seconds: secs, mime: type })
      }
      rec.current = r
      started.current = Date.now()
      r.start(250)
      setSeconds(0)
      timer.current = window.setInterval(() => {
        const s = Math.round((Date.now() - started.current) / 1000)
        setSeconds(s)
        if (s >= 120) stop()
      }, 500)

      const recog = getRecognition()
      if (recog) {
        recog.continuous = true
        recog.interimResults = true
        recog.lang = 'en-US'
        recog.onresult = (e) => {
          let interim = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]
            if (res.isFinal) finalText.current += res[0].transcript + ' '
            else interim += res[0].transcript
          }
          setLive((finalText.current + interim).trim())
        }
        recog.onerror = () => undefined
        try {
          recog.start()
          sr.current = recog
        } catch {
          sr.current = null
        }
      }
      setState('recording')
    } catch {
      setState('denied')
    }
  }

  function stop() {
    window.clearInterval(timer.current)
    sr.current?.stop()
    sr.current = null
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
    rec.current?.stream.getTracks().forEach((t) => t.stop())
    setState('idle')
  }

  if (state === 'unsupported') {
    return <p className="text-sm text-muted">Voice recording isn’t supported in this browser. Type a description instead.</p>
  }
  // Firefox records audio but has no Web Speech API: say so before recording, not after.
  const canTranscribe = typeof window !== 'undefined' && hasRecognition()

  return (
    <div>
      {state === 'recording' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={stop} icon={<Icon name="stop" size={16} />}>
            Stop recording
          </Button>
          <span className="inline-flex items-center gap-1 text-sm" role="timer" aria-live="off">
            <span aria-hidden className="h-1 w-1 animate-pulse rounded-full bg-signal" />
            <span className="tabular font-mono">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
            <span className="text-muted">of 2:00</span>
          </span>
        </div>
      ) : (
        <Button onClick={start} disabled={disabled} icon={<Icon name="mic" size={16} />}>
          Record a voice note
        </Button>
      )}
      {state === 'idle' && !canTranscribe && (
        <p className="mt-1 text-sm text-muted">
          This browser can record a voice note but can’t transcribe it as you speak. Please also type a short description below.
        </p>
      )}
      {state === 'denied' && <p className="mt-1 text-sm text-signal">Microphone access was blocked. Allow it in your browser settings, or type instead.</p>}
      {state === 'recording' && (
        <p className="mt-1 min-h-[44px] border-l-2 border-hair pl-1 text-sm text-muted" aria-live="polite">
          {live || (getRecognition() ? 'Listening…' : 'Recording. Live transcription isn’t available in this browser.')}
        </p>
      )}
    </div>
  )
}
