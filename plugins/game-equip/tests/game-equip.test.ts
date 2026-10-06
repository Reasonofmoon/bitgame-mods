import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { nameOf } from '../hooks/register'

function world(on: On) {
  const logs: string[] = []
  const toasts: string[] = []
  let model = 'claude-sonnet-5-5'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: model }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.PostModelSwitch', () => ({}))
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { logs, toasts, switchTo: (to: string) => (model = to) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

test('the session starts with the model it has on, and says so again when it changes', async ($, on) => {
  const { logs, switchTo } = world(on)
  await start($)
  expect(logs).toEqual(['EQUIP 모델 Sonnet 5.5 장착 · 교체는 /model'])
  await $.turn.start({ text: 'a', turnId: 't1' })
  switchTo('claude-opus-5-5')
  await $.turn.start({ text: 'b', turnId: 't2' })
  expect(logs).toEqual(['EQUIP 모델 Sonnet 5.5 장착 · 교체는 /model', 'EQUIP 모델 Opus 5.5 장착 · Sonnet 5.5에서 교체'])
})

test('a /model switch is told when it happens; hardcore toasts it', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const { logs, toasts } = world(on)
  await start($)
  await $.classic.PostModelSwitch({ from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5-20251001', requested_model: 'haiku' } as never)
  expect(logs.at(-1)).toBe('EQUIP 모델 Haiku 4.5 장착 · Sonnet 5.5에서 교체')
  expect(toasts).toEqual(['EQUIP Haiku 4.5'])
})

test('the engine\'s model notice reads as equipment; other notices stay', async ($, on) => {
  world(on)
  await start($)
  const notice = async (text: string, command: string | null) => {
    const ui = await $.ui.mount({ plugin: 'game-equip', surface: 'terminal', component: 'InfoNotice', props: { text, command } })
    const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    return shown
  }
  expect(await notice('Using Sonnet 5.5 from your settings', 'model')).toEqual(['EQUIP', '모델 Sonnet 5.5 장착', '· 교체는 /model'])
  expect(await notice('Enrolled in an experiment', null)).toEqual(['engine'])
})

test('model names', () => {
  expect(nameOf('claude-opus-5-5')).toBe('Opus 5.5')
  expect(nameOf('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(nameOf('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(nameOf('Sonnet 5.5')).toBe('Sonnet 5.5')
})
