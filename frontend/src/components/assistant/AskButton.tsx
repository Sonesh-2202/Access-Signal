import { Button } from '@/components/common/Button'
import { openAssistant } from '@/stores/assistant'
import type { ChatContext } from '@/types'

/** Opens the assistant about one report, place or route. Focus returns here when it closes. */
export function AskButton({ context, label, children = 'Ask about this' }: { context: ChatContext; label: string; children?: string }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => openAssistant(context, label)}>
      {children}
    </Button>
  )
}
