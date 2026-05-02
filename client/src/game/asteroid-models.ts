import {
  ASTEROID_DIFFICULTY_PERIOD_SEC,
  ASTEROID_MODEL_COUNT,
  ASTEROID_SPAWN_BASE_INTERVAL_SEC,
  ASTEROID_SPAWN_INTERVAL_DECAY,
  ASTEROID_SPAWN_MIN_INTERVAL_SEC,
  ASTEROID_VERTEX_COUNTS,
} from './const'

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic jagged polygon around origin; radial 0.7–1.05, wobbly angles. */
function irregularPolygon(vertexCount: number, seed: number): readonly (readonly [number, number])[] {
  const rnd = mulberry32(seed)
  const twoPi = Math.PI * 2
  const verts: [number, number][] = []
  for (let i = 0; i < vertexCount; i++) {
    const baseAng = (i / vertexCount) * twoPi
    const radial = 0.7 + rnd() * 0.35
    const angWobble = ((rnd() - 0.5) * (0.65 * twoPi)) / vertexCount
    const ang = baseAng + angWobble
    verts.push([Math.cos(ang) * radial, Math.sin(ang) * radial])
  }
  return verts
}

/**
 * Irregular polygons in unit space (scaled by `Asteroid.r` for rendering).
 * Collision remains circular with radius `r`.
 */
export const ASTEROID_POLYGONS: readonly (readonly (readonly [number, number])[])[] =
  ASTEROID_VERTEX_COUNTS.map((n, i) => irregularPolygon(n, 90127 + i * 31337))

export function clampAsteroidModel(raw: number): number {
  const n = Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.max(0, Math.min(ASTEROID_MODEL_COUNT - 1, n))
}

export function asteroidModelPolygon(model: number): readonly (readonly [number, number])[] {
  return ASTEROID_POLYGONS[clampAsteroidModel(model)]!
}

/** Host/solo: seconds between asteroid spawns at elapsed game time. */
export function asteroidSpawnIntervalSec(elapsedSec: number): number {
  const steps = Math.floor(Math.max(0, elapsedSec) / ASTEROID_DIFFICULTY_PERIOD_SEC)
  const interval = ASTEROID_SPAWN_BASE_INTERVAL_SEC * Math.pow(ASTEROID_SPAWN_INTERVAL_DECAY, steps)
  return Math.max(ASTEROID_SPAWN_MIN_INTERVAL_SEC, interval)
}
