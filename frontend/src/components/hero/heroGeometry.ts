/** Route geometry shared by the 3D scene and its text captions. Kept free of three.js
 *  so the landing page can show the numbers before the scene chunk loads. */

export type HeroRouteMode = 'standard' | 'stepfree'
export type P2 = [number, number] // [x, z] in scene units

/** One scene unit is about 15 m on the ground. */
export const UNIT_M = 15
/** Wheelchair pace used for the captions, m/min. */
const PACE = 62

export const STANDARD_PTS: P2[] = [[-6.6, -1.9], [-2.25, -1.9], [2.25, -1.9], [6.6, -1.9]]
export const STEPFREE_PTS: P2[] = [[-6.6, -1.9], [-2.25, -1.9], [-2.25, 1.9], [2.25, 1.9], [5.2, 1.9], [5.2, -1.9], [6.6, -1.9]]
export const BARRIER: P2 = [2.25, -1.9]

export const polyLength = (pts: P2[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

function stats(pts: P2[]) {
  const m = Math.round((polyLength(pts) * UNIT_M) / 10) * 10
  return { metres: m, minutes: Math.max(1, Math.round(m / PACE)) }
}

export const HERO_STATS = { standard: stats(STANDARD_PTS), stepfree: stats(STEPFREE_PTS) }
