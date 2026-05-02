/** Facade re-exports — world space: origin = planet center, +y downward (canvas). */

import { ARTILLERY_COOLDOWN_MS, MIN_ARTILLERY_CD_MS, MIN_ROCKET_CD_MS, ROCKET_COOLDOWN_MS } from './const'

export function effectiveArtilleryCd(bonusMs: number): number {
  return Math.max(MIN_ARTILLERY_CD_MS, ARTILLERY_COOLDOWN_MS - bonusMs)
}

export function effectiveRocketCd(bonusMs: number): number {
  return Math.max(MIN_ROCKET_CD_MS, ROCKET_COOLDOWN_MS - bonusMs)
}

export * from './game-payloads'
export * from './ship'
export * from './asteroid-models'
export * from './asteroids'
export * from './projectiles'
