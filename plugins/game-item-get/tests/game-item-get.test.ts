import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { relative } from '../hooks/register'

function world(on: On) {
  const toasts: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') {
      const isNew = e.file_path.endsWith('token.ts')
      return {
        result: {
          type: isNew ? ('create' as const) : ('update' as const),
          filePath: e.file_path,
          content: e.content,
          structuredPatch: isNew ? [] : [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }],
          originalFile: isNew ? null : 'a',
        },
      }
    }
    if (e.tool === 'Edit') {
      return { result: { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: '', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }], userModified: false, replaceAll: false } }
    }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { toasts }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const inventory = { command: 'inventory', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

test('a new file is an item: a toast, and a banner on its row above the engine\'s result', async ($, on) => {
  const { toasts } = world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/src/token.ts', content: 'a\nb\nc\n' })
  expect(toasts).toEqual(['✦ ITEM GET! src/token.ts'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'game-item-get',
      surface,
      component: 'ToolResult',
      props: { tool_use_id: 't', tool: 'Write', isErrored: false, output: { type: 'create', filePath: '/proj/src/token.ts', content: 'a\nb\nc\n', structuredPatch: [], originalFile: null } },
    })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['✦ ITEM GET!', 'src/token.ts', '· 새 파일 3줄', 'engine'])
    await ui.unmount()
  }
})

test('/inventory lists the new and the changed files with their lines', async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/src/token.ts', content: 'a\nb\n' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'x', new_string: 'y' })
  const out = await $.command.run(inventory)
  expect(out.text).toBe('INVENTORY · 새 아이템 1 · 강화 1\n★ NEW  src/token.ts  +2\n✎ UP   src/auth.ts  +2 −2 ×2')
  const ui = await $.ui.mount({ plugin: 'game-item-get', surface: 'terminal', component: 'CommandOutput', props: { command: 'inventory', args: '', text: out.text ?? '', isErrored: false } })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(shown.slice(0, 2)).toEqual(['◆ INVENTORY', '새 아이템 1 · 강화 1'])
  expect(shown).toContain('★ NEW')
  expect(shown).toContain('×2')
})

test('an update is no item; hardcore toasts it as an upgrade', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const { toasts } = world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/README.md', content: 'b\nc' })
  expect(toasts).toEqual(['✎ README.md 강화 +2 −1'])
})

test('paths relative to the project, Windows too', () => {
  expect(relative('C:\\Users\\me\\proj\\src\\a.ts', 'C:\\Users\\me\\proj')).toBe('src/a.ts')
  expect(relative('/elsewhere/a.ts', '/proj')).toBe('/elsewhere/a.ts')
})
