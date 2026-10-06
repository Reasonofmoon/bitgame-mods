import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult, RenderElement } from 'claude-code'
import { doneOf, secretsIn, vagueIn } from '../hooks/register'

type HintProps = { isDraft: boolean; isWorking: boolean; hint: string; tail?: string }

function world(on: On) {
  mock.env(on, { USER: 'moon' })
  const hints: HintProps[] = []
  const contexts: (readonly string[] | undefined)[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('ui.render', ($, e) => {
    if (e.component === 'PromptHint') hints.push(e.props)
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { hints, contexts }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

// The kit raises prompt.edit like any event; its typed `$` does not list it yet.
type Editing = { edit: (e: PromptEditInput) => Promise<PromptEditResult> }

async function type($: Engine, text: string) {
  return ($.prompt as unknown as Editing).edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text })
}

async function hintTail($: Engine, hints: HintProps[]) {
  const ui = await $.ui.mount({ plugin: 'game-spell-check', surface: 'terminal', component: 'PromptHint', props: { isDraft: true, isWorking: false, hint: 'esc to clear' } })
  await ui.unmount()
  return hints[hints.length - 1]?.tail
}

// Built at run time, so no real-looking key sits in the repository.
const FAKE_KEY = ['sk', 'ant', 'x'.repeat(24)].join('-')

test('vague words are underlined while typing and the hint line says what to add', async ($, on) => {
  const { hints } = world(on)
  await start($)
  const box = await type($, '로그인 버그 적당히 고쳐줘')
  expect(box.decorations).toEqual([{ start: 7, end: 10, color: '#ff8a6a', underline: true }])
  expect(await hintTail($, hints)).toBe("⚠ '적당히' — 무엇이 되면 끝인지 적어라")
})

test('a secret in the draft is marked in the error color and named first', async ($, on) => {
  const { hints } = world(on)
  await start($)
  const box = await type($, `이 키로 대충 테스트해줘 ${FAKE_KEY}`)
  expect(box.decorations?.map(d => d.color)).toEqual(['#ff8a6a', '#f83800'])
  expect(await hintTail($, hints)).toBe('⚠ 비밀 값이 보인다 — 보내기 전에 지워라')
})

test('a vague prompt with no done condition carries a note for Claude; one with a condition does not', async ($, on) => {
  const { contexts } = world(on)
  await start($)
  await $.prompt.submit({ text: '로그인 버그 적당히 고쳐줘', wait: false, origin: { kind: 'composer' } })
  expect(contexts[0]?.[0]).toContain("모호한 표현('적당히')")
  expect(contexts[0]?.[0]).toContain('완료 조건')
  await $.prompt.submit({ text: '로그인 버그 적당히 고쳐줘. npm test 가 통과하면 끝이야', wait: false, origin: { kind: 'composer' } })
  expect(contexts[1]).toBeUndefined()
  // Another source's prompt is left alone.
  await $.prompt.submit({ text: '적당히', wait: false, origin: { kind: 'plugin', plugin: 'x' } } as never)
  expect(contexts[2]).toBeUndefined()
})

test('your messages draw as P1 with the done condition', async ($, on) => {
  world(on)
  await start($)
  await $.prompt.submit({ text: '로그인 버그 적당히 고쳐줘', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '고쳐줘\n완료 조건: npm test 3개 통과', wait: false, origin: { kind: 'composer' } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const row = async (text: string) => {
      const ui = await $.ui.mount({ plugin: 'game-spell-check', surface, component: 'UserMessage', props: { text, origin: { kind: 'composer' }, isExpanded: false } })
      const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      await ui.unmount()
      return shown
    }
    expect(await row('로그인 버그 적당히 고쳐줘')).toEqual(['P1 · moon', '로그인 버그 적당히 고쳐줘', '⚑ 완료 조건 · Claude에게 먼저 정하라고 함'])
    expect(await row('고쳐줘\n완료 조건: npm test 3개 통과')).toEqual(['P1 · moon', '고쳐줘\n완료 조건: npm test 3개 통과', '⚑ 완료 조건 · npm test 3개 통과'])
  }
})

test('off changes nothing', { options: { intensity: 'off' } }, async ($, on) => {
  const { contexts } = world(on)
  await start($)
  expect((await type($, '적당히')).decorations).toBeUndefined()
  await $.prompt.submit({ text: '적당히', wait: false, origin: { kind: 'composer' } })
  expect(contexts[0]).toBeUndefined()
})

test('words, secrets and done conditions', () => {
  expect(vagueIn('알아서 깔끔하게 해줘').map(f => f.word)).toEqual(['알아서', '깔끔하게'])
  expect(vagueIn('Clean it up properly').map(f => f.word)).toEqual(['Clean it up', 'properly'])
  expect(secretsIn(`password = ${'h'.repeat(10)}`)).toHaveLength(1)
  expect(secretsIn('the password is long')).toHaveLength(0)
  expect(doneOf('테스트가 모두 통과하면 끝')).toBe('테스트가 모두 통과하면 끝')
  expect(doneOf('Done when: the page loads in 1s')).toBe('the page loads in 1s')
  expect(doneOf('그냥 고쳐줘')).toBe('')
})
