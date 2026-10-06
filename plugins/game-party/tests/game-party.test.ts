import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

function world(on: On) {
  mock.clock(on, { now: 1_700_000_000_000 })
  const opened: string[] = []
  let n = 0
  let failNext = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `agent-${++n}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => {
    if (failNext) {
      failNext = false
      return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }
    }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { opened, failOnce: () => (failNext = true) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function spawn(toolUseId: string, description: string, subagentType: string, name?: string) {
  return {
    tool_use_id: toolUseId,
    prompt: 'go',
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...(name ? { name } : {}),
  }
}

async function pane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({
    plugin: 'game-party',
    surface,
    component: 'Pane',
    requestId: 'party',
    props: { title: 'PARTY', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return shown
}

test('each subagent joins the party; the pane opens when the first one starts', async ($, on) => {
  const { opened, failOnce } = world(on)
  await start($)
  await $.agent.spawn(spawn('toolu_a', '로그인 흐름 조사', 'Explore'))
  await $.agent.spawn(spawn('toolu_b', '보안 검토', 'general-purpose', 'reviewer'))
  expect(opened).toEqual(['party'])

  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts', agentId: 'agent-1' } as never)
  failOnce()
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'agent-2' } as never)
  await $.turn.complete({ answer: 'report', durationMs: 42_000, isAborted: false, turnId: 't', reason: 'answer', agentId: 'agent-1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await pane($, surface)).toEqual([
      'PARTY',
      '2명 · 진행 1',
      '◆',
      'Explore ',
      'CLEAR ',
      '████░░░░░░',
      '  4',
      '로그인 흐름 조사',
      '◆',
      'reviewer',
      'ACTIVE',
      '█░░░░░░░░░',
      '  1',
      '보안 검토',
    ])
  }
})

test('a member whose loop fails, or whose Agent call fails, is FAIL', async ($, on) => {
  const { failOnce } = world(on)
  await start($)
  await $.agent.spawn(spawn('toolu_a', 'a', 'Explore'))
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't', reason: 'error', agentId: 'agent-1' })
  await $.agent.spawn(spawn('toolu_b', 'b', 'Plan'))
  failOnce()
  await $.tool.call({ tool: 'Agent', description: 'b', prompt: 'go', tool_use_id: 'toolu_b' } as never)
  const text = (await $.command.run({ command: 'party', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text
  expect(text).toContain('◆ Explore FAIL')
})

test('an empty party says how members join; hardcore adds failures and run time', { options: { intensity: 'hardcore' } }, async ($, on) => {
  world(on)
  await start($)
  expect((await pane($))[2]).toBe('아직 소환한 동료가 없습니다. Claude가 subagent를 보내면 여기 나타납니다.')
  await $.agent.spawn(spawn('toolu_a', 'a', 'Explore'))
  await $.turn.complete({ answer: 'ok', durationMs: 65_000, isAborted: false, turnId: 't', reason: 'answer', agentId: 'agent-1' })
  const shown = await pane($)
  expect(shown).toContain('✗0')
  expect(shown).toContain('1:05')
})

test('autoOpen off waits for /party', { options: { autoOpen: false } }, async ($, on) => {
  const { opened } = world(on)
  await start($)
  await $.agent.spawn(spawn('toolu_a', 'a', 'Explore'))
  expect(opened).toEqual([])
})
