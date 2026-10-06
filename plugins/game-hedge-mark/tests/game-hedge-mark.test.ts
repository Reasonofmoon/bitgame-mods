import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { markHedges } from '../hooks/register'

function world(on: On) {
  const engine: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    if (e.component === 'AssistantMessage') engine.push(e.props.text)
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { engine }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const REPLY = '테스트 3개 중 2개가 실패합니다. 아마 issuedAt 단위가 원인일 것입니다.\n\n```js\n// maybe later\n```\n- 고칠 곳은 `refresh()` 같습니다.'

async function draw($: Engine, surface: 'terminal' | 'desktop', props: { text: string; isFirstOfReply: boolean; isSummary?: true }) {
  const ui = await $.ui.mount({ plugin: 'game-hedge-mark', surface, component: 'AssistantMessage', props })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const md = (await ui.findAll({ type: 'Markdown' })) as unknown as { props?: { text?: string }; text?: string }[]
  await ui.unmount()
  return { texts, md }
}

test('a reply draws in a CLAUDE window with its guesses marked and counted', async ($, on) => {
  world(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const { texts } = await draw($, surface, { text: REPLY, isFirstOfReply: true })
    expect(texts).toEqual(['CLAUDE', '? 추정 2곳 · 확인되기 전까지는 가설'])
  }
  const later = await draw($, 'terminal', { text: '확인했습니다. 3개 모두 통과합니다.', isFirstOfReply: false })
  expect(later.texts).toEqual([])
})

test('a summary row stays the engine\'s; hardcore marks inside the engine\'s own drawing', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const { engine } = world(on)
  await start($)
  await draw($, 'terminal', { text: REPLY, isFirstOfReply: true })
  expect(engine[0]).toContain('**[?]** 아마 issuedAt')
  await draw($, 'terminal', { text: 'maybe a summary', isFirstOfReply: true, isSummary: true })
  expect(engine[1]).toBe('maybe a summary')
})

test('marking: sentences, lists and code', () => {
  const { text, count } = markHedges(REPLY)
  expect(count).toBe(2)
  expect(text).toBe('테스트 3개 중 2개가 실패합니다. **[?]** 아마 issuedAt 단위가 원인일 것입니다.\n\n```js\n// maybe later\n```\n- **[?]** 고칠 곳은 `refresh()` 같습니다.')
  expect(markHedges('This might fail. It passed.').text).toBe('**[?]** This might fail. It passed.')
  expect(markHedges('Run `maybe-cli` now.').count).toBe(0)
  expect(markHedges('다음과 같이 보입니다.').count).toBe(0)
  expect(markHedges('결과는 다음과 같습니다.').count).toBe(0)
  expect(markHedges('원인으로 보입니다.').count).toBe(1)
})
