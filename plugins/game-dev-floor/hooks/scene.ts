// GAME MODE · DEV FLOOR · the scene
//
// One pure function of the floor's state and the time: what each pixel is. Each piece
// shows a figure of the session:
//   window sky   context left (day → dusk → late → night)
//   LEAD desk    the main loop: typing while a turn runs, its screen the tool kind
//   other desks  subagents: walk in, work, CLEAR (green tick, walk out) or FAIL (slump)
//   red screen   a call that failed, for a moment; a hand and "!" waits for approval
//   beacon       a GAME MODE guard refused a call
//   cups         the session's cost, one per started dollar (up to five)
//   rack lights  plan usage left in the nearest window
//   lights out   no turn has run for a minute and nobody works
// The pixels fold two to a cell (▀: top pixel as glyph, bottom as ground) over all
// rows but the last, which carries the names under the desks.

import type { Floor, ToolKind, Worker } from '../types'
import { bubble, canvas, COLORS, dot, LEAD_LOOK, lookOf, rect, screen, seated, walking, zzz } from './art'
import type { Canvas, Look, Screen } from './art'

export { COLORS } from './art'

export const ROWS = 17
export const KEY = 'floor'
const HEIGHT = (ROWS - 1) * 2
const DESK_W = 14
const RACK_W = 10
const MIN_COLS = 44
const MAX_COLS = 100
export const MAX_DESKS = 6
const BEAT_MS = 160
const WALK_MS = 1200
export const CLEAR_HOLD_MS = 3000
export const FAIL_HOLD_MS = 20_000
const ERROR_MS = 1500
export const ALARM_MS = 4000
export const IDLE_MS = 60_000
export const STALE_MS = 15 * 60_000
const CUP_USD = 1
const MAX_CUPS = 5
const HALF = 0x2580
const DEFAULT_COLOR = 0x01000000

export function sceneWidth(bodyColumns: number): number {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(bodyColumns)))
}

export function deskCount(cols: number): number {
  return Math.max(2, Math.min(MAX_DESKS, Math.floor((cols - RACK_W) / DESK_W)))
}

const deskX = (slot: number): number => 1 + slot * DESK_W
const doorX = (width: number): number => width - RACK_W - 6

/** Where a desk's screen has its middle, in pixels. */
export function screenCenter(slot: number): { x: number; y: number } {
  return { x: deskX(slot) + 6, y: 14 }
}

export function skyOf(contextLeft: number | null): number {
  if (contextLeft === null || contextLeft > 60) return COLORS.skyDay
  if (contextLeft > 30) return COLORS.skyDusk
  if (contextLeft > 10) return COLORS.skyLate
  return COLORS.skyNight
}

export function kindOf(tool: string): ToolKind {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Bash|BashOutput|KillShell|PowerShell)$/.test(tool)) return 'bash'
  if (/^Web(Fetch|Search)$/.test(tool)) return 'web'
  if (/^(Agent|Task)$/.test(tool)) return 'agent'
  return 'other'
}

const GUARDS: readonly (readonly [RegExp, string])[] = [
  [/\bgame-trap-guard blocked this call:/, 'TRAP!'],
  [/\bgame-barrier blocked this call:/, 'BARRIER!'],
  [/\bgame-loop-breaker blocked this call:/, 'LOOP!'],
]

/** The verdict of a GAME MODE guard's refusal, from the text it starts with. */
export function guardOf(text: string): string | undefined {
  return GUARDS.find(([pattern]) => pattern.test(text))?.[1]
}

/** The guard verdicts among the tool results of a stored row. */
export function verdictsOf(content: readonly unknown[]): string[] {
  const out: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; content?: unknown }
    if (b.type !== 'tool_result') continue
    const verdict = guardOf(textOf(b.content))
    if (verdict !== undefined) out.push(verdict)
  }
  return out
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('\n')
}

/** A worker gone from the floor: it walked out after its CLEAR, or after slumping a while. */
export function isGone(w: Worker, now: number): boolean {
  // A worker that never said it ended (killed, or its end was missed) leaves once silent long.
  if (w.endedAt === null) return now - w.lastAt > STALE_MS
  return now - w.endedAt > (w.status === 'clear' ? CLEAR_HOLD_MS : FAIL_HOLD_MS) + WALK_MS
}

