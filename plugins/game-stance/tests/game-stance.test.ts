import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { modeOfHint, nextMode } from '../hooks/register'

function world(on: On, settings: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: settings }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine') as RenderElement
  })
  return { clock }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function badge($: Engine, surface: 'terminal' | 'desktop' = 'terminal', modes: string[] = []) {
  const ui = await $.ui.mount({ plugin: 'game-stance', surface, component: 'SessionMode', props: { modes } })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return shown
}

// The footer's line as a PromptHint hook is handed it.
const STEADY_DEFAULT = '? for shortcuts · ← for agents'
const STEADY_OTHER = '(shift+tab to cycle) · ← for agents'
const LEAVING: Record<string, string> = {
  default: '⏸ manual mode on · ? for shortcuts · ← for agents',
  acceptEdits: '⏵⏵ accept edits on (shift+tab to cycle) · ← for agents',
  plan: '⏸ plan mode on (shift+tab to cycle) · ← for agents',
  auto: '⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
  bypassPermissions: '⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
}

async function footer($: Engine, hint: string, isWorking = false) {
  const ui = await $.ui.mount({ plugin: 'game-stance', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking, hint } })
  await ui.unmount()
}

// One shift+tab as the engine draws it: one line naming the mode left, then steady lines.
async function shiftTab($: Engine, leaving: string, isDefaultAfter: boolean) {
  await footer($, LEAVING[leaving] ?? '')
  await footer($, isDefaultAfter ? STEADY_DEFAULT : STEADY_OTHER)
}

test('the badge starts at 기본 and follows shift+tab', async ($, on) => {
  const { clock } = world(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) expect(await badge($, surface)).toEqual(['STANCE', ' 기본 '])
  const cycle: [string, boolean, string][] = [
    ['default', false, ' 자동 승인 '],
    ['acceptEdits', false, ' 계획 '],
    ['plan', false, ' 자동 판정 '],
    ['auto', true, ' 기본 '],
  ]
  for (const [leaving, isDefaultAfter, label] of cycle) {
    await shiftTab($, leaving, isDefaultAfter)
    await clock.settle()
    expect((await badge($))[1]).toBe(label)
  }
})

test('우회 joins the order once the session shows it allows it', async ($, on) => {
  const { clock } = world(on)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'bypassPermissions' })
  expect((await badge($))[1]).toBe(' 우회 ')
  await shiftTab($, 'bypassPermissions', false)
  await clock.settle()
  expect((await badge($))[1]).toBe(' 자동 판정 ')
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'plan' })
  await shiftTab($, 'plan', false)
  await clock.settle()
  expect((await badge($))[1]).toBe(' 우회 ')
})

test('a steady default line corrects the badge; a change while Claude works waits for the tool result', async ($, on) => {
  const { clock } = world(on)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'plan' })
  await footer($, LEAVING.plan ?? '', true)
  await clock.settle()
  expect((await badge($))[1]).toBe(' 계획 ')
  await $.classic.PostToolUse({ tool_name: 'ExitPlanMode', tool_input: {}, tool_response: {}, tool_use_id: 't', permission_mode: 'acceptEdits' })
  expect((await badge($))[1]).toBe(' 자동 승인 ')
  await footer($, STEADY_DEFAULT)
  await clock.settle()
  expect((await badge($))[1]).toBe(' 기본 ')
})

test('the settings\' default mode is the badge at the start', async ($, on) => {
  world(on, { permissions: { defaultMode: 'acceptEdits' } })
  await start($)
  expect((await badge($))[1]).toBe(' 자동 승인 ')
})

test('the engine\'s own labels stay; hardcore says what the mode lets Claude do', { options: { intensity: 'hardcore' } }, async ($, on) => {
  world(on)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'acceptEdits' })
  expect(await badge($, 'terminal', ['focus'])).toEqual(['focus', 'STANCE', ' 자동 승인 ', '파일 수정은 묻지 않는다'])
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'not-a-mode' })
  expect((await badge($))[1]).toBe(' 자동 승인 ')
})

test('off leaves the footer to the engine', { options: { intensity: 'off' } }, async ($, on) => {
  world(on)
  await start($)
  expect(await badge($)).toEqual(['engine'])
})

test('mode phrases and shift+tab\'s order', () => {
  expect(modeOfHint("⏵⏵ don't ask on")).toBe('dontAsk')
  expect(modeOfHint(STEADY_OTHER)).toBeUndefined()
  expect(nextMode('plan', false)).toBe('auto')
  expect(nextMode('plan', true)).toBe('bypassPermissions')
  expect(nextMode('auto', true)).toBe('default')
})
