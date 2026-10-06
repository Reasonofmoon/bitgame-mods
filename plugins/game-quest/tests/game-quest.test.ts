import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

function world(on: On, kept: Record<string, unknown> = {}) {
  mock.store(on, kept)
  mock.clock(on, { now: 1_700_000_000_000 })
  const opened: string[] = []
  let taskId = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++taskId), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return { opened }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const PANE = (surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'game-quest',
  surface,
  component: 'Pane' as const,
  requestId: 'quest',
  props: { title: 'QUEST', isFocused: false, bodyColumns: 60, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 }, view: {} },
})

async function pane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount(PANE(surface))
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return shown
}

function quest(command: string, args = '') {
  return { command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
}

test('a todo list becomes the quest log: done, in progress, to do, and the BOSS', async ($, on) => {
  const { opened } = world(on)
  await start($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '저장소 구조 파악', status: 'completed', activeForm: '파악 중' },
      { content: '토큰 만료 단위 수정', status: 'in_progress', activeForm: '단위를 맞추는 중' },
      { content: '전체 테스트 통과', status: 'pending', activeForm: '테스트 중' },
    ],
  })
  const out = await $.command.run(quest('quest'))
  expect(opened).toEqual(['quest'])
  expect(out.text).toContain('QUEST LOG · 1/3 클리어')
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await pane($, surface)).toEqual(['QUEST LOG', '1/3 클리어', '███░░░░░░░', '✓', '저장소 구조 파악', '▶', '토큰 만료 단위 수정', '·', '전체 테스트 통과', 'BOSS'])
  }
})

test('tasks made with TaskCreate and moved with TaskUpdate; ALL CLEAR at the end', async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'TaskCreate', subject: '버그 재현', description: 'x' })
  await $.tool.call({ tool: 'TaskCreate', subject: '수정', description: 'y' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  expect((await pane($)).slice(0, 2)).toEqual(['QUEST LOG', '1/2 클리어'])
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
  expect((await pane($)).at(-1)).toBe('ALL CLEAR!')
})

test('the log is kept for the project and carried into the next session', async ($, on) => {
  world(on, {
    'log:/proj': {
      quests: [
        { id: 'todo-0', text: '로그인 고치기', doing: '', status: 'completed' },
        { id: 'todo-1', text: '배포', doing: '', status: 'pending' },
      ],
      updatedAt: 1,
    },
  })
  await start($)
  expect(await pane($)).toContain('지난 세션에서 이어짐')
  // A new list from Claude replaces the carried one.
  await $.tool.call({ tool: 'TaskCreate', subject: '새 일', description: 'z' })
  const shown = await pane($)
  expect(shown).not.toContain('지난 세션에서 이어짐')
  expect(shown).toContain('새 일')
  expect(shown).not.toContain('배포')
})

test('/quest clear empties the log', async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] })
  expect((await $.command.run(quest('quest', 'clear'))).text).toBe('quest log cleared')
  expect((await pane($)).slice(0, 3)).toEqual(['QUEST LOG', '퀘스트 없음', 'Claude가 할 일 목록을 만들면 여기 퀘스트로 나타납니다.'])
})

test('hardcore shows what the quest in progress is doing', { options: { intensity: 'hardcore' } }, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: '수정', status: 'in_progress', activeForm: '단위를 맞추는 중' }] })
  expect(await pane($)).toContain('수정 · 단위를 맞추는 중')
})
