/** World space: origin = planet center, +y downward (canvas). */

export const CANVAS_CHANNEL = 'space-defend-canvas'

export const PLANET_RADIUS = 72
export const PLANET_HP_MAX = 100
export const ORBIT_R_MIN = PLANET_RADIUS + 38
export const ORBIT_R_MAX = PLANET_RADIUS + 210
export const SPAWN_R_MIN = 920
export const SPAWN_R_MAX = 1280

export const ARTILLERY_COOLDOWN_MS = 350
export const ROCKET_COOLDOWN_MS = 4000

/** XP to earn before each level-up choice (three tiers). */
export const XP_LEVEL_THRESHOLDS = [500, 1500, 3000, 5000, 10000] as const
export const XP_UPGRADE_ARTILLERY_DELTA_MS = 50
export const XP_UPGRADE_ROCKET_DELTA_MS = 500
export const MIN_ARTILLERY_CD_MS = 100
export const MIN_ROCKET_CD_MS = 1500

export const ARTILLERY_SPEED = 420
export const ROCKET_SPEED = 220
export const ARTILLERY_DAMAGE = 1
export const ROCKET_DAMAGE = 15
export const ARTILLERY_PROJ_R = 2.5
export const ROCKET_PROJ_R = 10

/** Planet HP lost when a player projectile hits the planet (friendly fire). */
export const PLANET_DAMAGE_FROM_ARTILLERY_HIT = 0.5
export const PLANET_DAMAGE_FROM_ROCKET_HIT = 10

export const SHIP_ANGULAR_SPEED = 2.1
export const SHIP_RADIAL_SPEED = 95

/** Hit radius around ship center (world units); overlaps with asteroid circle. */
export const SHIP_HIT_RADIUS = 15

/** Seconds between spawn waves at game start; shrinks every `ASTEROID_DIFFICULTY_PERIOD_SEC`. */
export const ASTEROID_SPAWN_BASE_INTERVAL_SEC = 2.75
export const ASTEROID_SPAWN_MIN_INTERVAL_SEC = 1.55
export const ASTEROID_DIFFICULTY_PERIOD_SEC = 30
/** Each full period multiplies interval by this factor (< 1 → slightly more asteroids). */
export const ASTEROID_SPAWN_INTERVAL_DECAY = 0.97

/** Vertex counts per model (25 silhouettes, 12–22 verts — irregular “rocky” outlines). */
export const ASTEROID_VERTEX_COUNTS = [
  18, 14, 20, 16, 22, 12, 19, 17, 21, 15, 18, 13, 20, 16, 22, 14, 19, 17, 21, 15, 18, 16, 20, 12, 22,
] as const

/** Number of distinct asteroid silhouettes (must match `ASTEROID_VERTEX_COUNTS.length`). */
export const ASTEROID_MODEL_COUNT = ASTEROID_VERTEX_COUNTS.length

/** Extra world radius beyond max orbit for camera / sky. */
export const VIEW_RADIUS_PAD = 140

/** `min(cw,ch) * this / viewPad` world scale on canvas. */
export const CANVAS_WORLD_SCALE_FACTOR = 0.42

/** Blend factor when merging guest projectile list toward host snapshot. */
export const GUEST_PROJECTILE_RENDER_SNAP = 0.52

export const SMOOTH_SHIP_GUEST_VISUAL_RATE = 22
export const SMOOTH_SHIP_HOST_DISPLAY_RATE = 20

export const GUEST_INPUT_SEND_MIN_MS = 35
export const HOST_STATE_SYNC_MIN_MS = 60

/** Default orbit radius offset from mean(planet…max orbit) for ships at session start. */
export const SHIP_ORBIT_START_EXTRA = 40
/** Orbit offset after `resetGame` (slightly tighter than initial spawn). */
export const SHIP_ORBIT_RESET_EXTRA = 35

/** Rocket mesh + plume scale (~2/3 of base). */
export const ROCKET_VIS = 2 / 3
export const ROCKET_TRAIL_MAX = 26
export const ROCKET_TRAIL_MIN_DIST_SCALE = 2.8
export const ROCKET_TRAIL_MIN_DIST_SQ = (ROCKET_TRAIL_MIN_DIST_SCALE * ROCKET_VIS) ** 2
/** After this age (ms) trail points no longer contribute. */
export const ROCKET_PLUME_TTL_MS = 580
/** Per-point alpha scales by life^this (stronger tail fade). */
export const ROCKET_PLUME_FADE_EXP = 2.35
