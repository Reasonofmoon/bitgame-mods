import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}

const SURFACES = ['terminal', 'desktop'] as const

function hud(args: string) {
  return {
    command: 'hud',
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 120 },
  }
}

// The engine's side of everything the HUD asks for.
function world(on: On, opts: { hasSave?: boolean } = {}) {
  mock.store(on)
  const ran: string[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.turns', () => ({ value: 0 }))
  on('command.list', () => ({
    value: opts.hasSave
      ? [{ name: 'save', description: 'Save', source: 'plugin' as const, plugin: 'game-save-point' }]
      : [],
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  // What the engine draws when the HUD passes.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine') as RenderElement
  })
  return { ran, toasts }
}

function measure(percent: number, extra: { limit?: number; usd?: number } = {}) {
  return {
    context: { tokens: percent * 2000, window: 200_000, percent },
    rateLimits: extra.limit === undefined ? [] : [{ kind: 'five_hour', percentUsed: extra.limit }],
    cost: extra.usd === undefined ? undefined : { usd: extra.usd },
    changed: ['context' as const, 'rateLimits' as const, 'cost' as const],
  }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

test('draws HP, MP and G from session.measure on every surface', async ($, on) => {
  world(on)
  await start($)
  await $.session.measure(measure(38, { limit: 52, usd: 1.234 }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'game-hud', surface, ...BAND })
    expect((await ui.find({ type: 'Text', text: /^HP/ }))?.text).toBe('HP █████░░░ 62%')
    expect((await ui.find({ type: 'Text', text: /^MP/ }))?.text).toBe('MP ████░░░░ 48% 5h')
    expect((await ui.find({ type: 'Text', text: /^G / }))?.text).toBe('G $1.23')
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('low HP shows rest and save; the buttons run /compact and /save', async ($, on) => {
  const { ran, toasts } = world(on, { hasSave: true })
  await start($)
  await $.session.measure(measure(80, { usd: 2 }))
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('HP LOW!')

  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^HP LOW/ }))?.text).toBe('HP LOW!')
  await ui.press({ key: 'rest' })
  await ui.press({ key: 'save' })
  expect(ran).toEqual(['compact', 'save'])
  await ui.unmount()

  // One toast per dip: staying low says nothing, recovering re-arms it.
  await $.session.measure(measure(82))
  expect(toasts).toHaveLength(1)
  await $.session.measure(measure(40))
  await $.session.measure(measure(79))
  expect(toasts).toHaveLength(2)
})

test('no save button without game-save-point', async ($, on) => {
  world(on)
  await start($)
  await $.session.measure(measure(90))
  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
})

test('krw currency converts the ledger', { options: { currency: 'krw', krwPerUsd: 1400 } }, async ($, on) => {
  world(on)
  await start($)
  await $.session.measure(measure(10, { usd: 1.234 }))
  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^G / }))?.text).toBe('G ₩1,728')
})

test('hardcore adds EXP from successful tool calls', { options: { intensity: 'hardcore' } }, async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await start($)
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'true' })
  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^LV/ }))?.text).toBe('LV 2')
  expect((await ui.find({ type: 'Text', text: /^EXP/ }))?.text).toBe('EXP ░░░░░ 1/12')
})

test('/hud hide passes the band to the engine; /hud reports as text', async ($, on) => {
  world(on)
  await start($)
  await $.session.measure(measure(25, { usd: 0.5 }))
  const hidden = await $.command.run(hud('hide'))
  expect(hidden.text).toContain('hidden')
  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect((await ui.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })

  const report = await $.command.run(hud(''))
  expect(report.text).toContain('HP 75%')
  expect(report.text).toContain('G  $0.50')
})

test('off leaves the band to the engine', { options: { intensity: 'off' } }, async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'game-hud', surface: 'terminal', ...BAND })
  expect((await ui.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })
})
