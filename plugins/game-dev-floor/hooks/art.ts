// GAME MODE · DEV FLOOR · the pixels
//
// A canvas of 0xRRGGBB pixels and the few shapes the floor is made of. Every shape
// stands for a figure of the session (see scene.ts); none is drawn for its own sake.

import type { ToolKind } from '../types'

export const COLORS = {
  wall: 0x262b45,
  wallTrim: 0x3b4170,
  floor: 0x3a2e2a,
  floorLine: 0x47372f,
  desk: 0x8a5a2b,
  deskEdge: 0xb07a3c,
  deskLeg: 0x4a3018,
  frame: 0x15151a,
  chair: 0x23262f,
  chairEdge: 0x343846,
  skin: 0xf1c27d,
  skyDay: 0x6ec6ff,
  skyDusk: 0xff9e5e,
  skyLate: 0x6a4c93,
  skyNight: 0x0b1030,
  sun: 0xfff1a8,
  moon: 0xe8e8f0,
  star: 0xb8b8f0,
  rack: 0x1c1c22,
  rackSlot: 0x2c2c36,
  ledOn: 0x58d854,
  ledLow: 0xf83800,
  ledOff: 0x203020,
  beaconOff: 0x3a3a44,
  beaconOn: 0xf83800,
  error: 0xf83800,
  errorDark: 0x7a1c00,
  bubble: 0xf8d830,
  cup: 0xf0f0f0,
  coffee: 0x6b3e1f,
  zzz: 0xfcfcfc,
  screenOff: 0x0a0a0a,
  screenIdle: 0x101826,
} as const

const HAIR = [0x3b2a1a, 0xd9a441, 0x1e1e1e, 0x8b3a3a, 0x5a3d8a, 0xd8d8d8] as const
const SHIRT = [0x3cbcfc, 0x58d854, 0xb8b8f0, 0xf878f8, 0x00a8a8, 0xfca044] as const
/** The LEAD's shirt: the one desk that is always the main loop. */
export const LEAD_LOOK: Look = { hair: 0x2a1c12, shirt: 0xe07a50 }

export type Look = { hair: number; shirt: number }

export type Canvas = { width: number; height: number; px: Uint32Array }

export function canvas(width: number, height: number, fill: number): Canvas {
  return { width, height, px: new Uint32Array(width * height).fill(fill) }
}

export function rect(c: Canvas, x: number, y: number, w: number, h: number, color: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(c.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(c.width, x + w); xx++) c.px[yy * c.width + xx] = color
  }
}

export function dot(c: Canvas, x: number, y: number, color: number): void {
  rect(c, x, y, 1, 1, color)
}

/** A worker's look, the same for the same name every time. */
export function lookOf(name: string): Look {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return { hair: HAIR[h % HAIR.length] ?? HAIR[0], shirt: SHIRT[(h >>> 3) % SHIRT.length] ?? SHIRT[0] }
}

/** Seen from behind at the desk: head, shoulders, the chair's back over the lower body. */
export function seated(c: Canvas, x0: number, look: Look, pose: 'type' | 'still' | 'hand' | 'slump', beat: number): void {
  const headY = pose === 'slump' ? 19 : 21
  rect(c, x0 + 4, headY + 4, 6, 5, look.shirt)
  rect(c, x0 + 5, headY, 4, 4, look.hair)
  if (pose !== 'slump') {
    dot(c, x0 + 4, headY + 2, COLORS.skin)
    dot(c, x0 + 9, headY + 2, COLORS.skin)
  }
  rect(c, x0 + 3, 28, 8, 4, COLORS.chair)
  rect(c, x0 + 3, 28, 8, 1, COLORS.chairEdge)
  if (pose === 'type') {
    dot(c, x0 + 4, 20, beat % 2 === 0 ? COLORS.skin : COLORS.deskEdge)
    dot(c, x0 + 9, 20, beat % 2 === 0 ? COLORS.deskEdge : COLORS.skin)
  } else if (pose === 'hand') {
    rect(c, x0 + 10, 17, 1, 8, look.shirt)
    dot(c, x0 + 10, 16, COLORS.skin)
  }
}

