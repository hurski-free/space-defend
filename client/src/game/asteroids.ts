import { ASTEROID_MODEL_COUNT, PLANET_RADIUS, SHIP_HIT_RADIUS, SPAWN_R_MAX, SPAWN_R_MIN } from './const'
import { clampAsteroidModel } from './asteroid-models'
import type { Ship } from './ship'
import { shipWorldPos } from './ship'

function len(x: number, y: number): number {
  return Math.hypot(x, y)
}

function norm(x: number, y: number): { x: number; y: number } {
  const L = len(x, y)
  if (L < 1e-6) return { x: 1, y: 0 }
  return { x: x / L, y: y / L }
}

export type Asteroid = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hp: number
  maxHp: number
  /** Visual silhouette index 0 … ASTEROID_MODEL_COUNT - 1 (physics still use `r`). */
  model: number
}

export function spawnAsteroid(id: number): Asteroid {
  const angle = Math.random() * Math.PI * 2
  const dist = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN)
  const x = Math.cos(angle) * dist
  const y = Math.sin(angle) * dist
  const r = 12 + Math.random() * 34
  const toC = norm(-x, -y)
  const speed = 440 / (r * 0.55 + 8)
  const vx = toC.x * speed
  const vy = toC.y * speed
  const rMin = 12
  const rSpan = 34
  const maxHp = Math.max(2, Math.round(2 + ((r - rMin) * 18) / rSpan))
  const model = clampAsteroidModel(Math.floor(Math.random() * ASTEROID_MODEL_COUNT))
  return { id, x, y, vx, vy, r, hp: maxHp, maxHp, model }
}

/** Points when this asteroid is destroyed by a projectile (bigger → more). */
export function scoreForDestroyedAsteroid(a: Asteroid): number {
  return Math.round(6 + a.r * 2.8 + a.maxHp * 2.2 + (a.r * a.r) / 100)
}

/** Asteroid destroyed on impact; ship flags should be set by caller from return value. */
export function applyAsteroidShipCollisions(
  list: Asteroid[],
  host: Ship,
  guest: Ship | null,
  opts: { solo: boolean; hostAlive: boolean; guestAlive: boolean },
): { hostStruck: boolean; guestStruck: boolean } {
  let hostStruck = false
  let guestStruck = false
  for (const a of list) {
    if (a.hp <= 0) continue
    if (opts.hostAlive) {
      const { x, y } = shipWorldPos(host)
      if (len(a.x - x, a.y - y) <= a.r + SHIP_HIT_RADIUS) {
        a.hp = 0
        hostStruck = true
        continue
      }
    }
    if (!opts.solo && opts.guestAlive && guest) {
      const { x, y } = shipWorldPos(guest)
      if (len(a.x - x, a.y - y) <= a.r + SHIP_HIT_RADIUS) {
        a.hp = 0
        guestStruck = true
      }
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.hp <= 0) list.splice(i, 1)
  }
  return { hostStruck, guestStruck }
}

export function updateAsteroids(list: Asteroid[], dt: number, onHitPlanet: (dmg: number) => void): void {
  for (const a of list) {
    a.x += a.vx * dt
    a.y += a.vy * dt
    const d = len(a.x, a.y)
    if (d < PLANET_RADIUS + a.r * 0.85) {
      onHitPlanet(Math.max(1, Math.round(a.r / 10)))
      a.hp = 0
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.hp <= 0) list.splice(i, 1)
  }
}
