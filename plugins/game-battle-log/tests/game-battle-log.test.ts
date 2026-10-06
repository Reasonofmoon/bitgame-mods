import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { diffstat, keyOf, resultsOf, short, usesOf } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const

function world(on: On) {
  mock.store(on)
  const engine: { component: string; isExpanded?: boolean }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.turns', () => ({ value: 0 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // What the engine draws when the battle log passes.
  on('ui.render', ($, e) => {
    engine.push({
      component: e.component,
      isExpanded: e.component === 'ToolGroup' ? e.props.isExpanded : undefined,
    })
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine') as RenderElement
  })
  return { engine }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function row(tool: string, input: Record<string, unknown>, state: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean; output: unknown }> = {}) {
  return {
    component: 'ToolUse' as const,
    props: {
      tool_use_id: 'toolu_1',
      tool,
      input,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      ...state,
    },
  }
}

async function texts(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

test('a clean Bash run is a HIT on every surface', async ($, on) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'game-battle-log',
      surface,
      ...row('Bash', { command: 'npm test' }, { output: { stdout: 'ok', stderr: '', interrupted: false } }),
    })
    expect(await texts(ui)).toEqual(['▸', 'BASH', 'npm test', 'HIT'])
    await ui.unmount()
  }
})

test('an edit is a CRIT with the path relative to the project', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    ...row('Edit', { file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' }, { output: {} }),
  })
  expect(await texts(ui)).toEqual(['▸', 'EDIT', 'src/auth.ts', 'CRIT'])
})

test('a failure is a MISS with its first lines, and the result block steps aside', async ($, on) => {
  world(on)
  await start($)
  const output = 'Exit code 1\n\nFAIL src/auth.test.ts\n  2 failed\n  38 passed\nDone'
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    ...row('Bash', { command: 'npm test' }, { isErrored: true, output }),
  })
  expect(await texts(ui)).toEqual(['▸', 'BASH', 'npm test', 'MISS', '  ✗ FAIL src/auth.test.ts', '  ✗   2 failed', '  … +3줄 (ctrl+o)'])

  const result = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_1', tool: 'Bash', output, isErrored: true },
  })
  expect((await result.drawn()) as unknown).toEqual({ type: 'Box' })
})

test('the excerpt skips exit codes and warnings for the lines that say what failed', async ($, on) => {
  world(on)
  await start($)
  const output = [
    'Error: Exit code 1',
    'TAP version 13',
    '# (node:5288) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/x is not specified',
    '# Subtest: a fresh token is not expired',
    'not ok 1 - a fresh token is not expired',
    "  error: 'Expected values to be strictly equal:\n\ntrue !== false\n'",
    'ok 2 - an old token is expired',
    'not ok 3 - refresh keeps seconds',
  ].join('\n')
  const ui = await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('Bash', { command: 'node --test' }, { isErrored: true, output }) })
  expect((await texts(ui)).slice(4)).toEqual([
    '  ✗ not ok 1 - a fresh token is not expired',
    "  ✗   error: 'Expected values to be strictly equal:",
    '  ✗ not ok 3 - refresh keeps seconds',
    // 10 non-empty lines, 3 shown
    '  … +7줄 (ctrl+o)',
  ])
})

test('a refusal by a GAME MODE guard shows that guard\'s verdict', async ($, on) => {
  world(on)
  await start($)
  const refusals = [
    ['cat .env', 'game-trap-guard blocked this call: it prints a secret file (.env).', 'TRAP!'],
    ['git reset --hard', 'game-barrier blocked this call: it discards uncommitted changes (git reset --hard).', 'BARRIER!'],
    ['npm test', 'game-loop-breaker blocked this call: the same command failed 3 times in a row.', 'LOOP!'],
  ] as const
  for (const [command, output, verdict] of refusals) {
    const ui = await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('Bash', { command }, { isErrored: true, output }) })
    const shown = await texts(ui)
    expect(shown[3]).toBe(verdict)
    expect(shown[4]).toContain('blocked this call')
    await ui.unmount()
  }
})

