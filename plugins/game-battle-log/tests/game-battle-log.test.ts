import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

function world(on: On) {
  mock.store(on)
  const engine: { component: string; isExpanded?: boolean }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
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

test('a refusal by a GAME MODE guard is a BLOCK', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: 'game-battle-log',
    surface: 'terminal',
    ...row('Bash', { command: 'cat .env' }, { isErrored: true, output: 'game-trap-guard blocked this call: it prints a secret file (.env).' }),
  })
  const shown = await texts(ui)
  expect(shown[3]).toBe('BLOCK')
  expect(shown[4]).toContain('game-trap-guard blocked this call')
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
