import { CANVAS_CHANNEL } from './const'

export type WeaponId = 1 | 2

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
  /** asteroids: [id,x,y,vx,vy,r,hp,maxHp,model][] */
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

export type ShipXpState = {
  acc: number
  tier: number
  pending: boolean
  artB: number
  rocB: number
}

export function isGamePayload(p: unknown): p is Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  return o.channel === CANVAS_CHANNEL
}
