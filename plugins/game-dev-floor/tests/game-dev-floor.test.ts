import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import type { Floor } from '../types'
import { CLEAR_HOLD_MS, COLORS, decodeCells, fold, guardOf, kindOf, labelRow, pixels, ROWS, sceneWidth, screenCenter, skyOf, verdictsOf } from '../hooks/scene'

const T0 = 1_700_000_000_000

// One plain signature for raising a call: checking an object `as never` against every tool's
// overload is too deep for tsc (TS2589).
type AnyToolCall = (input: Record<string, unknown>) => Promise<unknown>

const EMPTY: Floor = {
  lead: { isWorking: false, kind: null, tool: null, errorAt: null },
  workers: [],
  alarm: null,
  asking: null,
  contextLeft: null,
  usd: null,
  rackLeft: null,
  idleSince: null,
}

// ── the picture, as pure functions ──────────────────────────────────────────

test('fold packs two pixel rows into one half-block cell: top is the glyph, bottom the ground', () => {
  const px = Uint32Array.of(0x111111, 0x222222, 0x333333, 0x444444)
  expect(Array.from(fold(px, 2, 2))).toEqual([0x2580, 0x111111, 0x333333, 0x2580, 0x222222, 0x444444])
})

test('the sky is day with context to spare and night when it runs out', () => {
  expect(skyOf(90)).toBe(COLORS.skyDay)
  expect(skyOf(null)).toBe(COLORS.skyDay)
  expect(skyOf(45)).toBe(COLORS.skyDusk)
  expect(skyOf(5)).toBe(COLORS.skyNight)
})

test('a failed call turns that desk screen red; a clean one keeps its tool color', () => {
  const cols = sceneWidth(80)
  const at = screenCenter(0)
  const failed = pixels({ ...EMPTY, lead: { isWorking: true, kind: 'edit', tool: 'Edit', errorAt: T0 - 200 } }, T0, cols)
  expect(failed.px[at.y * failed.width + at.x]).toBe(COLORS.error)
  const later = pixels({ ...EMPTY, lead: { isWorking: true, kind: 'edit', tool: 'Edit', errorAt: T0 - 60_000 } }, T0, cols)
  expect(later.px[at.y * later.width + at.x]).not.toBe(COLORS.error)
})

test('tools sort into the kinds a screen can show', () => {
  expect(kindOf('Read')).toBe('read')
  expect(kindOf('Grep')).toBe('read')
  expect(kindOf('Edit')).toBe('edit')
  expect(kindOf('Bash')).toBe('bash')
  expect(kindOf('WebFetch')).toBe('web')
  expect(kindOf('Agent')).toBe('agent')
  expect(kindOf('mcp__x__y')).toBe('other')
})

test('a guard refusal is read from its fixed opening, in any tool_result shape', () => {
  expect(guardOf('game-barrier blocked this call: force-push to main')).toBe('BARRIER!')
  expect(guardOf('Exit code 1')).toBeUndefined()
  expect(
    verdictsOf([
      { type: 'tool_result', tool_use_id: 'a', content: 'game-trap-guard blocked this call: cat .env' },
      { type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: 'game-loop-breaker blocked this call: same call ×4' }] },
      { type: 'text', text: 'game-barrier blocked this call: not a result' },
    ]),
  ).toEqual(['TRAP!', 'LOOP!'])
})

test('the scene fits the pane: never wider than its body, never narrower than two desks', () => {
  expect(sceneWidth(200)).toBe(100)
  expect(sceneWidth(70)).toBe(70)
  expect(sceneWidth(20)).toBe(44)
})

// ── the floor, from the session's events ───────────────────────────────────

