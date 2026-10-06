import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { castOf } from '../hooks/register'

type SpinnerProps = { word: string; message: string | null; suffix: string; mode: 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use' }

function world(on: On, cost = { usd: 0.5 }) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const drawn: SpinnerProps[] = []
  let release: (() => void) | undefined
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', async (_, e) => {
    // A call to `slow` runs until the test lets it go.
    if (e.tool === 'Bash' && e.command === 'slow') await new Promise<void>(r => (release = r))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    if (e.component === 'Spinner') drawn.push(e.props)
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { drawn, clock, release: () => release?.() }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function spin($: Engine, drawn: SpinnerProps[], mode: SpinnerProps['mode'] = 'thinking', surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'game-casting', surface, component: 'Spinner', props: { word: 'Sauteing', message: null, suffix: '…', mode } })
  await ui.unmount()
  return drawn[drawn.length - 1]
}

test('the spinner names what the turn does, the actions and the cost so far', async ($, on) => {
  const { drawn } = world(on)
  await start($)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  for (const surface of ['terminal', 'desktop'] as const) {
    expect((await spin($, drawn, 'thinking', surface))?.message).toBe('CASTING · 생각하는 중… · 행동 0 · G +₩0')
  }
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/auth.ts' })
  await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0.6 }, changed: ['cost'] })
  const after = await spin($, drawn, 'responding')
  expect(after?.message).toBe('CASTING · 답을 쓰는 중… · 행동 1 · G +₩140')
  // The words are rewritten; the engine keeps its time and tokens after them.
  expect(after?.word).toBe('Sauteing')
  expect(after?.suffix).toBe('')
})

test('a running call is named while it runs', async ($, on) => {
  const { drawn, clock, release } = world(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const running = $.tool.call({ tool: 'Bash', command: 'slow' })
  await clock.settle()
  expect((await spin($, drawn, 'tool-use'))?.message).toBe('CASTING · BASH slow… · 행동 1 · G +₩0')
  release()
  await running
  expect((await spin($, drawn, 'thinking'))?.message).toBe('CASTING · 생각하는 중… · 행동 1 · G +₩0')
})

test('a new turn starts the count again', { options: { currency: 'usd' } }, async ($, on) => {
  const { drawn } = world(on)
  await start($)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.start({ text: 'b', turnId: 't2' })
  expect((await spin($, drawn))?.message).toBe('CASTING · 생각하는 중… · 행동 0 · G +$0.00')
})

test('a state the engine names keeps its words; off leaves the spinner alone', async ($, on) => {
  const { drawn } = world(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'game-casting', surface: 'terminal', component: 'Spinner', props: { word: 'Sauteing', message: 'Compacting conversation', suffix: '…', mode: 'requesting' } })
  await ui.unmount()
  expect(drawn[drawn.length - 1]?.message).toBe('Compacting conversation')
})

test('calls are named by label and what they work on', () => {
  expect(castOf('Bash', { command: 'npm test -- --watch=false\necho done' })).toBe('BASH npm test -- --watch=false')
  expect(castOf('Edit', { file_path: 'C:\\proj\\src\\auth.ts' })).toBe('EDIT auth.ts')
  expect(castOf('Agent', { description: 'Find callers' })).toBe('SUMMON Find callers')
  expect(castOf('mcp__github__create_issue', {})).toBe('CREATE_ISSUE')
})