// Calls of the main loop as the engine runs them; the test's hook answers each one.
function calls(on: On) {
  const ids: string[] = []
  const plan: ('ok' | 'fail' | 'deny')[] = []
  on('tool.call', (_, e) => {
    ids.push(e.tool_use_id)
    const outcome = plan.shift() ?? 'ok'
    if (outcome === 'deny') return { deny: 'game-barrier blocked this call: it discards uncommitted changes.' }
    if (outcome === 'fail') return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return {
    ids,
    async run($: Engine, outcome: 'ok' | 'fail' | 'deny' = 'ok') {
      plan.push(outcome)
      await $.tool.call({ tool: 'Bash', command: 'npm test' })
      return ids[ids.length - 1] ?? ''
    },
  }
}

async function rowOf($: Engine, id: string, state: Parameters<typeof row>[2] = { output: { stdout: 'ok', stderr: '', interrupted: false } }) {
  const r = row('Bash', { command: 'npm test' }, state)
  const ui = await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', component: r.component, props: { ...r.props, tool_use_id: id } })
  const shown = await texts(ui)
  await ui.unmount()
  return shown
}

test('the first row of each turn carries the turn header', async ($, on) => {
  world(on)
  const tools = calls(on)
  await start($)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  const a = await tools.run($)
  const b = await tools.run($)
  expect((await rowOf($, a))[0]).toBe('⚔ BATTLE LOG · TURN 1')
  expect((await rowOf($, b))[0]).toBe('▸')

  await $.turn.start({ text: 'again', turnId: 't2' })
  const c = await tools.run($)
  expect((await rowOf($, c, { isRunning: true }))[0]).toBe('⚔ BATTLE LOG · TURN 2')
})

test('three clean calls make a combo; the failure that ends it says BREAK', async ($, on) => {
  world(on)
  const tools = calls(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const [a, b, c, d] = [await tools.run($), await tools.run($), await tools.run($), await tools.run($)]
  const e = await tools.run($, 'fail')
  expect(await rowOf($, b)).toEqual(['▸', 'BASH', 'npm test', 'HIT'])
  expect(await rowOf($, c)).toEqual(['▸', 'BASH', 'npm test', 'HIT', 'COMBO ×3'])
  expect(await rowOf($, d)).toEqual(['▸', 'BASH', 'npm test', 'HIT', 'COMBO ×4'])
  expect((await rowOf($, e, { isErrored: true, output: 'Exit code 1\nFAIL x' })).slice(0, 5)).toEqual(['▸', 'BASH', 'npm test', 'MISS', 'COMBO ×4 → BREAK'])
  expect((await rowOf($, a))[0]).toBe('⚔ BATTLE LOG · TURN 1')

  // A guard's refusal breaks a run too; a run shorter than three ends quietly.
  const [f, g, h] = [await tools.run($), await tools.run($), await tools.run($)]
  const refused = await tools.run($, 'deny')
  expect((await rowOf($, h))[4]).toBe('COMBO ×3')
  expect((await rowOf($, refused, { isErrored: true, output: 'game-barrier blocked this call: it discards uncommitted changes.' })).slice(3, 5)).toEqual(['BARRIER!', 'COMBO ×3 → BREAK'])
  const i = await tools.run($, 'fail')
  expect((await rowOf($, i, { isErrored: true, output: 'Exit code 1' }))[4]).not.toContain('BREAK')
  expect([f, g].length).toBe(2)
})

test('an edit shows the lines it added and removed', async ($, on) => {
  world(on)
  await start($)
  const output = {
    filePath: '/proj/src/auth.ts',
    structuredPatch: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' a', '-b', '+c', '+d'] }],
  }
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    ...row('Edit', { file_path: '/proj/src/auth.ts', old_string: 'b', new_string: 'c\nd' }, { output }),
  })
  expect(await texts(ui)).toEqual(['▸', 'EDIT', 'src/auth.ts', '+2', '−1', 'CRIT'])
  expect(diffstat({ type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })).toEqual({ added: 3, removed: 0 })
  expect(diffstat({ structuredPatch: [], gitDiff: { additions: 4, deletions: 1 } })).toEqual({ added: 4, removed: 1 })
})

