import { ORBIT_R_MAX, ORBIT_R_MIN, SHIP_ANGULAR_SPEED, SHIP_RADIAL_SPEED } from './const'

export type Ship = {
  angle: number
  orbitR: number
}

export type KeysHeld = { w: boolean; a: boolean; s: boolean; d: boolean }

export function shipWorldPos(ship: Ship): { x: number; y: number } {
  return {
    x: ship.orbitR * Math.cos(ship.angle),
    y: ship.orbitR * Math.sin(ship.angle),
  }
}

export function clampOrbitR(r: number): number {
  return Math.max(ORBIT_R_MIN, Math.min(ORBIT_R_MAX, r))
}

export function integrateShip(ship: Ship, keys: KeysHeld, dt: number): void {
  if (keys.a) ship.angle -= SHIP_ANGULAR_SPEED * dt
  if (keys.d) ship.angle += SHIP_ANGULAR_SPEED * dt
  if (keys.w) ship.orbitR += SHIP_RADIAL_SPEED * dt
  if (keys.s) ship.orbitR -= SHIP_RADIAL_SPEED * dt
  ship.orbitR = clampOrbitR(ship.orbitR)
}

/** Shortest signed angle difference in (-π, π]. */
export function wrapAngleDelta(da: number): number {
  let a = da
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/**
 * Exponential blend of `ship` toward `target` (client prediction vs server state).
 * Higher `rate` → snappier follow; dt should be frame delta in seconds.
 */
export function smoothShipToward(ship: Ship, target: Ship, dt: number, rate = 20): void {
  const t = 1 - Math.exp(-rate * Math.min(0.12, Math.max(0, dt)))
  ship.angle += wrapAngleDelta(target.angle - ship.angle) * t
  ship.orbitR += (target.orbitR - ship.orbitR) * t
}
