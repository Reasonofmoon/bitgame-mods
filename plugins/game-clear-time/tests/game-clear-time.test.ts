import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { medianOf, recordFor } from '../hooks/register'

function world(on: On, history?: number[]) {
  mock.store(on, history === undefined ? {} : { 'durations:/proj': history })
  let usd = 1
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd } } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { spend: (to: number) => (usd = to) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function play($: Engine, spend: (to: number) => number, ms: number, calls: number, cost: number, reason: 'answer' | 'aborted' = 'answer') {
  await $.turn.start({ text: 'go', turnId: `t${ms}` })
  for (let i = 0; i < calls; i++) await $.tool.call({ tool: 'Bash', command: 'true' })
  spend(cost)
  await $.turn.complete({ answer: 'ok', durationMs: ms, isAborted: reason === 'aborted', turnId: `t${ms}`, reason })
}

async function line($: Engine, durationMs: number) {
  const ui = await $.ui.mount({ plugin: 'game-clear-time', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs } })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return shown
}

test('a turn closes with its time, actions and cost, against the project\'s usual turn', async ($, on) => {
  const { spend } = world(on, [60_000, 50_000, 40_000, 70_000])
  await start($)
  await play($, spend, 42_000, 7, 1.2)
  expect(await line($, 42_000)).toEqual(['✦ CLEAR', '0:42', '· 행동 7', '· 이번 턴 ₩280', '· 평소보다 −0:13'])
  // The 0:42 turn is on record now: the median of 0:40, 0:42, 0:50, 1:00, 1:10 is 0:50.
  await play($, spend, 125_000, 2, 1.25)
  expect(await line($, 125_000)).toEqual(['✦ CLEAR', '2:05', '· 행동 2', '· 이번 턴 ₩70', '· 평소보다 +1:15'])
  // An earlier line drawn again still finds its own turn.
  expect((await line($, 42_000))[2]).toBe('· 행동 7')
})

test('with fewer than three turns on record there is nothing to compare', async ($, on) => {
  const { spend } = world(on)
  await start($)
  await play($, spend, 9_000, 1, 1.01)
  expect(await line($, 9_000)).toEqual(['✦ CLEAR', '0:09', '· 행동 1', '· 이번 턴 ₩14'])
})

test('the line\'s duration may differ by a little from the turn\'s', async ($, on) => {
  const { spend } = world(on)
  await start($)
  await play($, spend, 30_000, 3, 1)
  expect((await line($, 30_400))[2]).toBe('· 행동 3')
  expect(await line($, 90_000)).toEqual(['✦ CLEAR', '1:30'])
})

test('an interrupted turn is shown but not kept as a usual turn', async ($, on) => {
  const { spend } = world(on, [10_000, 10_000, 10_000])
  await start($)
  await play($, spend, 600_000, 1, 1, 'aborted')
  const report = await $.command.run({ command: 'clear-time', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(report.text).toContain('last 3 turns')
  expect(report.text).toContain('평소 (median) 0:10')
})

test('hardcore adds the median; off leaves the line', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const { spend } = world(on, [20_000, 30_000, 40_000])
  await start($)
  await play($, spend, 30_000, 1, 1)
  expect((await line($, 30_000)).slice(-2)).toEqual(['· 평소보다 −0:00', '(평소 0:30)'])
})

test('medians and matching', () => {
  expect(medianOf([3, 1, 2])).toBe(2)
  expect(medianOf([4, 1, 2, 3])).toBe(3)
  const rec = (durationMs: number) => ({ durationMs, actions: durationMs, usd: null, startUsd: null, deltaMs: null, medianMs: null })
  expect(recordFor([rec(1000), rec(5000)], 4200)?.actions).toBe(5000)
  expect(recordFor([rec(1000)], 9000)).toBeUndefined()
})