export function isAlarm(f: Floor, now: number): boolean {
  return f.alarm !== null && now - f.alarm.at < ALARM_MS
}

export function isAsleep(f: Floor, now: number): boolean {
  return !f.lead.isWorking && f.idleSince !== null && now - f.idleSince > IDLE_MS && f.workers.every(w => w.status !== 'active' || isGone(w, now))
}

export function pixels(f: Floor, now: number, cols: number): Canvas {
  const c = canvas(cols, HEIGHT, COLORS.wall)
  const beat = Math.floor(now / BEAT_MS)
  const desks = deskCount(cols)
  room(c, f, now, desks)
  desk(c, 0, beat, f.lead.isWorking ? (isAsleep(f, now) ? 'slump' : 'type') : isAsleep(f, now) ? 'slump' : 'still', leadScreen(f, now), LEAD_LOOK, f.asking === 'lead')
  if (isAsleep(f, now)) zzz(c, deskX(0))
  cups(c, f.usd)
  for (const w of f.workers) {
    const slot = w.desk
    if (slot === null || slot >= desks || isGone(w, now)) continue
    worker(c, w, slot, now, beat, f.asking === w.id)
  }
  if (isAsleep(f, now)) dim(c)
  return c

  function desk(cv: Canvas, slot: number, b: number, pose: 'type' | 'still' | 'hand' | 'slump' | 'empty', what: Screen, look: Look, isAsking: boolean): void {
    const x0 = deskX(slot)
    rect(cv, x0 + 3, 12, 8, 6, COLORS.frame)
    screen(cv, x0 + 4, 13, what, b)
    rect(cv, x0 + 6, 18, 2, 1, COLORS.frame)
    rect(cv, x0 + 1, 19, 12, 2, COLORS.desk)
    rect(cv, x0 + 1, 19, 12, 1, COLORS.deskEdge)
    rect(cv, x0 + 2, 21, 1, 7, COLORS.deskLeg)
    rect(cv, x0 + 11, 21, 1, 7, COLORS.deskLeg)
    if (pose === 'empty') {
      rect(cv, x0 + 3, 28, 8, 4, COLORS.chair)
      rect(cv, x0 + 3, 28, 8, 1, COLORS.chairEdge)
    } else {
      seated(cv, x0, look, isAsking ? 'hand' : pose, b)
      if (isAsking) bubble(cv, x0, b)
    }
  }

  function worker(cv: Canvas, w: Worker, slot: number, t: number, b: number, isAsking: boolean): void {
    const x0 = deskX(slot)
    const look = lookOf(w.name)
    const into = (t - (w.seatedAt ?? w.startedAt)) / WALK_MS
    const hold = w.status === 'clear' ? CLEAR_HOLD_MS : FAIL_HOLD_MS
    const out = w.endedAt === null ? 0 : (t - w.endedAt - hold) / WALK_MS
    const what: Screen = w.status === 'clear' ? 'clear' : w.status === 'fail' ? 'fail' : workerScreen(w, t)
    if (into < 1) {
      desk(cv, slot, b, 'empty', 'off', look, false)
      walking(cv, Math.round(lerp(doorX(cv.width), x0 + 4, into)), look, b)
    } else if (out > 0) {
      desk(cv, slot, b, 'empty', 'off', look, false)
      walking(cv, Math.round(lerp(x0 + 4, doorX(cv.width), out)), look, b)
    } else {
      const pose = w.status === 'fail' ? 'slump' : w.status === 'clear' ? 'still' : 'type'
      desk(cv, slot, b, pose, what, look, isAsking)
    }
  }
}

function leadScreen(f: Floor, now: number): Screen {
  if (f.lead.errorAt !== null && now - f.lead.errorAt < ERROR_MS) return 'error'
  if (isAsleep(f, now)) return 'off'
  if (!f.lead.isWorking) return f.idleSince === null && f.lead.kind === null ? 'off' : 'idle'
  return f.lead.kind ?? 'other'
}

function workerScreen(w: Worker, now: number): Screen {
  if (w.errorAt !== null && now - w.errorAt < ERROR_MS) return 'error'
  return w.kind ?? 'other'
}

/**
 * Seats working workers waiting with no desk at the desks others left, and moves a working
 * worker at a desk past the pane's edge (`desks` shown) to a desk the pane shows once one is
 * free. A worker given a desk walks in to it; the rest keep theirs.
 */
