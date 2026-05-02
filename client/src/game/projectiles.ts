import {
  ARTILLERY_COOLDOWN_MS,
  ARTILLERY_DAMAGE,
  ARTILLERY_PROJ_R,
  ARTILLERY_SPEED,
  PLANET_DAMAGE_FROM_ARTILLERY_HIT,
  PLANET_DAMAGE_FROM_ROCKET_HIT,
  PLANET_RADIUS,
  ROCKET_COOLDOWN_MS,
  ROCKET_DAMAGE,
  ROCKET_PROJ_R,
  ROCKET_SPEED,
  SPAWN_R_MAX,
} from './const'
import type { Asteroid } from './asteroids'
import type { WeaponId } from './game-payloads'
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

let nextProjectileId = 1

export function resetProjectileIdCounter(): void {
  nextProjectileId = 1
}

export function takeProjectileId(): number {
  return nextProjectileId++
}

export type Projectile = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  life: number
  /** 0 = host projectile, 1 = guest (co-op). */
  own?: 0 | 1
}

export function updateProjectiles(proj: Projectile[], dt: number): void {
  for (const p of proj) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  }
  for (let i = proj.length - 1; i >= 0; i--) {
    const p = proj[i]!
    if (p.life <= 0 || len(p.x, p.y) > SPAWN_R_MAX + 400) proj.splice(i, 1)
  }
}

export function collideProjectilesWithAsteroids(
  proj: Projectile[],
  ast: Asteroid[],
  onAsteroidDestroyed?: (a: Asteroid, by: Projectile) => void,
): void {
  for (const p of proj) {
    if (p.life <= 0) continue
    for (const a of ast) {
      if (a.hp <= 0) continue
      const dx = a.x - p.x
      const dy = a.y - p.y
      if (dx * dx + dy * dy <= (a.r + p.r) * (a.r + p.r)) {
        a.hp -= p.dmg
        p.life = 0
        if (a.hp <= 0 && onAsteroidDestroyed) onAsteroidDestroyed(a, p)
        break
      }
    }
  }
  for (let i = proj.length - 1; i >= 0; i--) {
    if (proj[i]!.life <= 0) proj.splice(i, 1)
  }
}

export function collideProjectilesWithPlanet(
  proj: Projectile[],
  onHitPlanet: (damage: number) => void,
): void {
  for (const p of proj) {
    if (p.life <= 0) continue
    const d = len(p.x, p.y)
    if (d < PLANET_RADIUS + p.r * 0.92) {
      const dmg =
        p.dmg >= ROCKET_DAMAGE ? PLANET_DAMAGE_FROM_ROCKET_HIT : PLANET_DAMAGE_FROM_ARTILLERY_HIT
      onHitPlanet(dmg)
      p.life = 0
    }
  }
  for (let i = proj.length - 1; i >= 0; i--) {
    if (proj[i]!.life <= 0) proj.splice(i, 1)
  }
}

export function tryFire(
  ship: Ship,
  aimWx: number,
  aimWy: number,
  weapon: WeaponId,
  now: number,
  lastArt: number,
  lastRocket: number,
  proj: Projectile[],
  /** If false, only updates cooldowns when a shot would fire (for client HUD / dry-run). */
  spawnProjectiles = true,
  owner: 0 | 1 = 0,
  cooldowns?: { art: number; roc: number },
): { lastArt: number; lastRocket: number; fired: boolean } {
  const artCd = cooldowns?.art ?? ARTILLERY_COOLDOWN_MS
  const rocCd = cooldowns?.roc ?? ROCKET_COOLDOWN_MS
  const { x: sx, y: sy } = shipWorldPos(ship)
  const dir = norm(aimWx - sx, aimWy - sy)
  let fired = false
  let na = lastArt
  let nr = lastRocket
  if (weapon === 1) {
    if (now - lastArt >= artCd) {
      na = now
      fired = true
      if (spawnProjectiles) {
        proj.push({
          id: takeProjectileId(),
          x: sx + dir.x * 18,
          y: sy + dir.y * 18,
          vx: dir.x * ARTILLERY_SPEED,
          vy: dir.y * ARTILLERY_SPEED,
          r: ARTILLERY_PROJ_R,
          dmg: ARTILLERY_DAMAGE,
          life: 2.4,
          own: owner,
        })
      }
    }
  } else {
    if (now - lastRocket >= rocCd) {
      nr = now
      fired = true
      if (spawnProjectiles) {
        proj.push({
          id: takeProjectileId(),
          x: sx + dir.x * 22,
          y: sy + dir.y * 22,
          vx: dir.x * ROCKET_SPEED,
          vy: dir.y * ROCKET_SPEED,
          r: ROCKET_PROJ_R,
          dmg: ROCKET_DAMAGE,
          life: 4.5,
          own: owner,
        })
      }
    }
  }
  return { lastArt: na, lastRocket: nr, fired }
}

/** Guest-side: advance projectile positions between server snapshots (no life decay). */
export function extrapolateGuestProjectiles(list: Projectile[], dt: number): void {
  const step = Math.min(0.08, Math.max(0, dt))
  for (const p of list) {
    p.x += p.vx * step
    p.y += p.vy * step
  }
}

/**
 * Merge server snapshot into local render list (matched by projectile id).
 * `snap` in (0,1]: how hard to pull toward server position each sync (reduces pops).
 */
export function mergeGuestProjectilesRender(
  list: Projectile[],
  incoming: Projectile[],
  snap = 0.55,
): void {
  const seen = new Set<number>()
  const a = Math.min(1, Math.max(0.15, snap))
  for (const inc of incoming) {
    seen.add(inc.id)
    const local = list.find((p) => p.id === inc.id)
    if (!local) {
      list.push({ ...inc })
    } else {
      local.x = local.x * (1 - a) + inc.x * a
      local.y = local.y * (1 - a) + inc.y * a
      local.vx = inc.vx
      local.vy = inc.vy
      local.r = inc.r
      local.dmg = inc.dmg
      local.life = inc.life
      local.own = inc.own ?? 0
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (!seen.has(list[i]!.id)) list.splice(i, 1)
  }
}
