/** World space: origin = planet center, +y downward (canvas). */

export const CANVAS_CHANNEL = 'space-defend-canvas'

export const PLANET_RADIUS = 72
export const PLANET_HP_MAX = 100
export const ORBIT_R_MIN = PLANET_RADIUS + 38
export const ORBIT_R_MAX = PLANET_RADIUS + 210
export const SPAWN_R_MIN = 920
export const SPAWN_R_MAX = 1280

export const ARTILLERY_COOLDOWN_MS = 300
export const ROCKET_COOLDOWN_MS = 500

/** XP to earn before each level-up choice (three tiers). */
export const XP_LEVEL_THRESHOLDS = [500, 1500, 3000] as const
export const XP_UPGRADE_ARTILLERY_DELTA_MS = 50
export const XP_UPGRADE_ROCKET_DELTA_MS = 1000
export const MIN_ARTILLERY_CD_MS = 200
export const MIN_ROCKET_CD_MS = 2000

export function effectiveArtilleryCd(bonusMs: number): number {
  return Math.max(MIN_ARTILLERY_CD_MS, ARTILLERY_COOLDOWN_MS - bonusMs)
}

export function effectiveRocketCd(bonusMs: number): number {
  return Math.max(MIN_ROCKET_CD_MS, ROCKET_COOLDOWN_MS - bonusMs)
}

export const ARTILLERY_SPEED = 420
export const ROCKET_SPEED = 220
export const ARTILLERY_DAMAGE = 0.5
export const ROCKET_DAMAGE = 10
export const ARTILLERY_PROJ_R = 3
export const ROCKET_PROJ_R = 10

/** Planet HP lost when a player projectile hits the planet (friendly fire). */
export const PLANET_DAMAGE_FROM_ARTILLERY_HIT = 0.5
export const PLANET_DAMAGE_FROM_ROCKET_HIT = 5

export const SHIP_ANGULAR_SPEED = 2.1
export const SHIP_RADIAL_SPEED = 95

/** Hit radius around ship center (world units); overlaps with asteroid circle. */
export const SHIP_HIT_RADIUS = 15

export type WeaponId = 1 | 2

export type Asteroid = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hp: number
  maxHp: number
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

let nextProjectileId = 1

export function resetProjectileIdCounter(): void {
  nextProjectileId = 1
}

export function takeProjectileId(): number {
  return nextProjectileId++
}

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

function len(x: number, y: number): number {
  return Math.hypot(x, y)
}

function norm(x: number, y: number): { x: number; y: number } {
  const L = len(x, y)
  if (L < 1e-6) return { x: 1, y: 0 }
  return { x: x / L, y: y / L }
}

export function spawnAsteroid(id: number): Asteroid {
  const angle = Math.random() * Math.PI * 2
  const dist = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN)
  const x = Math.cos(angle) * dist
  const y = Math.sin(angle) * dist
  const r = 12 + Math.random() * 34
  const toC = norm(-x, -y)
  const speed = (440 / (r * 0.55 + 8))
  const vx = toC.x * speed
  const vy = toC.y * speed
  /** Largest rocks (~r≈46) reach 20 HP → two direct rocket hits (10+10). */
  const rMin = 12
  const rSpan = 34
  const maxHp = Math.max(2, Math.round(2 + ((r - rMin) * 18) / rSpan))
  return { id, x, y, vx, vy, r, hp: maxHp, maxHp }
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
        p.dmg >= ROCKET_DAMAGE
          ? PLANET_DAMAGE_FROM_ROCKET_HIT
          : PLANET_DAMAGE_FROM_ARTILLERY_HIT
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

export type GuestInputPayload = {
  channel: typeof CANVAS_CHANNEL
  kind: 'guest-inp'
  w: boolean
  a: boolean
  s: boolean
  d: boolean
  wx: number
  wy: number
  lmb: boolean
  wp: WeaponId
}

export type GuestXpPickPayload = {
  channel: typeof CANVAS_CHANNEL
  kind: 'guest-xp-pick'
  choice: 'art' | 'roc'
}