test('the background pill reads SUMMON with the person\'s own key', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    component: 'ToolProgress',
    props: { tool_use_id: 'toolu_1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  })
  expect(await texts(ui)).toEqual(['SUMMON', 'ctrl+b ▸ 소환수에게 맡기기 (백그라운드)'])
  expect(keyOf('(ctrl+x b to run in background)')).toBe('ctrl+x b')
  expect(keyOf('')).toBe('ctrl+b')
})

test('a folded group that opens the turn carries the header and the combo', async ($, on) => {
  world(on)
  const tools = calls(on)
  await start($)
  await $.turn.start({ text: 'look', turnId: 't1' })
  const ids = [await tools.run($), await tools.run($), await tools.run($)]
  const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false })
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: ids.map(call), isActive: false, isExpanded: false },
  })
  expect(await texts(ui)).toEqual(['⚔ BATTLE LOG · TURN 1', '▸', '탐색 ×3', 'READ 3', 'HIT', 'COMBO ×3'])
})

test('a row the engine draws keeps the header when it opens the turn', async ($, on) => {
  const { engine } = world(on)
  const tools = calls(on)
  await start($)
  await $.turn.start({ text: 'plan', turnId: 't1' })
  const id = await tools.run($)
  const r = row('TodoWrite', { todos: [] })
  const ui = await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', component: r.component, props: { ...r.props, tool_use_id: id } })
  expect(await texts(ui)).toEqual(['⚔ BATTLE LOG · TURN 1', 'engine'])
  expect(engine.map(x => x.component)).toEqual(['ToolUse'])
})

test('the rows a session keeps name the calls and their results', () => {
  expect(usesOf([{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: {} }])).toEqual(['toolu_a'])
  expect(resultsOf([{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'x', is_error: true }, { type: 'tool_result', tool_use_id: 'toolu_b', content: 'ok' }])).toEqual([
    { id: 'toolu_a', isError: true },
    { id: 'toolu_b', isError: false },
  ])
})

test('a clean group is one line; a group with a failure unfolds for the engine', async ($, on) => {
  const { engine } = world(on)
  await start($)
  const call = (tool: string, isErrored = false) => ({ tool, input: {}, isRunning: false, isErrored, isInterrupted: false })
  const clean = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read'), call('Read'), call('Grep')], isActive: false, isExpanded: false },
  })
  expect(await texts(clean)).toEqual(['▸', '탐색 ×3', 'READ 2 · GREP 1', 'HIT'])

  await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read'), call('Read', true)], isActive: false, isExpanded: false },
  })
  expect(engine).toEqual([{ component: 'ToolGroup', isExpanded: true }])
})

test('rows that draw their own content stay the engine\'s', async ($, on) => {
  const { engine } = world(on)
  await start($)
  await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('TodoWrite', { todos: [] }) })
  await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('Agent', { prompt: 'x' }) })
  expect(engine.map(r => r.component)).toEqual(['ToolUse', 'ToolUse'])
})

test('hardcore uses game phrasing', { options: { intensity: 'hardcore' } }, async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('Bash', { command: 'npm test' }, { isRunning: true }) })
  expect(await texts(ui)).toEqual(['▶', 'CLAUDE의 BASH!', 'npm test', 'CASTING…'])
})

test('/battle-log off hands every row back to the engine', async ($, on) => {
  const { engine } = world(on)
  await start($)
  const off = await $.command.run({
    command: 'battle-log',
    args: 'off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(off.text).toBe('battle log off')
  await $.ui.mount({ plugin: 'game-battle-log', surface: 'terminal', ...row('Bash', { command: 'ls' }) })
  expect(engine).toHaveLength(1)
})

test('Windows paths are shown relative to the project, whatever their slashes or case', async () => {
  expect(short('C:\\Users\\me\\proj\\src\\auth.ts', 'C:\\Users\\me\\proj')).toBe('src/auth.ts')
  expect(short('c:/users/me/proj/src/auth.ts', 'C:\\Users\\me\\proj')).toBe('src/auth.ts')
  expect(short('D:\\other\\x.ts', 'C:\\Users\\me\\proj')).toBe('D:\\other\\x.ts')
  expect(short('/proj/src/auth.ts', '/proj')).toBe('src/auth.ts')
  expect(short('/Proj/src/auth.ts', '/proj')).toBe('/Proj/src/auth.ts')
})
