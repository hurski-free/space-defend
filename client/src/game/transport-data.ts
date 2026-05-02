import { ASTEROID_MODEL_COUNT, XP_LEVEL_THRESHOLDS } from './const'
import type { Asteroid } from './asteroids'
import type { ShipXpState } from './game-payloads'
import type { Projectile } from './projectiles'

function clampAsteroidModel(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.max(0, Math.min(ASTEROID_MODEL_COUNT - 1, n))
}

export function packAsteroids(list: Asteroid[]): number[][] {
  return list.map((a) => [a.id, a.x, a.y, a.vx, a.vy, a.r, a.hp, a.maxHp, a.model])
}

export function unpackAsteroids(rows: unknown): Asteroid[] {
  if (!Array.isArray(rows)) return []
  const out: Asteroid[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) continue
    const [id, x, y, vx, vy, r, hp, maxHp, modelRaw] = row
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
    const model = row.length >= 9 ? clampAsteroidModel(modelRaw) : 0
    out.push({ id, x, y, vx, vy, r, hp, maxHp, model })
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

export function unpackXpSyncRow(row: unknown, host: ShipXpState, guest: ShipXpState): void {
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