export function reseat(workers: readonly Worker[], now: number, desks = MAX_DESKS): Worker[] {
  const here = workers.filter(w => !isGone(w, now))
  return here.reduce<Worker[]>((seated, w) => {
    const desk = deskFor(seated, w, now, desks)
    return desk === null ? seated : seated.map(s => (s.id === w.id ? { ...s, desk, seatedAt: now } : s))
  }, here)
}

/** True when a working worker waits with no desk, or sits past the pane's edge, and a desk is free for it. */
export function canSeat(workers: readonly Worker[], now: number, desks = MAX_DESKS): boolean {
  return workers.some(w => !isGone(w, now) && deskFor(workers, w, now, desks) !== null)
}

/** The desk to give a worker now, or null to leave it where it is. */
function deskFor(workers: readonly Worker[], w: Worker, now: number, desks: number): number | null {
  if (w.status !== 'active') return null
  if (w.desk === null) return freeDesk(workers, now)
  return w.desk >= desks ? freeDesk(workers, now, desks) : null
}

/** The first desk past the LEAD, below `limit`, that no worker on the floor holds, or null when all are held. */
export function freeDesk(workers: readonly Worker[], now: number, limit = MAX_DESKS): number | null {
  const held = new Set(workers.filter(w => !isGone(w, now)).map(w => w.desk))
  for (let slot = 1; slot < Math.min(limit, MAX_DESKS); slot++) if (!held.has(slot)) return slot
  return null
}

function room(c: Canvas, f: Floor, now: number, desks: number): void {
  const w = c.width
  rect(c, 0, 18, w, HEIGHT - 18, COLORS.floor)
  for (let x = 0; x < w; x += 6) rect(c, x, 18, 1, HEIGHT - 18, COLORS.floorLine)
  rect(c, 0, 17, w, 1, COLORS.wallTrim)
  // The window: its sky is the context left.
  const right = Math.max(10, desks * DESK_W - 2)
  rect(c, 2, 2, right - 1, 9, COLORS.wallTrim)
  const sky = skyOf(f.contextLeft)
  rect(c, 3, 3, right - 3, 7, sky)
  if (sky === COLORS.skyNight) {
    for (let x = 6; x < right - 2; x += 9) dot(c, x, 4 + (x % 3), COLORS.star)
    rect(c, right - 7, 4, 2, 2, COLORS.moon)
  } else {
    rect(c, right - 7, 4, 3, 2, sky === COLORS.skyDay ? COLORS.sun : 0xffd27a)
  }
  for (let x = 3 + 12; x < right - 1; x += 12) rect(c, x, 3, 1, 7, COLORS.wallTrim)
  // The beacon: a guard refused a call.
  const lit = isAlarm(f, now) && Math.floor(now / 250) % 2 === 0
  rect(c, Math.floor(w / 2) - 1, 0, 3, 2, lit ? COLORS.beaconOn : COLORS.beaconOff)
  rack(c, f.rackLeft, f.lead.isWorking, Math.floor(now / BEAT_MS))
}

function rack(c: Canvas, left: number | null, isBusy: boolean, beat: number): void {
  const x = c.width - RACK_W + 2
  rect(c, x, 4, 7, 24, COLORS.rack)
  const lit = left === null ? 5 : Math.ceil(Math.max(0, Math.min(100, left)) / 20)
  for (let k = 0; k < 5; k++) {
    const y = 6 + k * 4
    rect(c, x + 1, y, 5, 3, COLORS.rackSlot)
    const isOn = 4 - k < lit
    const color = !isOn ? COLORS.ledOff : left !== null && left <= 20 ? COLORS.ledLow : COLORS.ledOn
    // A busy main loop blinks the lit lights; a quiet one leaves them steady.
    rect(c, x + 4, y + 1, 1, 1, isOn && isBusy && (beat + k) % 3 === 0 ? COLORS.ledOff : color)
  }
}

function cups(c: Canvas, usd: number | null): void {
  if (usd === null || usd <= 0) return
  const n = Math.min(MAX_CUPS, Math.floor(usd / CUP_USD) + 1)
  const x0 = deskX(0)
  for (const x of [x0 + 11, x0 + 12, x0 + 1, x0 + 2, x0].slice(0, n)) {
    dot(c, x, 17, COLORS.coffee)
    dot(c, x, 18, COLORS.cup)
  }
}

