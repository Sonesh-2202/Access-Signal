import type { AISource, AIStatus } from '@/types'

const NAMES: Record<AISource, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  nebius: 'Nebius',
  heuristic: 'keyword rules',
}

export const isModelSource = (s: AISource | undefined) => !!s && s !== 'heuristic'

/** Badge text for a classification: which tier produced it. */
export function aiSourceLabel(source: AISource | undefined): string {
  if (!source || source === 'heuristic') return 'Keyword rules, AI offline'
  return `Cloud AI (${NAMES[source]})`
}

/** Short form for tables and notes: "Cloud AI (Gemini)", "Keyword classifier". */
export function aiSourceShort(source: AISource | undefined): string {
  if (!source || source === 'heuristic') return 'Keyword classifier'
  return `Cloud AI (${NAMES[source]})`
}

/** Shown under the assistant's answers. */
export const chatPrivacyNote = 'Answers come from a cloud model and are grounded in the data on this page.'

/** Shown with a planned route: the router computes the path, the AI only reads the request and explains it. */
export const routeSourceNote =
  'Route calculated by AccessSignal’s router from OpenStreetMap paths and open reports. The AI only reads your request and explains the result.'

/** Plain-language note on where report evidence goes when a suggestion is requested. */
export function aiPrivacyNote(status: AIStatus | undefined, usingOwnKey: boolean): string {
  if (usingOwnKey) {
    return 'Your text and photos go from AccessSignal’s server to the AI provider of the key you added in Settings. The key is not stored.'
  }
  const p = status?.available ? status.provider : 'heuristic'
  if (p === 'gemini' || p === 'groq' || p === 'nebius') {
    return `This demo sends your text${p === 'gemini' ? ' and photos' : ''} to ${NAMES[p]} for the suggestion. Free tiers may use submitted content to improve their products, so don’t include personal details.`
  }
  return 'No cloud AI model is connected right now, so keyword rules suggest a category from your text. Nothing leaves AccessSignal’s server.'
}
