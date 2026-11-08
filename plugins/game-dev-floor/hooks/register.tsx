import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Floor, Worker } from '../types'
import { clock, intensityOf, paletteOf } from './palette'
import type { Palette } from './palette'
import { cellsOf, guardOf, isAlarm, isGone, KEY, kindOf, reseat, ROWS, sceneWidth, verdictsOf } from './scene'
import type { LabelColors } from './scene'

// GAME MODE · DEV FLOOR
//
// /devfloor opens a pane with the session drawn as a pixel-art dev office (see scene.ts
// for what each piece shows). The picture is one Raster; while something on the floor
// moves, a timer repaints it in place with $.ui.blit, and a still floor is not repainted.
// Under it, a caption says the same in words.

const PANE = 'devfloor'
const TITLE = 'DEV FLOOR'
const MAX_WORKERS = 20
const MAX_ALARM_IDS = 50
/** Denied blits in a row before the pane counts as closed (one can race a resize or the mount). */
const MAX_DENIES = 3
/** How often a still floor is blitted anyway, to learn whether the pane is still there. */
const PROBE_MS = 2000

const START: Floor = {
  lead: { isWorking: false, kind: null, tool: null, errorAt: null },
  workers: [],
  alarm: null,
  asking: null,
  contextLeft: null,
  usd: null,
  rackLeft: null,
  idleSince: null,
}
const floor = atom({ plugin: 'game-dev-floor', key: 'floor' } as const, START)