export type StateSyncPayload = {
  channel: typeof CANVAS_CHANNEL
  kind: 'state-sync'
  /** asteroids: [id,x,y,vx,vy,r,hp,maxHp][] */
  A: number[][]
  /** projectiles: [x,y,vx,vy,r,dmg,life,id][] */
  P: number[][]
  /** host ship angle, orbitR */
  ha: number
  hr: number
  /** guest ship */
  ga: number
  gr: number
  planetHp: number
  /** 1 = host ship destroyed */
  hd?: number
  /** 1 = guest ship destroyed */
  gd?: number
  score?: number
  /** Host world aim (for drawing host ship nose on guest). */
  hmx?: number
  hmy?: number
  /**
   * XP sync: [hAcc,hTier,hPend,hArtB,hRocB,gAcc,gTier,gPend,gArtB,gRocB]
   * hPend/gPend: 0 | 1
   */
  xps?: number[]
}

export function packAsteroids(list: Asteroid[]): number[][] {
  return list.map((a) => [a.id, a.x, a.y, a.vx, a.vy, a.r, a.hp, a.maxHp])
}

export function unpackAsteroids(rows: unknown): Asteroid[] {
  if (!Array.isArray(rows)) return []
  const out: Asteroid[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) continue
    const [id, x, y, vx, vy, r, hp, maxHp] = row
    if (
      typeof id !== 'number' ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof vx !== 'number' ||
      typeof vy !== 'number' ||
      typeof r !== 'number' ||
      typeof hp !== 'number' ||
      typeof maxHp !== 'number'
    ) {
      continue
    }
    out.push({ id, x, y, vx, vy, r, hp, maxHp })
  }
  return out
}

export function packProjectiles(list: Projectile[]): number[][] {
  return list.map((p) => [p.x, p.y, p.vx, p.vy, p.r, p.dmg, p.life, p.id, p.own ?? 0])
}

export function unpackProjectiles(rows: unknown): Projectile[] {
  if (!Array.isArray(rows)) return []
  const out: Projectile[] = []
  let legacyId = 1
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue
    const [x, y, vx, vy, r, dmg, life, idRaw, ownRaw] = row
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof vx !== 'number' ||
      typeof vy !== 'number' ||
      typeof r !== 'number' ||
      typeof dmg !== 'number' ||
      typeof life !== 'number'
    ) {
      continue
    }
    const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? idRaw : legacyId++
    const own: 0 | 1 = ownRaw === 1 ? 1 : 0
    out.push({ id, x, y, vx, vy, r, dmg, life, own })
  }
  return out
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

export function isGamePayload(p: unknown): p is Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  return o.channel === CANVAS_CHANNEL
}

export type ShipXpState = {
  acc: number
  tier: number
  pending: boolean
  artB: number
  rocB: number
}

export function packXpSyncRow(host: ShipXpState, guest: ShipXpState): number[] {
  return [
    host.acc,
    host.tier,
    host.pending ? 1 : 0,
    host.artB,
    host.rocB,
    guest.acc,
    guest.tier,
    guest.pending ? 1 : 0,
    guest.artB,
    guest.rocB,
  ]
}

export function unpackXpSyncRow(
  row: unknown,
  host: ShipXpState,
  guest: ShipXpState,
): void {
  if (!Array.isArray(row) || row.length < 10) return
  const n = (i: number) => {
    const v = row[i]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const clampTier = (t: number) => Math.max(0, Math.min(XP_LEVEL_THRESHOLDS.length, Math.floor(t)))
  host.acc = Math.max(0, n(0))
  host.tier = clampTier(n(1))
  host.pending = n(2) !== 0
  host.artB = Math.max(0, n(3))
  host.rocB = Math.max(0, n(4))
  guest.acc = Math.max(0, n(5))
  guest.tier = clampTier(n(6))
  guest.pending = n(7) !== 0
  guest.artB = Math.max(0, n(8))
  guest.rocB = Math.max(0, n(9))
}
