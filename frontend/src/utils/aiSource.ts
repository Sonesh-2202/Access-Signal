import type { AISource, AIStatus } from '@/types'

const NAMES: Record<AISource, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  gemini: 'Gemini',
  groq: 'Groq',
  nebius: 'Nebius',
  heuristic: 'keyword rules',
}

export const isLocalSource = (s: AISource | undefined) => s === 'lmstudio' || s === 'ollama'
export const isModelSource = (s: AISource | undefined) => !!s && s !== 'heuristic'

/** Badge text for a classification: which tier produced it. */
export function aiSourceLabel(source: AISource | undefined): string {
  if (!source || source === 'heuristic') return 'Keyword rules, AI offline'
  return `${isLocalSource(source) ? 'Local AI' : 'Cloud AI'} (${NAMES[source]})`
}

/** Short form for tables and notes: "Local AI", "Cloud AI (Gemini)", "Keyword classifier". */
export function aiSourceShort(source: AISource | undefined): string {
  if (!source || source === 'heuristic') return 'Keyword classifier'
  return isLocalSource(source) ? 'Local AI' : `Cloud AI (${NAMES[source]})`
}

/** Plain-language note on where report evidence goes when a suggestion is requested. */
export function aiPrivacyNote(status: AIStatus | undefined, usingOwnKey: boolean): string {
  if (usingOwnKey) {
    return 'Your text and photos go from AccessSignal’s server to the AI provider of the key you added in Settings. The key is not stored.'
  }
  const p = status?.available ? status.provider : 'heuristic'
  if (isLocalSource(p)) return 'Your photos and text are read by a model running on AccessSignal’s own server. Nothing is sent to an outside AI service.'
  if (p === 'gemini' || p === 'groq' || p === 'nebius') {
    return `This demo sends your text${p === 'gemini' ? ' and photos' : ''} to ${NAMES[p]} for the suggestion. Free tiers may use submitted content to improve their products, so don’t include personal details.`
  }
  return 'No AI model is connected right now, so keyword rules suggest a category from your text. Nothing leaves AccessSignal’s server.'
}
