<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ARTILLERY_COOLDOWN_MS,
  CANVAS_CHANNEL,
  ROCKET_COOLDOWN_MS,
  ORBIT_R_MAX,
  PLANET_HP_MAX,
  PLANET_RADIUS,
  type Asteroid,
  type GuestInputPayload,
  type KeysHeld,
  type Projectile,
  type Ship,
  type StateSyncPayload,
  type WeaponId,
  ROCKET_DAMAGE,
  extrapolateGuestProjectiles,
  mergeGuestProjectilesRender,
  resetProjectileIdCounter,
  scoreForDestroyedAsteroid,
  applyAsteroidShipCollisions,
  collideProjectilesWithAsteroids,
  collideProjectilesWithPlanet,
  integrateShip,
  isGamePayload,
  smoothShipToward,
  packAsteroids,
  packProjectiles,
  shipWorldPos,
  spawnAsteroid,
  tryFire,
  unpackAsteroids,
  unpackProjectiles,
  updateAsteroids,
  updateProjectiles,
} from '../game/planetDefense'

const props = defineProps<{
  gameSessionId: number
  isHost: boolean
  solo?: boolean
  sendSignal: (payload: unknown) => void
  peerSignal: { seq: number; payload: unknown } | null
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const viewPad = ORBIT_R_MAX + 140

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1
let cw = 1
let ch = 1
let cx = 0
let cy = 0
let worldScale = 1

const hostShip: Ship = { angle: 0, orbitR: (PLANET_RADIUS + ORBIT_R_MAX) / 2 + 40 }
/** Guest client: smoothed host ship for drawing (sync target is hostShip). */
const hostDisplay: Ship = { angle: 0, orbitR: (PLANET_RADIUS + ORBIT_R_MAX) / 2 + 40 }
const guestShip: Ship = { angle: Math.PI, orbitR: (PLANET_RADIUS + ORBIT_R_MAX) / 2 + 40 }
const guestVisual: Ship = { ...guestShip }

let hostAimWx = Number.NaN
let hostAimWy = Number.NaN

const asteroids: Asteroid[] = []
const projectiles: Projectile[] = []

/** Local-only plume samples (not networked). */
type RocketTrailPt = { x: number; y: number; t: number }
const rocketTrailById = new Map<number, RocketTrailPt[]>()
/** Rocket mesh + plume scale (~1.5× smaller than original). */
const ROCKET_VIS = 2 / 3
const ROCKET_TRAIL_MAX = 26
const ROCKET_TRAIL_MIN_DIST_SQ = (2.8 * ROCKET_VIS) ** 2
/** After this age (ms) trail points no longer contribute. */
const ROCKET_PLUME_TTL_MS = 580
/** Per-point alpha scales by life^this (stronger tail fade). */
const ROCKET_PLUME_FADE_EXP = 2.35

function rocketExhaustWorld(p: Projectile): { x: number; y: number } {
  const spd = Math.hypot(p.vx, p.vy)
  if (spd < 1e-6) return { x: p.x, y: p.y }
  const k = (15 * ROCKET_VIS) / spd
  return { x: p.x - p.vx * k, y: p.y - p.vy * k }
}

function syncRocketTrails(now: number): void {
  const seen = new Set<number>()
  for (const p of projectiles) {
    if (p.dmg < ROCKET_DAMAGE) continue
    seen.add(p.id)
    const { x: ex, y: ey } = rocketExhaustWorld(p)
    let trail = rocketTrailById.get(p.id)
    if (!trail) {
      rocketTrailById.set(p.id, [{ x: ex, y: ey, t: now }])
      continue
    }
    while (trail.length && now - trail[0]!.t > ROCKET_PLUME_TTL_MS) trail.shift()
    const last = trail[trail.length - 1]!
    const dx = ex - last.x
    const dy = ey - last.y
    if (dx * dx + dy * dy >= ROCKET_TRAIL_MIN_DIST_SQ) {
      trail.push({ x: ex, y: ey, t: now })
      while (trail.length > ROCKET_TRAIL_MAX) trail.shift()
    } else {
      last.x = ex
      last.y = ey
      last.t = now
    }
  }
  for (const id of rocketTrailById.keys()) {
    if (!seen.has(id)) rocketTrailById.delete(id)
  }
}

let planetHp = PLANET_HP_MAX
let nextAstId = 1
let spawnAcc = 0
let lastArtHost = 0
let lastRocketHost = 0
let lastArtGuest = 0
let lastRocketGuest = 0

const keysHost: KeysHeld = { w: false, a: false, s: false, d: false }
const keysGuest: KeysHeld = { w: false, a: false, s: false, d: false }

let mouseHostX = 0
let mouseHostY = 0
let lmbHost = false

let guestWx = 0
let guestWy = 0
let guestLmb = false

/** Guest client: aim + LMB for signals */
let mouseWorldX = 0
let mouseWorldY = 0
let lmb = false

let guestHudArt = 0
let guestHudRoc = 0

let weaponHost: WeaponId = 1
let weaponGuest: WeaponId = 1

let lastSyncSent = 0
let lastGuestSend = 0
let lastT = performance.now()
let raf = 0
let running = true
let gameOver = false
let hostDead = false
let guestDead = false

let gameStartMs = 0
let frozenElapsedSec: number | null = null
let score = 0

function formatGameTime(totalSec: number): string {
  const s = Math.floor(Math.max(0, totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function resetGame(): void {
  asteroids.length = 0
  projectiles.length = 0
  planetHp = PLANET_HP_MAX
  nextAstId = 1
  spawnAcc = 0
  const mid = (PLANET_RADIUS + ORBIT_R_MAX) / 2 + 35
  hostShip.angle = 0
  hostShip.orbitR = mid
  hostDisplay.angle = hostShip.angle
  hostDisplay.orbitR = hostShip.orbitR
  guestShip.angle = Math.PI
  guestShip.orbitR = mid
  guestVisual.angle = guestShip.angle
  guestVisual.orbitR = guestShip.orbitR
  hostAimWx = Number.NaN
  hostAimWy = Number.NaN
  resetProjectileIdCounter()
  rocketTrailById.clear()
  lastArtHost = lastRocketHost = lastArtGuest = lastRocketGuest = 0
  guestHudArt = guestHudRoc = 0
  lmbHost = false
  lmb = false
  guestLmb = false
  hostDead = false
  guestDead = false
  gameOver = false
  gameStartMs = performance.now()
  frozenElapsedSec = null
  score = 0
}

function worldFromClient(clientX: number, clientY: number): { x: number; y: number } {
  const el = canvasRef.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  const mx = clientX - r.left
  const my = clientY - r.top
  return {
    x: (mx - cx) / worldScale,
    y: (my - cy) / worldScale,
  }
}

function updateMouse(ev: PointerEvent): void {
  const w = worldFromClient(ev.clientX, ev.clientY)
  if (props.solo || props.isHost) {
    mouseHostX = w.x
    mouseHostY = w.y
  } else {
    mouseWorldX = w.x
    mouseWorldY = w.y
  }
}

function onPeerPayload(payload: unknown): void {
  if (!isGamePayload(payload)) return
  const kind = payload.kind
  if (kind === 'game-start') {
    resetGame()
    return
  }
  if (props.solo) return
  if (props.isHost && kind === 'guest-inp') {
    keysGuest.w = Boolean(payload.w)
    keysGuest.a = Boolean(payload.a)
    keysGuest.s = Boolean(payload.s)
    keysGuest.d = Boolean(payload.d)
    weaponGuest = payload.wp === 2 ? 2 : 1
    if (typeof payload.wx === 'number' && typeof payload.wy === 'number') {
      guestWx = payload.wx
      guestWy = payload.wy
    }
    guestLmb = Boolean(payload.lmb)
    return
  }
  if (!props.isHost && kind === 'state-sync') {
    const p = payload as StateSyncPayload
    const na = unpackAsteroids(p.A)
    asteroids.length = 0
    asteroids.push(...na)
    const np = unpackProjectiles(p.P)
    mergeGuestProjectilesRender(projectiles, np, 0.52)
    if (typeof p.hmx === 'number' && typeof p.hmy === 'number' && Number.isFinite(p.hmx) && Number.isFinite(p.hmy)) {
      hostAimWx = p.hmx
      hostAimWy = p.hmy
    }
    if (typeof p.ha === 'number' && typeof p.hr === 'number') {
      hostShip.angle = p.ha
      hostShip.orbitR = p.hr
    }
    if (typeof p.ga === 'number' && typeof p.gr === 'number') {
      guestShip.angle = p.ga
      guestShip.orbitR = p.gr
    }
    if (typeof p.planetHp === 'number' && Number.isFinite(p.planetHp)) {
      planetHp = Math.max(0, p.planetHp)
    }
    hostDead = p.hd === 1
    guestDead = p.gd === 1
    if (typeof p.score === 'number' && Number.isFinite(p.score)) {
      score = Math.max(0, p.score)
    }
  }
}

watch(
  () => props.peerSignal?.seq,
  () => {
    const snap = props.peerSignal
    if (!snap) return
    onPeerPayload(snap.payload)
  },
)

watch(
  () => props.gameSessionId,
  (_id, oldId) => {
    resetGame()
    gameOver = false
    lastT = performance.now()
    if (oldId !== undefined) {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
  },
  { flush: 'post', immediate: true },
)

function sendGuestInput(now: number): void {
  if (props.solo || props.isHost) return
  if (guestDead) return
  if (now - lastGuestSend < 45) return
  lastGuestSend = now
  const ship = guestVisual
  const { x: sx, y: sy } = shipWorldPos(ship)
  const dir = { x: mouseWorldX - sx, y: mouseWorldY - sy }
  const L = Math.hypot(dir.x, dir.y)
  const wx = L > 1e-6 ? mouseWorldX : sx + 1
  const wy = L > 1e-6 ? mouseWorldY : sy
  const msg: GuestInputPayload = {
    channel: CANVAS_CHANNEL,
    kind: 'guest-inp',
    w: keysHost.w,
    a: keysHost.a,
    s: keysHost.s,
    d: keysHost.d,
    wx,
    wy,
    lmb,
    wp: weaponHost,
  }
  props.sendSignal(msg)
}

function sendHostSync(now: number): void {
  if (props.solo || !props.isHost) return
  if (now - lastSyncSent < 75) return
  lastSyncSent = now
  const msg: StateSyncPayload = {
    channel: CANVAS_CHANNEL,
    kind: 'state-sync',
    A: packAsteroids(asteroids),
    P: packProjectiles(projectiles),
    ha: hostShip.angle,
    hr: hostShip.orbitR,
    ga: guestShip.angle,
    gr: guestShip.orbitR,
    planetHp,
    hd: hostDead ? 1 : 0,
    gd: guestDead ? 1 : 0,
    score,
    hmx: mouseHostX,
    hmy: mouseHostY,
  }
  props.sendSignal(msg)
}

function fireIfReady(ship: Ship, isGuest: boolean, now: number): void {
  if (isGuest) {
    if (guestDead) return
    if (!guestLmb) return
    const r = tryFire(ship, guestWx, guestWy, weaponGuest, now, lastArtGuest, lastRocketGuest, projectiles, true)
    lastArtGuest = r.lastArt
    lastRocketGuest = r.lastRocket
  } else {
    if (hostDead) return
    if (!lmbHost) return
    const r = tryFire(ship, mouseHostX, mouseHostY, weaponHost, now, lastArtHost, lastRocketHost, projectiles, true)
    lastArtHost = r.lastArt
    lastRocketHost = r.lastRocket
  }
}

function tick(now: number): void {
  if (!running) return
  const dt = Math.min(0.055, (now - lastT) / 1000)
  lastT = now

  if (props.solo) {
    if (!hostDead) integrateShip(hostShip, keysHost, dt)
    spawnAcc += dt
    if (spawnAcc >= 2.75) {
      spawnAcc = 0
      asteroids.push(spawnAsteroid(nextAstId++))
    }
    updateAsteroids(asteroids, dt, (dmg) => {
      planetHp = Math.max(0, planetHp - dmg)
    })
    const hit = applyAsteroidShipCollisions(asteroids, hostShip, null, {
      solo: true,
      hostAlive: !hostDead,
      guestAlive: false,
    })
    if (hit.hostStruck) hostDead = true
    updateProjectiles(projectiles, dt)
    collideProjectilesWithAsteroids(projectiles, asteroids, (a) => {
      score += scoreForDestroyedAsteroid(a)
    })
    collideProjectilesWithPlanet(projectiles, (dmg) => {
      planetHp = Math.max(0, planetHp - dmg)
    })
    fireIfReady(hostShip, false, now)
    if (hostDead || planetHp <= 0) gameOver = true
  } else if (props.isHost) {
    if (!hostDead) integrateShip(hostShip, keysHost, dt)
    if (!guestDead) integrateShip(guestShip, keysGuest, dt)
    spawnAcc += dt
    if (spawnAcc >= 2.75) {
      spawnAcc = 0
      asteroids.push(spawnAsteroid(nextAstId++))
    }
    updateAsteroids(asteroids, dt, (dmg) => {
      planetHp = Math.max(0, planetHp - dmg)
    })
    const hit = applyAsteroidShipCollisions(asteroids, hostShip, guestShip, {
      solo: false,
      hostAlive: !hostDead,
      guestAlive: !guestDead,
    })
    if (hit.hostStruck) hostDead = true
    if (hit.guestStruck) guestDead = true
    updateProjectiles(projectiles, dt)
    collideProjectilesWithAsteroids(projectiles, asteroids, (a) => {
      score += scoreForDestroyedAsteroid(a)
    })
    collideProjectilesWithPlanet(projectiles, (dmg) => {
      planetHp = Math.max(0, planetHp - dmg)
    })
    fireIfReady(hostShip, false, now)
    fireIfReady(guestShip, true, now)
    sendHostSync(now)
    if (planetHp <= 0) gameOver = true
  } else {
    extrapolateGuestProjectiles(projectiles, dt)
    if (!guestDead) {
      integrateShip(guestVisual, keysHost, dt)
      smoothShipToward(guestVisual, guestShip, dt, 22)
    } else {
      guestVisual.angle = guestShip.angle
      guestVisual.orbitR = guestShip.orbitR
    }
    if (!hostDead) {
      smoothShipToward(hostDisplay, hostShip, dt, 20)
    } else {
      hostDisplay.angle = hostShip.angle
      hostDisplay.orbitR = hostShip.orbitR
    }
    sendGuestInput(now)
    if (lmb && !guestDead) {
      const dummy: Projectile[] = []
      const hud = tryFire(
        guestVisual,
        mouseWorldX,
        mouseWorldY,
        weaponHost,
        now,
        guestHudArt,
        guestHudRoc,
        dummy,
        false,
      )
      if (hud.fired) {
        guestHudArt = hud.lastArt
        guestHudRoc = hud.lastRocket
      }
    }
    if (planetHp <= 0) gameOver = true
  }

  syncRocketTrails(now)
  draw(now)
  if (!gameOver) {
    raf = requestAnimationFrame(tick)
  }
}

function draw(now: number): void {
  const el = canvasRef.value
  const surf = ctx
  if (!el || !surf) return

  surf.setTransform(dpr, 0, 0, dpr, 0, 0)
  surf.clearRect(0, 0, cw, ch)

  cx = cw / 2
  cy = ch / 2
  worldScale = (Math.min(cw, ch) * 0.42) / viewPad

  surf.save()
  surf.translate(cx, cy)
  surf.scale(worldScale, worldScale)

  const skyR = viewPad * 1.05
  const skyGrad = surf.createRadialGradient(0, 0, PLANET_RADIUS * 0.2, 0, 0, skyR)
  skyGrad.addColorStop(0, 'rgba(30, 50, 90, 0.35)')
  skyGrad.addColorStop(0.45, 'rgba(12, 14, 28, 0.5)')
  skyGrad.addColorStop(1, 'rgba(6, 8, 16, 0.92)')
  surf.fillStyle = skyGrad
  surf.beginPath()
  surf.arc(0, 0, skyR, 0, Math.PI * 2)
  surf.fill()

  surf.strokeStyle = 'rgba(94, 224, 208, 0.12)'
  surf.lineWidth = 2 / worldScale
  surf.beginPath()
  surf.arc(0, 0, ORBIT_R_MAX, 0, Math.PI * 2)
  surf.stroke()
  surf.beginPath()
  surf.arc(0, 0, ORBIT_R_MAX * 0.65, 0, Math.PI * 2)
  surf.stroke()

  const pg = surf.createRadialGradient(0, 0, 0, 0, 0, PLANET_RADIUS)
  pg.addColorStop(0, '#3d6eb5')
  pg.addColorStop(0.55, '#2a4d8a')
  pg.addColorStop(1, '#1a3058')
  surf.fillStyle = pg
  surf.beginPath()
  surf.arc(0, 0, PLANET_RADIUS, 0, Math.PI * 2)
  surf.fill()
  surf.strokeStyle = 'rgba(120, 180, 255, 0.35)'
  surf.lineWidth = 3 / worldScale
  surf.stroke()

  for (const a of asteroids) {
    if (a.hp <= 0) continue
    const t = a.hp / a.maxHp
    surf.fillStyle = `rgba(${160 + (1 - t) * 60}, ${90 + t * 40}, ${60 + t * 30}, 0.95)`
    surf.beginPath()
    surf.arc(a.x, a.y, a.r, 0, Math.PI * 2)
    surf.fill()
    surf.strokeStyle = 'rgba(40, 30, 25, 0.5)'
    surf.lineWidth = 2 / worldScale
    surf.stroke()
  }

  for (const p of projectiles) {
    const spd = Math.hypot(p.vx, p.vy)
    const isRocket = p.dmg >= ROCKET_DAMAGE
    if (!isRocket) {
      surf.fillStyle = 'rgba(255, 230, 160, 0.95)'
      surf.beginPath()
      surf.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      surf.fill()
      continue
    }
    const ang = spd > 1e-6 ? Math.atan2(p.vy, p.vx) : 0
    const trail = rocketTrailById.get(p.id)
    const exh = rocketExhaustWorld(p)

    const plumeLife = (born: number) => {
      const u = 1 - (now - born) / ROCKET_PLUME_TTL_MS
      if (u <= 0) return 0
      if (u >= 1) return 1
      return u ** ROCKET_PLUME_FADE_EXP
    }

    if (trail && trail.length >= 1) {
      const x0 = trail[0]!.x
      const y0 = trail[0]!.y
      const tailFade = plumeLife(trail[0]!.t)
      const headFade = plumeLife(trail[trail.length - 1]!.t)

      const buildPath = () => {
        surf.beginPath()
        surf.moveTo(x0, y0)
        for (let i = 1; i < trail.length; i++) surf.lineTo(trail[i]!.x, trail[i]!.y)
        surf.lineTo(exh.x, exh.y)
      }

      surf.lineJoin = 'round'
      surf.lineCap = 'round'

      buildPath()
      surf.lineWidth = (15 * ROCKET_VIS) / worldScale
      const gWide = surf.createLinearGradient(x0, y0, exh.x, exh.y)
      gWide.addColorStop(0, `rgba(48, 44, 56, ${0.04 * tailFade})`)
      gWide.addColorStop(0.18, `rgba(82, 70, 78, ${0.07 * tailFade})`)
      gWide.addColorStop(0.42, `rgba(130, 82, 64, ${0.1 * Math.sqrt(tailFade * headFade)})`)
      gWide.addColorStop(0.68, `rgba(255, 120, 55, ${0.28 * headFade})`)
      gWide.addColorStop(0.9, `rgba(255, 200, 130, ${0.62 * headFade})`)
      gWide.addColorStop(1, `rgba(255, 252, 245, ${0.88 * headFade})`)
      surf.strokeStyle = gWide
      surf.stroke()

      buildPath()
      surf.lineWidth = (5 * ROCKET_VIS) / worldScale
      const gMid = surf.createLinearGradient(x0, y0, exh.x, exh.y)
      gMid.addColorStop(0, `rgba(100, 88, 92, ${0.02 * tailFade})`)
      gMid.addColorStop(0.35, `rgba(200, 100, 55, ${0.12 * tailFade})`)
      gMid.addColorStop(0.72, `rgba(255, 175, 95, ${0.5 * headFade})`)
      gMid.addColorStop(1, `rgba(255, 255, 255, ${0.92 * headFade})`)
      surf.strokeStyle = gMid
      surf.stroke()

      buildPath()
      surf.lineWidth = (1.65 * ROCKET_VIS) / worldScale
      const gCore = surf.createLinearGradient(x0, y0, exh.x, exh.y)
      gCore.addColorStop(0, `rgba(180, 160, 150, ${0.015 * tailFade})`)
      gCore.addColorStop(0.55, `rgba(255, 220, 180, ${0.35 * headFade})`)
      gCore.addColorStop(1, `rgba(255, 255, 255, ${0.98 * headFade})`)
      surf.strokeStyle = gCore
      surf.stroke()

      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i]!
        const L = plumeLife(pt.t)
        if (L < 0.02) continue
        const along = trail.length > 1 ? i / (trail.length - 1) : 1
        const spread = 1 - along
        const r = (1.8 + spread * 9) * ROCKET_VIS
        const hot = along * along * L
        const smoke = (1 - along) * (1 - along) * L
        const rg = surf.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r)
        rg.addColorStop(0, `rgba(255, 255, 250, ${0.05 * smoke + 0.75 * hot})`)
        rg.addColorStop(0.25, `rgba(255, 200, 120, ${0.12 * smoke + 0.38 * hot})`)
        rg.addColorStop(0.55, `rgba(255, 95, 40, ${0.08 * smoke + 0.22 * hot})`)
        rg.addColorStop(1, `rgba(40, 32, 38, ${0.06 * smoke})`)
        surf.fillStyle = rg
        surf.beginPath()
        surf.arc(pt.x, pt.y, r, 0, Math.PI * 2)
        surf.fill()
      }

      const coreR = (5.2 + 1.8 * headFade) * ROCKET_VIS
      const cr = surf.createRadialGradient(exh.x, exh.y, 0, exh.x, exh.y, coreR)
      cr.addColorStop(0, `rgba(255, 255, 255, ${0.99 * headFade})`)
      cr.addColorStop(0.08, `rgba(255, 248, 220, ${0.95 * headFade})`)
      cr.addColorStop(0.28, `rgba(255, 160, 70, ${0.72 * headFade})`)
      cr.addColorStop(0.55, `rgba(255, 70, 25, ${0.35 * headFade})`)
      cr.addColorStop(1, 'rgba(255, 30, 10, 0)')
      surf.fillStyle = cr
      surf.beginPath()
      surf.arc(exh.x, exh.y, coreR, 0, Math.PI * 2)
      surf.fill()

      surf.beginPath()
      surf.arc(exh.x, exh.y, coreR * 0.42, 0, Math.PI * 2)
      surf.strokeStyle = `rgba(12, 6, 8, ${0.62 * headFade})`
      surf.lineWidth = (2.1 * ROCKET_VIS) / worldScale
      surf.stroke()
      surf.beginPath()
      surf.arc(exh.x, exh.y, coreR * 0.52, 0, Math.PI * 2)
      surf.strokeStyle = `rgba(255, 200, 120, ${0.35 * headFade})`
      surf.lineWidth = (0.85 * ROCKET_VIS) / worldScale
      surf.stroke()
    }
    surf.save()
    surf.translate(p.x, p.y)
    surf.rotate(ang)
    const v = ROCKET_VIS
    const lw = (1.25 * v) / worldScale
    surf.lineWidth = lw
    surf.fillStyle = 'rgba(255, 60, 20, 0.55)'
    surf.strokeStyle = 'rgba(255, 120, 60, 0.5)'
    surf.beginPath()
    surf.moveTo(-20 * v, 0)
    surf.lineTo(-32 * v, 6.5 * v)
    surf.lineTo(-30 * v, 0)
    surf.lineTo(-32 * v, -6.5 * v)
    surf.closePath()
    surf.fill()
    surf.stroke()
    surf.fillStyle = 'rgba(255, 140, 40, 0.35)'
    surf.beginPath()
    surf.ellipse(-24 * v, 0, 7 * v, 3.2 * v, 0, 0, Math.PI * 2)
    surf.fill()
    surf.fillStyle = '#c8d0e8'
    surf.strokeStyle = '#4a5568'
    surf.beginPath()
    surf.moveTo(22 * v, 0)
    surf.lineTo(-4 * v, 6 * v)
    surf.lineTo(-10 * v, 3.5 * v)
    surf.lineTo(-14 * v, 0)
    surf.lineTo(-10 * v, -3.5 * v)
    surf.lineTo(-4 * v, -6 * v)
    surf.closePath()
    surf.fill()
    surf.stroke()
    surf.fillStyle = '#8a96b0'
    surf.beginPath()
    surf.moveTo(-4 * v, 6 * v)
    surf.lineTo(-8 * v, 2 * v)
    surf.lineTo(-8 * v, -2 * v)
    surf.lineTo(-4 * v, -6 * v)
    surf.lineTo(2 * v, 0)
    surf.closePath()
    surf.fill()
    surf.fillStyle = '#f0652a'
    surf.strokeStyle = '#7a2810'
    surf.beginPath()
    surf.moveTo(22 * v, 0)
    surf.lineTo(30 * v, 0)
    surf.lineTo(24 * v, 3.2 * v)
    surf.lineTo(20 * v, 1.2 * v)
    surf.lineTo(20 * v, -1.2 * v)
    surf.lineTo(24 * v, -3.2 * v)
    surf.closePath()
    surf.fill()
    surf.stroke()
    surf.fillStyle = 'rgba(90, 200, 255, 0.45)'
    surf.strokeStyle = 'rgba(40, 120, 200, 0.35)'
    surf.beginPath()
    surf.moveTo(14 * v, 0)
    surf.lineTo(4 * v, 2.2 * v)
    surf.lineTo(4 * v, -2.2 * v)
    surf.closePath()
    surf.fill()
    surf.stroke()
    surf.restore()
  }

  function drawShip(
    g: CanvasRenderingContext2D,
    ship: Ship,
    fill: string,
    stroke: string,
    aimX: number | null,
    aimY: number | null,
  ): void {
    const { x, y } = shipWorldPos(ship)
    const aim =
      aimX != null && aimY != null ? Math.atan2(aimY - y, aimX - x) : ship.angle + Math.PI / 2
    g.save()
    g.translate(x, y)
    g.rotate(aim)
    g.fillStyle = fill
    g.strokeStyle = stroke
    g.lineWidth = 2 / worldScale
    g.beginPath()
    g.moveTo(22, 0)
    g.lineTo(-14, 12)
    g.lineTo(-8, 0)
    g.lineTo(-14, -12)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
  }

  if (props.solo) {
    if (!hostDead) drawShip(surf, hostShip, 'rgba(94, 224, 208, 0.95)', '#2a8a7a', mouseHostX, mouseHostY)
  } else if (props.isHost) {
    if (!hostDead) drawShip(surf, hostShip, 'rgba(94, 180, 255, 0.95)', '#3a6aaa', mouseHostX, mouseHostY)
    if (!guestDead) drawShip(surf, guestShip, 'rgba(255, 160, 120, 0.95)', '#aa6040', guestWx, guestWy)
  } else {
    const hostAimOk = Number.isFinite(hostAimWx) && Number.isFinite(hostAimWy)
    if (!hostDead) {
      drawShip(
        surf,
        hostDisplay,
        'rgba(94, 180, 255, 0.95)',
        '#3a6aaa',
        hostAimOk ? hostAimWx : null,
        hostAimOk ? hostAimWy : null,
      )
    }
    if (!guestDead) drawShip(surf, guestVisual, 'rgba(255, 160, 120, 0.95)', '#aa6040', mouseWorldX, mouseWorldY)
  }

  surf.restore()

  // Planet HP: ring + value at planet center (screen space)
  surf.save()
  surf.setTransform(dpr, 0, 0, dpr, 0, 0)
  surf.translate(cx, cy)
  const hp = Math.max(0, planetHp)
  const hpFrac = Math.min(1, hp / PLANET_HP_MAX)
  const pr = PLANET_RADIUS * worldScale
  const ringR = pr + Math.max(5, 6 * worldScale)
  surf.beginPath()
  surf.arc(0, 0, ringR, 0, Math.PI * 2)
  surf.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  surf.lineWidth = 6
  surf.stroke()
  surf.beginPath()
  surf.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac)
  surf.strokeStyle =
    hpFrac > 0.35 ? 'rgba(94, 224, 208, 0.95)' : 'rgba(255, 150, 110, 0.95)'
  surf.lineWidth = 5
  surf.lineCap = 'round'
  surf.stroke()
  const numPx = Math.max(14, Math.min(28, Math.round(pr * 0.38)))
  surf.font = `700 ${numPx}px system-ui, sans-serif`
  surf.textAlign = 'center'
  surf.textBaseline = 'middle'
  surf.lineWidth = Math.max(2, numPx * 0.12)
  surf.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  surf.fillStyle = 'rgba(248, 250, 255, 0.96)'
  const hpStr = `${Math.round(hp)}`
  surf.strokeText(hpStr, 0, 0.5)
  surf.fillText(hpStr, 0, 0.5)
  surf.restore()

  surf.save()
  surf.setTransform(dpr, 0, 0, dpr, 0, 0)
  surf.font = '13px system-ui, sans-serif'
  surf.fillStyle = 'rgba(232, 234, 239, 0.9)'
  let elapsedSec = (now - gameStartMs) / 1000
  if (gameOver) {
    if (frozenElapsedSec === null) frozenElapsedSec = elapsedSec
    elapsedSec = frozenElapsedSec
  }
  surf.fillText(
    `Time ${formatGameTime(elapsedSec)}   ·   Score ${Math.round(score)}`,
    14,
    20,
  )
  surf.fillText(`Planet: ${Math.round(hp)} / ${PLANET_HP_MAX}`, 14, 38)
  const artCd = props.solo || props.isHost ? lastArtHost : guestHudArt
  const rocCd = props.solo || props.isHost ? lastRocketHost : guestHudRoc
  const artLeft =
    artCd === 0 ? 0 : Math.max(0, ARTILLERY_COOLDOWN_MS - (now - artCd)) / 1000
  const rocLeft = rocCd === 0 ? 0 : Math.max(0, ROCKET_COOLDOWN_MS - (now - rocCd)) / 1000
  const wpn = weaponHost
  const artLabel = `[1] Artillery  ${artLeft > 0.01 ? artLeft.toFixed(1) + 's' : 'ready'}`
  const sep = '   ·   '
  const rocLabel = `[2] Rockets  ${rocLeft > 0.01 ? rocLeft.toFixed(1) + 's' : 'ready'}`
  let hx = 14
  const hy = 58
  surf.font = wpn === 1 ? '600 13px system-ui, sans-serif' : '13px system-ui, sans-serif'
  surf.fillStyle =
    wpn === 1 ? 'rgba(94, 224, 208, 0.98)' : 'rgba(139, 147, 166, 0.82)'
  surf.fillText(artLabel, hx, hy)
  hx += surf.measureText(artLabel).width
  surf.font = '13px system-ui, sans-serif'
  surf.fillStyle = 'rgba(90, 98, 112, 0.9)'
  surf.fillText(sep, hx, hy)
  hx += surf.measureText(sep).width
  surf.font = wpn === 2 ? '600 13px system-ui, sans-serif' : '13px system-ui, sans-serif'
  surf.fillStyle =
    wpn === 2 ? 'rgba(94, 224, 208, 0.98)' : 'rgba(139, 147, 166, 0.82)'
  surf.fillText(rocLabel, hx, hy)
  surf.font = '13px system-ui, sans-serif'
  surf.fillStyle = 'rgba(139, 147, 166, 0.82)'
  surf.fillText('WASD move · hold LMB to fire when ready', 14, 76)
  if (!props.solo && props.isHost && guestDead) {
    surf.fillStyle = 'rgba(255, 170, 120, 0.9)'
    surf.fillText('Guest ship destroyed', 14, 94)
  } else if (!props.solo && !props.isHost && hostDead) {
    surf.fillStyle = 'rgba(255, 170, 120, 0.9)'
    surf.fillText('Host ship destroyed', 14, 94)
  } else if (!props.solo && props.isHost && hostDead) {
    surf.fillStyle = 'rgba(255, 170, 120, 0.9)'
    surf.fillText('Your ship was destroyed', 14, 94)
  } else if (!props.solo && !props.isHost && guestDead) {
    surf.fillStyle = 'rgba(255, 170, 120, 0.9)'
    surf.fillText('Your ship was destroyed', 14, 94)
  }
  if (gameOver) {
    surf.font = '600 18px system-ui, sans-serif'
    let gy = 104
    if (props.solo && hostDead) {
      surf.fillStyle = 'rgba(255, 160, 100, 0.95)'
      surf.fillText('Ship destroyed', 14, gy)
      gy += 24
    }
    if (planetHp <= 0) {
      surf.fillStyle = 'rgba(220, 80, 80, 0.95)'
      surf.fillText('Planet lost — defend next time', 14, gy)
    }
  }
  surf.restore()
}

function resizeCanvas(): void {
  const el = canvasRef.value
  if (!el) return
  dpr = window.devicePixelRatio || 1
  cw = el.clientWidth
  ch = el.clientHeight
  el.width = Math.max(1, Math.floor(cw * dpr))
  el.height = Math.max(1, Math.floor(ch * dpr))
  ctx = el.getContext('2d')
  lastT = performance.now()
}

let ro: ResizeObserver | null = null

function onKeyDown(ev: KeyboardEvent): void {
  switch (ev.code) {
    case 'KeyW':
      keysHost.w = true
      break
    case 'KeyA':
      keysHost.a = true
      break
    case 'KeyS':
      keysHost.s = true
      break
    case 'KeyD':
      keysHost.d = true
      break
    case 'Digit1':
    case 'Numpad1':
      weaponHost = 1
      break
    case 'Digit2':
    case 'Numpad2':
      weaponHost = 2
      break
    default:
      break
  }
}

function onKeyUp(ev: KeyboardEvent): void {
  switch (ev.code) {
    case 'KeyW':
      keysHost.w = false
      break
    case 'KeyA':
      keysHost.a = false
      break
    case 'KeyS':
      keysHost.s = false
      break
    case 'KeyD':
      keysHost.d = false
      break
    default:
      break
  }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  try {
    canvasRef.value?.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  if (props.solo || props.isHost) lmbHost = true
  else lmb = true
  updateMouse(e)
}

function onPointerUp(e: PointerEvent): void {
  if (e.button !== 0) return
  if (props.solo || props.isHost) lmbHost = false
  else lmb = false
}

function onPointerLeave(): void {
  if (props.solo || props.isHost) lmbHost = false
  else lmb = false
}

onMounted(() => {
  const el = canvasRef.value
  if (!el) return
  resizeCanvas()
  ro = new ResizeObserver(() => resizeCanvas())
  ro.observe(el)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  el.focus()
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  running = false
  cancelAnimationFrame(raf)
  ro?.disconnect()
  ro = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <section class="draw-wrap">
    <canvas
      ref="canvasRef"
      class="draw-canvas"
      tabindex="0"
      @pointerdown.prevent="onPointerDown"
      @pointerup.prevent="onPointerUp"
      @pointerleave="onPointerLeave"
      @pointermove="updateMouse"
    />
  </section>
</template>

<style scoped>
.draw-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  margin-top: 0;
}

.draw-canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  touch-action: none;
  cursor: crosshair;
  outline: none;
}
</style>