// What the timer needs between frames. Module variables, not $.state: a drawing may not
// write $.state, and these only say what is mounted now. One module serves one session.
type Frame = {
  mounted: { cols: number } | null
  lastCells: string
  lastBlitAt: number
  lastWords: string
  denies: number
  isTicking: boolean
  timer: { cancel: () => void } | null
  frameMs: number
  isHardcore: boolean
  tone: LabelColors
}
const frame: Frame = {
  mounted: null,
  lastCells: '',
  lastBlitAt: 0,
  lastWords: '',
  denies: 0,
  isTicking: false,
  timer: null,
  frameMs: 83,
  isHardcore: false,
  tone: toneOf(paletteOf('nes')),
}

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const autoOpen = options.autoOpen !== false
  frame.frameMs = Math.round(1000 / Math.max(4, Math.min(30, Number(options.fps ?? 12) || 12)))
  frame.isHardcore = intensity === 'hardcore'
  frame.tone = toneOf(pal)
  // A reload runs register again: the old module's timer is gone with it.
  frame.timer = null
  let hasOpened = false
  if (intensity === 'off') return

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'devfloor', description: 'GAME MODE dev floor: this session as a pixel-art dev office' })
    startTimer($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    startTimer($)
    await update($, floor, f => ({ ...f, lead: { ...f.lead, isWorking: true }, idleSince: null }))
    if (autoOpen && !hasOpened) {
      hasOpened = true
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const agentId = e.agentId
    if (agentId === undefined) {
      await update($, floor, f => ({ ...f, lead: { ...f.lead, isWorking: false }, asking: null, idleSince: now }))
    } else {
      const status: Worker['status'] = e.reason === 'answer' ? 'clear' : 'fail'
      await update($, floor, f => ({
        ...f,
        asking: f.asking === agentId ? null : f.asking,
        workers: f.workers.map(w => (w.id === agentId && w.status === 'active' ? { ...w, status, endedAt: now, lastAt: now } : w)),
      }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const agentId = started.agentId
    if (agentId === undefined) return started
    const now = await $.clock.now()
    const name = e.name ?? e.subagentType
    await update($, floor, f => {
      if (f.workers.some(w => w.id === agentId)) return f
      return { ...f, workers: reseat([...f.workers, newWorker(agentId, name, e.tool_use_id, now)], now).slice(-MAX_WORKERS) }
    })
    startTimer($)
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const actor = e.agentId ?? 'lead'
    const started = await $.clock.now()
    await update($, floor, f => withActor(f, actor, { kind: kindOf(tool), tool }, started))
    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    const now = await $.clock.now()
    const verdict = ran.deny === undefined ? undefined : guardOf(ran.deny)
    await update($, floor, f => {
      let nf: Floor = { ...f, asking: f.asking === actor ? null : f.asking }
      if (failed) nf = withActor(nf, actor, { errorAt: now }, now)
      if (verdict !== undefined) nf = withAlarm(nf, e.tool_use_id, verdict, now)
      // The call that started a worker failed: the worker failed with it.
      if (tool === 'Agent' && failed) {
        nf = { ...nf, workers: nf.workers.map(w => (w.toolUseId === e.tool_use_id && w.status === 'active' ? { ...w, status: 'fail', endedAt: now } : w)) }
      }
      return nf
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      const who = e.agentId ?? 'lead'
      await update($, floor, f => ({ ...f, asking: who }))
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // A refusal by a guard above this plugin never reaches its tool.call hook: the stored
  // result says it, whichever plugin refused.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door !== 'tool-result') return stored
    const now = await $.clock.now()
    const content = e.message.content
    await update($, floor, f => {
      let nf = f
      for (const r of refusalsOf(content)) nf = withAlarm(nf, r.id, r.verdict, now)
      if (e.agentId === undefined && hasError(content)) nf = withActor(nf, 'lead', { errorAt: now }, now)
      return nf
    })
    return stored
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const nearest = e.rateLimits.find(r => r.kind === 'five_hour') ?? e.rateLimits[0]
    await update($, floor, f => ({
      ...f,
      contextLeft: typeof e.context.percent === 'number' ? Math.max(0, 100 - e.context.percent) : f.contextLeft,
      usd: e.cost?.usd ?? f.usd,
      rackLeft: nearest === undefined ? f.rackLeft : Math.max(0, Math.round(100 - nearest.percentUsed)),
    }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'devfloor' }, async ($) => {
    startTimer($)
    await $.ui.open({ id: PANE, title: TITLE })
    const f = await read($, floor)
    return { text: [captionOf(f, await $.clock.now()), ...rosterOf(f, await $.clock.now(), false)].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const f = await read($, floor)
    const now = await $.clock.now()
    const caption = captionOf(f, now)
    const notice = noticeOf(f, now)
    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text color={pal.title} bold>
            {caption}
          </Text>
          {notice !== null && <Text color={pal.warn}>{notice}</Text>}
          {rosterOf(f, now, intensity === 'hardcore').map(line => (
            <Text color={pal.text}>{line}</Text>
          ))}
        </Box>
      )
    }
    const { Box, Text, Raster } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const cols = sceneWidth(e.props.bodyColumns)
    const cells = cellsOf(f, now, cols, frame.tone)
    frame.mounted = { cols }
    frame.lastCells = cells
    frame.lastBlitAt = now
    frame.lastWords = wordsOf(f, now, frame.isHardcore)
    frame.denies = 0
    return (
      <Box flexDirection="column">
        <Raster key={KEY} columns={cols} rows={ROWS} cells={cells} />
        <Text color={pal.title} wrap="truncate-end">
          {caption}
        </Text>
        {notice !== null && <Text color={isAlarm(f, now) ? pal.bad : pal.warn}>{notice}</Text>}
        {intensity === 'hardcore' &&
          rosterOf(f, now, true).map(line => (
            <Text color={pal.dim} wrap="truncate-end">
              {line}
            </Text>
          ))}
      </Box>
    )
  })
}

/** Starts the frame timer once; events call it, so a reload or a reopened pane restarts it. */
function startTimer($: EngineInterface): void {
  if (frame.timer !== null) return
  frame.timer = $.clock.every(frame.frameMs, () => {
    void tick($).catch(() => undefined)
  })
}

function stopTimer(): void {
  frame.timer?.cancel()
  frame.timer = null
  frame.mounted = null
}

/**
 * One frame: repaint the mounted floor in place when its picture changed, redraw the pane
 * when its words did (a worker walked out, an alarm ended), and now and then blit a still
 * floor to learn whether the pane is still open; a closed pane stops the timer.
 */
async function tick($: EngineInterface): Promise<void> {
  if (frame.mounted === null || frame.isTicking) return
  frame.isTicking = true
  try {
    const cols = frame.mounted.cols
    const f = await read($, floor)
    const now = await $.clock.now()
    const words = wordsOf(f, now, frame.isHardcore)
    if (words !== frame.lastWords) {
      frame.lastWords = words
      $.ui.invalidate('ui.render')
    }
    const cells = cellsOf(f, now, cols, frame.tone)
    if (cells === frame.lastCells && now - frame.lastBlitAt < PROBE_MS) return
    // A refusal may come back as { deny } or as a rejection: both say the frame was not shown.
    const isShown = await $.ui
      .blit({ requestId: PANE, key: KEY, cells, columns: cols, rows: ROWS })
      .then(shown => shown.deny === undefined)
      .catch(() => false)
    // A resize drew the pane again meanwhile: this frame was for the old size.
    if (frame.mounted?.cols !== cols) return
    if (!isShown) {
      frame.lastCells = ''
      frame.denies++
      if (frame.denies >= MAX_DENIES) stopTimer()
      return
    }
    frame.lastCells = cells
    frame.lastBlitAt = now
    frame.denies = 0
  } finally {
    frame.isTicking = false
  }
}

/** The pane's words, to tell when the caption under the picture is out of date. */
function wordsOf(f: Floor, now: number, isHardcore: boolean): string {
  return [captionOf(f, now), noticeOf(f, now) ?? '', ...(isHardcore ? rosterOf(f, now, true) : [])].join('\n')
}

function newWorker(id: string, name: string, toolUseId: string, now: number): Worker {
  return { id, toolUseId, name, status: 'active', desk: null, kind: null, tool: null, errorAt: null, startedAt: now, endedAt: null, lastAt: now }
}

type ActorPatch = Partial<Pick<Worker, 'kind' | 'tool' | 'errorAt'>>

/**
 * Marks what the LEAD or a worker does. A call from an agent the floor never saw start is
 * left out: the engine runs loops of its own (tool search, wakeups) that no Agent call
 * started, and they are nobody at a desk.
 */
function withActor(f: Floor, actor: string, patch: ActorPatch, now: number): Floor {
  if (actor === 'lead') return { ...f, lead: { ...f.lead, ...patch } }
  return { ...f, workers: f.workers.map(w => (w.id === actor ? { ...w, ...patch, lastAt: now } : w)) }
}

/** Counts a guard refusal once per call: the ids counted live in the state, so a retried write sees them. */
function withAlarm(f: Floor, toolUseId: string, verdict: string, now: number): Floor {
  const ids = f.alarm?.ids ?? []
  if (ids.includes(toolUseId)) return f
  return { ...f, alarm: { verdict, at: now, count: (f.alarm?.count ?? 0) + 1, ids: [...ids, toolUseId].slice(-MAX_ALARM_IDS) } }
}

function refusalsOf(content: readonly unknown[]): { id: string; verdict: string }[] {
  const out: { id: string; verdict: string }[] = []
  for (const block of content) {
    const verdict = verdictsOf([block])[0]
    const id = (block as { tool_use_id?: unknown }).tool_use_id
    if (verdict !== undefined && typeof id === 'string') out.push({ id, verdict })
  }
  return out
}

function hasError(content: readonly unknown[]): boolean {
  return content.some(b => b !== null && typeof b === 'object' && (b as { type?: unknown; is_error?: unknown }).type === 'tool_result' && (b as { is_error?: unknown }).is_error === true)
}

/** The first caption line: the figures the picture draws, in words. */
export function captionOf(f: Floor, now: number): string {
  const here = f.workers.filter(w => !isGone(w, now))
  const parts = [`${TITLE} · 동료 ${here.length}명`]
  if (f.contextLeft !== null) parts.push(`컨텍스트 ${f.contextLeft}%`)
  if (f.usd !== null) parts.push(`$${f.usd.toFixed(2)}`)
  if (f.rackLeft !== null) parts.push(`요금제 ${f.rackLeft}% 남음`)
  return parts.join(' · ')
}

/** The second line, when something wants the person: a guard refused, or a call waits for them. */
function noticeOf(f: Floor, now: number): string | null {
  if (f.asking !== null) {
    const who = f.asking === 'lead' ? 'LEAD' : (f.workers.find(w => w.id === f.asking)?.name ?? '동료')
    return `${who} 손 듦 · 승인을 기다립니다`
  }
  if (f.alarm !== null) return `${f.alarm.verdict} 가드가 막은 호출 ${f.alarm.count}건${isAlarm(f, now) ? ' · 경광등' : ''}`
  return null
}

function rosterOf(f: Floor, now: number, isHardcore: boolean): string[] {
  const lead = `LEAD · ${f.lead.isWorking ? (f.lead.tool ?? '생각 중') : '대기'}`
  return [
    lead,
    ...f.workers
      .filter(w => !isGone(w, now))
      .map(w => {
        const state = w.status === 'active' ? (w.tool ?? '입장') : w.status === 'clear' ? 'CLEAR' : 'FAIL'
        const ran = isHardcore ? ` · ${clock((w.endedAt ?? now) - w.startedAt)}` : ''
        return `◆ ${w.name} · ${state}${ran}`
      }),
  ]
}

function toneOf(pal: Palette): LabelColors {
  const hex = (value: string, fallback: number) => (/^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : fallback)
  return {
    lead: hex(pal.title, 0xf8d830),
    active: hex(pal.info, 0x3cbcfc),
    clear: hex(pal.ok, 0x58d854),
    fail: hex(pal.bad, 0xf83800),
    dim: hex(pal.dim, 0xb8b8f0),
  }
}
