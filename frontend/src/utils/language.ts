/**
 * The language a person reads and writes in, kept on this device only (localStorage). It sets the
 * default translation target. Nothing is sent to the
 * server until a person asks for a translation or a reply.
 */

export const LANGUAGES: { tag: string; name: string }[] = [
  { tag: 'en', name: 'English' },
  { tag: 'es', name: 'Spanish' },
  { tag: 'zh', name: 'Chinese' },
  { tag: 'ru', name: 'Russian' },
  { tag: 'bn', name: 'Bengali' },
  { tag: 'ht', name: 'Haitian Creole' },
  { tag: 'ko', name: 'Korean' },
  { tag: 'fr', name: 'French' },
]

const KEY = 'accesssignal.language'

export function languageName(tag: string): string {
  return LANGUAGES.find((l) => l.tag === tag)?.name ?? tag
}

export function preferredLanguage(): string | null {
  try {
    const v = localStorage.getItem(KEY)
    return v && LANGUAGES.some((l) => l.tag === v) ? v : null
  } catch {
    return null
  }
}

export function setPreferredLanguage(tag: string | null): void {
  try {
    if (tag) localStorage.setItem(KEY, tag)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage can be blocked. The choice then lasts only for this page visit.
  }
}
