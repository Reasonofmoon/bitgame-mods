import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { hintsOf } from '../hooks/register'

type HintProps = { isDraft: boolean; isWorking: boolean; hint: string; tail?: string }

function world(on: On, opts: { hasSavePoint?: boolean } = {}) {
  const drawn: HintProps[] = []
  let fail = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({
    value: opts.hasSavePoint ? [{ name: 'save', description: 'Save', source: 'plugin' as const, plugin: 'game-save-point' }] : [],
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => (fail ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' } : { result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('ui.render', ($, e) => {
    if (e.component === 'PromptHint') drawn.push(e.props)
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { drawn, failing: (v: boolean) => (fail = v) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function tailOf($: Engine, drawn: HintProps[], line: Partial<HintProps> = {}) {
  const props = { isDraft: false, isWorking: false, hint: '? for shortcuts', ...line }
  const ui = await $.ui.mount({ plugin: 'game-hint', surface: 'terminal', component: 'PromptHint', props })
  await ui.unmount()
  return drawn[drawn.length - 1]?.tail
}

function measure(percentUsed: number) {
  return { context: { tokens: percentUsed * 2000, window: 200_000, percent: percentUsed }, rateLimits: [], changed: ['context' as const] }
}

test('while Claude works the line says ESC 후퇴; an idle line adds nothing', async ($, on) => {
  const { drawn } = world(on)
  await start($)
  expect(await tailOf($, drawn, { isWorking: true, hint: 'esc to interrupt' })).toBe('▸ ESC 후퇴')
  expect(await tailOf($, drawn)).toBeUndefined()
})

test('low context suggests a rest; two failures in a row say read the error first', async ($, on) => {
  const { drawn, failing } = world(on)
  await start($)
  await $.session.measure(measure(80))
  expect(await tailOf($, drawn)).toBe('▸ /compact 휴식')
  failing(true)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await tailOf($, drawn, { isWorking: true })).toBe('▸ ESC 후퇴  ▸ 오류부터 읽기')
  failing(false)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await tailOf($, drawn, { isWorking: true })).toBe('▸ ESC 후퇴')
})

test('/save is suggested after several turns without one, with game-save-point', { options: { saveEvery: 2 } }, async ($, on) => {
  const { drawn } = world(on, { hasSavePoint: true })
  await start($)
  const done = { answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' as const }
  await $.turn.complete(done)
  expect(await tailOf($, drawn)).toBeUndefined()
  await $.turn.complete(done)
  expect(await tailOf($, drawn)).toBe('▸ /save 세이브')
  // Not while typing.
  expect(await tailOf($, drawn, { isDraft: true })).toBeUndefined()
})

test('another plugin\'s addition stays first', async ($, on) => {
  const { drawn } = world(on)
  await start($)
  expect(await tailOf($, drawn, { isWorking: true, tail: 'Tab 이어하기' })).toBe('Tab 이어하기 · ▸ ESC 후퇴')
})

test('off adds nothing', { options: { intensity: 'off' } }, async ($, on) => {
  const { drawn } = world(on)
  await start($)
  expect(await tailOf($, drawn, { isWorking: true })).toBeUndefined()
})

test('hints by situation', () => {
  const cues = { hpLeft: 10, failStreak: 3, turnsSinceSave: 9, canSave: true }
  expect(hintsOf(cues, { isDraft: false, isWorking: false }, 25, 5, true)).toEqual(['오류부터 읽기 (연속 실패 3)', '/compact 휴식'])
  expect(hintsOf({ ...cues, hpLeft: 90, failStreak: 0 }, { isDraft: false, isWorking: false }, 25, 5, false)).toEqual(['/save 세이브'])
})
