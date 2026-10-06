import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { cellOf, groupsOf, relative } from '../hooks/register'

const FILES = ['README.md', 'package.json', 'src/auth.ts', 'src/db.ts', 'src/util.ts', 'test/auth.test.ts']

function world(on: On) {
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: FILES.join('\n') + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { opened }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function pane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({
    plugin: 'game-minimap',
    surface,
    component: 'Pane',
    requestId: 'minimap',
    props: { title: 'MINIMAP', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return shown
}

const minimap = { command: 'minimap', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

test('the map shows edited, read and unexplored files by folder, with counts on re-read ones', async ($, on) => {
  const { opened } = world(on)
  await start($)
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Read', file_path: '/proj/src/auth.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/proj/test/auth.test.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/db.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/elsewhere/x.ts' })
  const out = await $.command.run(minimap)
  expect(opened).toEqual(['minimap'])
  expect(out.text).toContain('MINIMAP · 파일 6 · 편집 1 · 읽음 2 · 미탐색 3')
  expect(out.text).toContain('가장 많이 다시 읽은 파일: src/auth.ts (4회)')
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await pane($, surface)).toEqual([
      'MINIMAP',
      '파일 6 · 편집 1 · 읽음 2 · 미탐색 3',
      'src/         ',
      '4',
      '█',
      '░',
      'test/        ',
      '▓',
      '(root)       ',
      '░░',
      '█ 편집',
      '▓ 읽음',
      '░ 미탐색',
      '3 = 세 번 읽음',
      '가장 많이 다시 읽은 파일: src/auth.ts (4회)',
    ])
  }
})

test('cells, folders and paths', () => {
  expect(cellOf(undefined)).toEqual({ glyph: '░', kind: 'none' })
  expect(cellOf({ reads: 12, isEdited: true })).toEqual({ glyph: '+', kind: 'edited' })
  expect(groupsOf(['b.md', 'src/a.ts', 'docs/x.md']).map(g => g[0])).toEqual(['docs/', 'src/', '(root)'])
  expect(relative('C:\\Users\\me\\proj\\src\\a.ts', 'C:\\Users\\me\\proj')).toBe('src/a.ts')
  expect(relative('/other/a.ts', '/proj')).toBeUndefined()
  expect(relative('./src/a.ts', '/proj')).toBe('src/a.ts')
})