function dim(c: Canvas): void {
  for (let i = 0; i < c.px.length; i++) {
    const v = c.px[i] ?? 0
    c.px[i] = (((v >> 16) & 0xff) >> 1 << 16) | (((v >> 8) & 0xff) >> 1 << 8) | ((v & 0xff) >> 1)
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t))

/** Two pixel rows to one row of ▀ cells: `[glyph, top, bottom]` per cell. */
export function fold(px: Uint32Array, width: number, height: number): Uint32Array {
  const out = new Uint32Array(width * Math.ceil(height / 2) * 3)
  let n = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      out[n++] = HALF
      out[n++] = px[y * width + x] ?? 0
      out[n++] = y + 1 < height ? (px[(y + 1) * width + x] ?? 0) : DEFAULT_COLOR
    }
  }
  return out
}

export type LabelColors = { lead: number; active: number; clear: number; fail: number; dim: number }

/** The names under the desks: ASCII only, a cell holding one width-1 character. */
export function labels(f: Floor, now: number, cols: number, tone: LabelColors): Uint32Array {
  const out = new Uint32Array(cols * 3)
  for (let x = 0; x < cols; x++) out.set([0x20, tone.dim, COLORS.floor], x * 3)
  const put = (x: number, text: string, color: number) => {
    for (let i = 0; i < text.length && x + i < cols; i++) out.set([text.charCodeAt(i), color, COLORS.floor], (x + i) * 3)
  }
  const desks = deskCount(cols)
  const leadText = f.asking === 'lead' ? 'LEAD WAIT' : f.lead.isWorking && f.lead.tool !== null ? `LEAD ${f.lead.tool}` : 'LEAD'
  put(deskX(0), ascii(leadText, DESK_W - 1), tone.lead)
  let hidden = 0
  for (const w of f.workers) {
    if (isGone(w, now)) continue
    const slot = w.desk
    if (slot === null || slot >= desks) {
      hidden++
      continue
    }
    const color = w.status === 'clear' ? tone.clear : w.status === 'fail' ? tone.fail : tone.active
    // The name is cut, never the status after it.
    const suffix = w.status === 'active' ? '' : w.status === 'clear' ? ' OK' : ' X'
    put(deskX(slot), ascii(w.name, DESK_W - 1 - suffix.length) + suffix, color)
  }
  const tail = hidden > 0 ? `+${hidden}` : 'RACK'
  put(cols - RACK_W + 2, tail, hidden > 0 ? tone.active : tone.dim)
  return out
}

function ascii(text: string, max: number): string {
  const clean = text.replace(/[^\x20-\x7e]/g, '?')
  return clean.length > max ? clean.slice(0, max - 1) + '~' : clean
}

/** The Raster's `cells`: the folded picture, then the name row. */
export function cellsOf(f: Floor, now: number, cols: number, tone: LabelColors): string {
  const pic = pixels(f, now, cols)
  const words = new Uint32Array(cols * ROWS * 3)
  words.set(fold(pic.px, pic.width, pic.height), 0)
  words.set(labels(f, now, cols, tone), cols * (ROWS - 1) * 3)
  return toBase64(words)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((w, i) => view.setUint32(i * 4, w, true))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(triple >> 18) & 63]
    out += B64[(triple >> 12) & 63]
    out += b === undefined ? '=' : B64[(triple >> 6) & 63]
    out += c === undefined ? '=' : B64[triple & 63]
  }
  return out
}

/** The u32 words a `cells` string holds (for tests and the text fallback). */
export function decodeCells(text: string): Uint32Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let n = 0
  for (const ch of clean) {
    value = ((value << 6) | B64.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[n++] = (value >> bits) & 0xff
    }
  }
  const view = new DataView(bytes.buffer)
  const words = new Uint32Array(Math.floor(n / 4))
  for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true)
  return words
}

/** The text of the name row of a `cells` string. */
export function labelRow(text: string, cols: number): string {
  const words = decodeCells(text)
  const start = cols * (ROWS - 1) * 3
  let out = ''
  for (let x = 0; x < cols; x++) out += String.fromCharCode(words[start + x * 3] ?? 0x20)
  return out
}