function world(on: On) {
  const clock = mock.clock(on, { now: T0 })
  const opened: string[] = []
  const blits: string[] = []
  let n = 0
  let refuse: string | null = null
  let blitDeny: string | null = null
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', (_, e) => {
    if (blitDeny !== null) return { deny: blitDeny }
    if ('cells' in e) blits.push(e.cells)
    return { value: {} }
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `agent-${++n}` }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => {
    if (refuse !== null) {
      const deny = refuse
      refuse = null
      return { deny }
    }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { clock, opened, blits, refuseNext: (text: string) => (refuse = text), denyBlits: (reason: string | null) => (blitDeny = reason) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function spawn(toolUseId: string, subagentType: string, name?: string) {
  return {
    tool_use_id: toolUseId,
    prompt: 'go',
    description: 'job',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...(name ? { name } : {}),
  }
}

async function floorView($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({
    plugin: 'game-dev-floor',
    surface,
    component: 'Pane',
    requestId: 'devfloor',
    props: { title: 'DEV FLOOR', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const raster = await ui.find({ type: 'Raster' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  const cells = raster === undefined ? null : String(raster.props.cells)
  const columns = raster === undefined ? 0 : Number(raster.props.columns)
  return { cells, columns, rows: raster === undefined ? 0 : Number(raster.props.rows), texts }
}

test('subagents take desks: their names sit under them and the caption counts them', async ($, on) => {
  world(on)
  await start($)
  await $.agent.spawn(spawn('toolu_a', 'Explore'))
  await $.agent.spawn(spawn('toolu_b', 'general-purpose', 'reviewer'))
  const view = await floorView($)
  expect(view.rows).toBe(ROWS)
  expect(view.columns).toBe(80)
  const names = labelRow(view.cells ?? '', view.columns)
  expect(names).toContain('LEAD')
  expect(names).toContain('Explore')
  expect(names).toContain('reviewer')
  expect(view.texts.join(' ')).toContain('동료 2명')
})

test('a guard refusal sets off the beacon and names the verdict', async ($, on) => {
  const { refuseNext } = world(on)
  await start($)
  refuseNext('game-barrier blocked this call: git push --force to main')
  await ($.tool.call as unknown as AnyToolCall)({ tool: 'Bash', command: 'git push -f origin main', tool_use_id: 'toolu_x' })
  const view = await floorView($)
  expect(view.texts.join(' ')).toContain('BARRIER!')
})

test('the first prompt opens the floor; /devfloor opens it and says what it shows', async ($, on) => {
  const { opened } = world(on)
  await start($)
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as never)
  expect(opened).toEqual(['devfloor'])
  const ran = await $.command.run({ command: 'devfloor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(ran.text).toContain('DEV FLOOR')
  expect(opened).toEqual(['devfloor', 'devfloor'])
})

test('measures move the window, the cups and the rack', async ($, on) => {
  world(on)
  await start($)
  await $.session.measure({
    context: { percent: 92 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 70 }],
    cost: { usd: 2.4 },
    changed: [],
  } as never)
  const view = await floorView($)
  const caption = view.texts.join(' ')
  expect(caption).toContain('컨텍스트 8%')
  expect(caption).toContain('$2.40')
  expect(caption).toContain('30%')
})

test('a surface without Raster draws the floor as text', async ($, on) => {
  world(on)
  await start($)
  await $.agent.spawn(spawn('toolu_a', 'Explore'))
  const view = await floorView($, 'desktop')
  expect(view.cells).toBeNull()
  expect(view.texts.join(' ')).toContain('Explore')
})

test('off draws nothing', { options: { intensity: 'off' } }, async ($, on) => {
  const { opened } = world(on)
  await start($)
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as never)
  expect(opened).toEqual([])
  const view = await floorView($)
  expect(view.cells).toBeNull()
})

test('while the pane is drawn, a walking worker is repainted by blit; a still floor only by a rare probe', async ($, on) => {
  const { clock, blits } = world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-dev-floor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'devfloor',
    props: { title: 'DEV FLOOR', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  await $.agent.spawn(spawn('toolu_a', 'Explore'))
  await clock.advance(400)
  expect(blits.length).toBeGreaterThan(0)
  // It hands its report back, shows CLEAR, walks out: then nothing moves.
  await $.turn.complete({ answer: 'ok', durationMs: 400, isAborted: false, turnId: 't', reason: 'answer', agentId: 'agent-1' })
  await clock.advance(6_000)
  const settled = blits.length
  const still = blits[settled - 1]
  await clock.advance(1_000)
  // At most the one probe a still floor gets every two seconds, and it repaints the same picture.
  expect(blits.length - settled).toBeLessThanOrEqual(1)
  for (const cells of blits.slice(settled)) expect(cells).toBe(still)
  expect(decodeCells(blits[blits.length - 1] ?? '').length).toBe(80 * ROWS * 3)
  await ui.unmount()
})

test('one denied blit does not stop the floor; three in a row stop it until it is drawn again', async ($, on) => {
  const { clock, blits, denyBlits } = world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-dev-floor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'devfloor',
    props: { title: 'DEV FLOOR', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  await $.agent.spawn(spawn('toolu_a', 'Explore'))
  denyBlits('not mounted')
  await clock.advance(100)
  denyBlits(null)
  await clock.advance(200)
  expect(blits.length).toBeGreaterThan(0)
  denyBlits('not mounted')
  await clock.advance(1_000)
  denyBlits(null)
  const stopped = blits.length
  await clock.advance(1_000)
  expect(blits.length).toBe(stopped)
  await ui.unmount()
})

test('calls from an agent the floor never saw start seat nobody', async ($, on) => {
  world(on)
  await start($)
  // Engine loops no Agent call started (tool search, wakeups) carry an agentId too.
  await ($.tool.call as unknown as AnyToolCall)({ tool: 'ToolSearch', query: 'x', agentId: 'agent-loop', tool_use_id: 'toolu_s' })
  const view = await floorView($)
  expect(labelRow(view.cells ?? '', 80).split(/\s+/).filter(Boolean)).toEqual(['LEAD', 'RACK'])
  expect(view.texts.join(' ')).toContain('동료 0명')
  await $.agent.spawn(spawn('toolu_a', 'Explore'))
  expect(labelRow((await floorView($)).cells ?? '', 80)).toContain('Explore')
})

test('a refusal counts once however often it is seen', async ($, on) => {
  const { refuseNext } = world(on)
  await start($)
  refuseNext('game-trap-guard blocked this call: cat .env')
  await ($.tool.call as unknown as AnyToolCall)({ tool: 'Bash', command: 'cat .env', tool_use_id: 'toolu_1' })
  refuseNext('game-trap-guard blocked this call: cat .env')
  await ($.tool.call as unknown as AnyToolCall)({ tool: 'Bash', command: 'cat .env', tool_use_id: 'toolu_2' })
  expect((await floorView($)).texts.join(' ')).toContain('TRAP! 가드가 막은 호출 2건')
})

test('a worker waiting with no desk takes the desk another left, and walks in to it', async ($, on) => {
  const { clock, blits } = world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-dev-floor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'devfloor',
    props: { title: 'DEV FLOOR', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  for (const name of ['one', 'two', 'three', 'four', 'five', 'six']) await $.agent.spawn(spawn(`toolu_${name}`, 'general-purpose', name))
  await clock.advance(2_000)
  const full = labelRow(blits[blits.length - 1] ?? '', 100)
  expect(full).toContain('+1')
  expect(full).not.toContain('six')
  // The first hands its report back, shows CLEAR, walks out: the sixth takes its desk.
  await $.turn.complete({ answer: 'ok', durationMs: 2_000, isAborted: false, turnId: 't', reason: 'answer', agentId: 'agent-1' })
  await clock.advance(CLEAR_HOLD_MS + 1_500)
  const after = labelRow(blits[blits.length - 1] ?? '', 100)
  expect(after).toContain('six')
  expect(after).not.toContain('+1')
  expect(after).not.toContain('one')
  await ui.unmount()
})

test('a worker at a desk past the edge of the pane moves in to a desk the pane shows once one is free', async ($, on) => {
  const { clock, blits } = world(on)
  await start($)
  // 70 columns hold four desks: the LEAD's and three more. The fifth worker sits past the edge.
  const ui = await $.ui.mount({
    plugin: 'game-dev-floor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'devfloor',
    props: { title: 'DEV FLOOR', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  for (const name of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn(`toolu_${name}`, 'general-purpose', name))
  await clock.advance(2_000)
  const full = labelRow(blits[blits.length - 1] ?? '', 70)
  expect(full).toContain('+')
  expect(full).not.toContain('five')
  // The ones at the desks the pane shows hand their reports back and walk out.
  for (const id of ['agent-1', 'agent-2', 'agent-3', 'agent-4']) {
    await $.turn.complete({ answer: 'ok', durationMs: 2_000, isAborted: false, turnId: 't', reason: 'answer', agentId: id })
  }
  await clock.advance(CLEAR_HOLD_MS + 1_500)
  const after = labelRow(blits[blits.length - 1] ?? '', 70)
  expect(after).toContain('five')
  expect(after).not.toContain('+')
  await ui.unmount()
})