/** Walking across the floor, front-on, legs swinging. */
export function walking(c: Canvas, x: number, look: Look, beat: number): void {
  rect(c, x + 1, 18, 4, 4, COLORS.skin)
  rect(c, x + 1, 18, 4, 1, look.hair)
  rect(c, x, 22, 6, 6, look.shirt)
  const swing = beat % 2
  rect(c, x + 1 + swing, 28, 1, 4, COLORS.chair)
  rect(c, x + 4 - swing, 28, 1, 4, COLORS.chair)
}

/** The "!" over a developer who waits for the person's approval. */
export function bubble(c: Canvas, x0: number, beat: number): void {
  const color = beat % 2 === 0 ? COLORS.bubble : COLORS.deskEdge
  rect(c, x0 + 12, 12, 1, 2, color)
  dot(c, x0 + 12, 15, color)
}

export function zzz(c: Canvas, x0: number): void {
  for (const [x, y] of [[10, 13], [11, 13], [11, 14], [10, 15], [11, 15]] as const) dot(c, x0 + x, y, COLORS.zzz)
}

export type Screen = ToolKind | 'off' | 'idle' | 'clear' | 'fail' | 'error'

/** A desk's 6×4 screen at (x, y), drawing what its developer is doing. */
export function screen(c: Canvas, x: number, y: number, what: Screen, beat: number): void {
  const fill = (color: number) => rect(c, x, y, 6, 4, color)
  const line = (row: number, width: number, color: number) => rect(c, x, y + row, Math.max(0, Math.min(6, width)), 1, color)
  switch (what) {
    case 'off':
      return fill(COLORS.screenOff)
    case 'idle':
      fill(COLORS.screenIdle)
      return line(1, 3, 0x1c2a44)
    case 'error':
      return fill(beat % 2 === 0 ? COLORS.error : COLORS.errorDark)
    case 'fail':
      fill(COLORS.errorDark)
      for (const [dx, dy] of [[1, 0], [4, 0], [2, 1], [3, 1], [2, 2], [3, 2], [1, 3], [4, 3]] as const) dot(c, x + dx, y + dy, COLORS.error)
      return
    case 'clear':
      fill(0x0d2b14)
      for (const [dx, dy] of [[1, 2], [2, 3], [3, 2], [4, 1], [5, 0]] as const) dot(c, x + dx, y + dy, COLORS.ledOn)
      return
    case 'read':
      fill(0x1e3a8a)
      for (let r = 0; r < 4; r++) line(r, [5, 3, 4, 2][(r + beat) % 4] ?? 3, 0x8fd3ff)
      return
    case 'edit':
      fill(0x0d2b14)
      for (let r = 0; r < 4; r++) {
        line(r, (beat + r * 2) % 7, COLORS.ledOn)
        dot(c, x, y + r, 0xb8f8b0)
      }
      return
    case 'bash':
      fill(0x050505)
      for (let r = 0; r < 3; r++) line(r, [3, 4, 2][r] ?? 2, 0x606060)
      dot(c, x, y + 3, COLORS.ledOn)
      if (beat % 2 === 0) dot(c, x + 2, y + 3, 0xfcfcfc)
      return
    case 'web':
      fill(0x0b2447)
      for (const [dx, dy] of [[1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [5, 1], [0, 2], [5, 2], [1, 3], [2, 3], [3, 3], [4, 3]] as const) {
        dot(c, x + dx, y + dy, 0x3cbcfc)
      }
      rect(c, x + 1 + (beat % 4), y + 1, 1, 2, 0xa8e4fc)
      return
    case 'agent':
      fill(0x2b1446)
      rect(c, x + 2, y + 1, 2, 2, COLORS.bubble)
      dot(c, x + [0, 5, 5, 0][beat % 4]!, y + [0, 0, 3, 3][beat % 4]!, COLORS.bubble)
      return
    case 'other':
      fill(0x222831)
      for (let i = 0; i < 3; i++) dot(c, x + 1 + i * 2, y + 2, i === beat % 3 ? 0xfcfcfc : 0x505868)
      return
  }
}
