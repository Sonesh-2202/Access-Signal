import { create } from 'zustand'
import type { RoutePlanResult } from '@/types'

/**
 * A route the assistant planned, waiting for the route planner to show it on the map.
 * The planner consumes it once. Nothing here is saved on the server.
 */
interface RoutePlanState {
  pending: RoutePlanResult | null
}

export const useRoutePlan = create<RoutePlanState>(() => ({ pending: null }))

export function sendRoutePlanToMap(plan: RoutePlanResult) {
  useRoutePlan.setState({ pending: plan })
}

export function consumeRoutePlan() {
  useRoutePlan.setState({ pending: null })
}
