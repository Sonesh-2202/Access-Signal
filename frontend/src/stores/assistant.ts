import { create } from 'zustand'
import type { AISource, ChatCitation, ChatContext, ChatRole } from '@/types'

/**
 * The assistant panel's state. The conversation lives only in this tab's memory: a
 * refresh clears it, and nothing is saved on the server. Opening the panel about a
 * different report, place or route starts a new conversation, so one object's answers
 * never leak into another's.
 */
export interface AssistantTurn {
  role: ChatRole
  content: string
  sources?: ChatCitation[]
  /** Which cloud tier answered (assistant turns only). */
  source?: AISource
  /** True for a failed request, so it isn't sent back as history. */
  error?: boolean
}

interface AssistantState {
  open: boolean
  context: ChatContext
  /** Human name for the context, e.g. the place's name. Shown in the panel heading. */
  contextLabel: string
  turns: AssistantTurn[]
}

export const useAssistant = create<AssistantState>(() => ({
  open: false,
  context: { kind: 'none' },
  contextLabel: '',
  turns: [],
}))

/** Open the assistant about one object (or with no object for general questions). */
export function openAssistant(context: ChatContext = { kind: 'none' }, label = '') {
  const cur = useAssistant.getState()
  const sameObject = JSON.stringify(cur.context) === JSON.stringify(context)
  useAssistant.setState({ open: true, context, contextLabel: label, turns: sameObject ? cur.turns : [] })
}

export function closeAssistant() {
  useAssistant.setState({ open: false })
}

export function clearConversation() {
  useAssistant.setState({ turns: [] })
}

export function addTurn(turn: AssistantTurn) {
  useAssistant.setState((s) => ({ turns: [...s.turns, turn] }))
}
