import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const NOW = Date.UTC(2026, 9, 6, 11, 15) // 2026-10-06 20:15 KST
const DAY = 86_400_000

const REPLY = JSON.stringify({
  title: '로그인 버그 수정',
  done: ['토큰 만료 원인 찾기', 'auth.ts 수정'],
  todo: ['npm test 전부 통과', '커밋'],
  decide: ['만료 단위를 초로 통일할지'],
  resume: 'src/auth.ts의 refresh()부터 이어서, npm test 실패 2건을 고쳐줘',
  artifacts: ['src/auth.ts', 'branch fix/token-expiry'],
})

type Row = { role: 'user' | 'assistant'; text: string; toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown> }[] }

type Opts = { store?: Record<string, unknown>; reply?: string | null; root?: string; rows?: Row[]; turns?: number }

function world(on: On, opts: Opts = {}) {
  mock.store(on, opts.store ?? {})
  const clock = mock.clock(on, { now: NOW })
  const statuses: (string | undefined)[] = []
  const suggested: string[] = []
  const filled: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: opts.root ?? '/proj' }))
  on('session.turns', () => ({ value: opts.turns ?? 12 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 38 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('model.fork', () => ({
    value:
      opts.reply === null
        ? { isAnswered: false as const, reason: 'nothing-to-fork' as const }
        : {
            isAnswered: true as const,
            text: opts.reply ?? REPLY,
            usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
          },
  }))
  const completions: { model: string; prompt: string }[] = []
  on('session.messages', () => ({ value: opts.rows ?? [] }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('model.complete', (_, e) => {
    completions.push({ model: e.model, prompt: e.prompt })
    return {
      value: {
        isAnswered: true as const,
        text: REPLY,
        usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: suggested.length > 1 }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine') as RenderElement
  })
  return { clock, statuses, suggested, filled, completions, copied }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function run(command: string, args = '') {
  return { command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
}

function save(title: string, savedAt: number, resume = `resume ${title}`) {
  return { v: 1, savedAt, root: '/proj', title, done: [], todo: [], decide: [], resume, artifacts: [], turns: 3, usd: null, contextUsed: null }
}

test('/save writes the save screen and keeps it for the project', async ($, on) => {
  const { copied } = world(on)
  await start($)
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'true' })
  const out = await $.command.run(run('save'))
  const text = out.text ?? ''
  const lines = text.split('\n')
  expect(lines[0]).toBe('◆ SAVE POINT · 로그인 버그 수정')
  expect(lines[1]).toContain('SLOT 1/1 · ')
  expect(lines[1]).toContain('DAY 1 · LV 2 (5) · TURN 12 · $1.50 · CTX 38%')
  expect(lines[2]).toMatch(/^\[CODE\] SP02-[A-Z0-9]{4}-MOON · COPIED$/)
  expect(text).toContain('[PASSWORD]\nsrc/auth.ts의 refresh()부터 이어서, npm test 실패 2건을 고쳐줘')
  expect(copied).toEqual(['src/auth.ts의 refresh()부터 이어서, npm test 실패 2건을 고쳐줘'])
  const code = /SP02-[A-Z0-9]{4}-MOON/.exec(lines[2] ?? '')?.[0]

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'game-save-point',
      surface,
      component: 'CommandOutput',
      props: { command: 'save', args: '', text, isErrored: false },
    })
    const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(shown[0]).toBe('◆ ★ SAVE POINT ★')
    expect(shown).toContain('QUEST · 로그인 버그 수정')
    expect(shown).toContain('LV 02 █░░░░░░░░░ EXP')
    expect(shown).toContain('CTX ████░░░░░░ 38%')
    expect(shown).toContain('+120 EXP')
    expect(shown).toContain('auth.ts 수정')
    expect(shown).toContain('남은 퀘스트 2')
    expect(shown).toContain('MAIN')
    expect(shown).toContain('▶ ')
    expect(shown).toContain('만료 단위를 초로 통일할지')
    expect(shown).toContain('◆ auth.ts')
    expect(shown).toContain('▣ branch fix/token-…')
    expect(shown).toContain(code)
    expect(shown).toContain(' COPIED! ')
    expect(shown).toContain(`▸ /load ${code} · 빈 입력창 Tab 이어하기`)
    expect(shown).toContain('▶ 「src/auth.ts의 refresh()부터 이어서, npm test 실패 2건을 고쳐줘」')
    await ui.unmount()
  }

  const list = await $.command.run(run('save', 'list'))
  expect(list.text).toContain('1. ')
  expect(list.text).toContain(`로그인 버그 수정 · ${code}`)
})

test('a row that leads with the answering plugins\' names is still drawn as the save screen', async ($, on) => {
  world(on)
  await start($)
  const out = await $.command.run(run('save'))
  const ui = await $.ui.mount({
    plugin: 'game-save-point',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'save', args: '', text: 'game-save-point+game-earcons: ' + (out.text ?? ''), isErrored: false },
  })
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toBe('◆ ★ SAVE POINT ★')
})

test('a reply that is not JSON is kept as the resume prompt', async ($, on) => {
  world(on, { reply: 'Continue with the refresh() fix in src/auth.ts.' })
  await start($)
  const out = await $.command.run(run('save'))
  expect(out.text).toContain('◆ SAVE POINT · save')
  expect(out.text).toContain('[PASSWORD]\nContinue with the refresh() fix in src/auth.ts.')
})

test('a fenced JSON reply is read', async ($, on) => {
  world(on, { reply: '```json\n' + REPLY + '\n```' })
  await start($)
  expect((await $.command.run(run('save'))).text).toContain('◆ SAVE POINT · 로그인 버그 수정')
})

test('nothing to save before the first turn', async ($, on) => {
  const { completions } = world(on, { reply: null })
  await start($)
  expect((await $.command.run(run('save'))).text).toBe('Nothing to save yet: this session has no turns.')
  expect(completions).toEqual([])
})

test('a resumed session with nothing to fork saves from its stored transcript', async ($, on) => {
  const { completions } = world(on, {
    reply: null,
    rows: [
      { role: 'user', text: 'notes.txt에 로그인 버그 메모를 써줘', toolUses: [] },
      { role: 'assistant', text: '만들었습니다.', toolUses: [{ tool_use_id: 'toolu_1', tool: 'Write', input: { file_path: '/proj/notes.txt', content: 'x' } }] },
    ],
  })
  await start($)
  const out = await $.command.run(run('save'))
  expect(out.text).toContain('◆ SAVE POINT · 로그인 버그 수정')
  expect(completions).toHaveLength(1)
  expect(completions[0]?.model).toBe('claude-opus-5-5')
  expect(completions[0]?.prompt).toContain('USER: notes.txt에 로그인 버그 메모를 써줘')
  expect(completions[0]?.prompt).toContain('CLAUDE: 만들었습니다. [tools: Write(/proj/notes.txt)]')
})

test('a new session offers the latest save on Tab and names it in the status line', async ($, on) => {
  const { clock, statuses, suggested } = world(on, {
    store: { slots: { '/proj': [save('로그인 버그 수정', NOW - 2 * 3_600_000, 'refresh()부터 이어서')], '/other': [save('다른 일', NOW)] } },
  })
  await start($)
  expect(statuses[0]).toBe('◆ SAVE 2시간 전 · 로그인 버그 수정 · Tab 이어하기 · /load')

  await (clock as MockClock).advance(800)
  expect(suggested).toEqual(['refresh()부터 이어서'])
  await (clock as MockClock).advance(2000)
  expect(suggested).toEqual(['refresh()부터 이어서', 'refresh()부터 이어서'])
  await (clock as MockClock).advance(10_000)
  expect(suggested).toHaveLength(2)

  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(statuses.at(-1)).toBeUndefined()
})

test('an old save is not offered', async ($, on) => {
  const { clock, statuses, suggested } = world(on, { store: { slots: { '/proj': [save('old', NOW - 20 * DAY)] } } })
  await start($)
  await (clock as MockClock).advance(5000)
  expect(statuses).toEqual([])
  expect(suggested).toEqual([])
})

test('/load puts a save\'s resume prompt in the prompt box', async ($, on) => {
  const { filled } = world(on, { store: { slots: { '/proj': [save('new', NOW - 1000, 'newest'), save('older', NOW - 5000, 'older one')] } } })
  await start($)
  const latest = await $.command.run(run('load'))
  expect(latest.text).toContain('The resume prompt is in the prompt box')
  await $.command.run(run('load', '2'))
  expect(filled).toEqual(['newest', 'older one'])
  expect((await $.command.run(run('load', '9'))).text).toBe('There are 2 saves; /save list shows them.')
})

test('off leaves the output row to the engine', { options: { intensity: 'off' } }, async ($, on) => {
  world(on)
  await start($)
  const out = await $.command.run(run('save'))
  const ui = await $.ui.mount({
    plugin: 'game-save-point',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'save', args: '', text: out.text ?? '', isErrored: false },
  })
  expect((await ui.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })
})

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 110, scroll: { offset: 0, bodyRows: 13 }, view: {} },
}

test('a new session in a folder with saves opens on the title screen; CONTINUE fills the latest resume prompt', async ($, on) => {
  const { filled } = world(on, {
    turns: 0,
    store: { slots: { '/proj': [{ ...save('로그인 버그 수정', NOW - 3_600_000, 'refresh()부터'), hits: 30, day: 2, todo: ['a', 'b'] }, save('older', NOW - DAY, 'older one')] } },
  })
  await start($)
  const ui = await $.ui.mount({ plugin: 'game-save-point', surface: 'terminal', ...BAND })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(shown).toContain('◆ S A V E   P O I N T ◆')
  expect(shown).toContain('▸ SLOT 1')
  expect(shown).toContain('LV 03 · DAY 2')
  expect(shown).toContain('로그인 버그 수정 · 퀘스트 2')
  expect(shown).toContain('- NO DATA -')
  expect(shown).toContain('PRESS START')
  expect(shown).toContain('engine')
  await ui.press({ key: 'continue' })
  expect(filled).toEqual(['refresh()부터'])
  await ui.unmount()

  const after = await $.ui.mount({ plugin: 'game-save-point', surface: 'terminal', ...BAND })
  expect((await after.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })
})

test('LOAD shows a button per slot; NEW GAME and the first prompt close the title', async ($, on) => {
  const { filled } = world(on, { turns: 0, store: { slots: { '/proj': [save('new', NOW - 1000, 'newest'), save('older', NOW - 5000, 'older one')] } } })
  await start($)
  const ui = await $.ui.mount({ plugin: 'game-save-point', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Button', key: 'load2' })).toBeUndefined()
  await ui.press({ key: 'load' })
  await ui.press({ key: 'load2' })
  expect(filled).toEqual(['older one'])
  await ui.unmount()

  const again = await $.ui.mount({ plugin: 'game-save-point', surface: 'terminal', ...BAND })
  expect((await again.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })
})

test('the first prompt closes the title screen', async ($, on) => {
  world(on, { turns: 0, store: { slots: { '/proj': [save('new', NOW - 1000, 'newest')] } } })
  await start($)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount({ plugin: 'game-save-point', surface: 'terminal', ...BAND })
  expect((await ui.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['engine'] })
})

test('/load takes a password, from any project', async ($, on) => {
  const { filled } = world(on, { store: { slots: { '/other': [{ ...save('다른 일', NOW - 1000, 'other resume'), code: 'SP03-ABCD-MOON' }] } } })
  await start($)
  const out = await $.command.run(run('load', 'sp03-abcd-moon'))
  expect(out.text).toContain('◆ SAVE POINT · 다른 일')
  expect(filled).toEqual(['other resume'])
  expect((await $.command.run(run('load', 'SP09-ZZZZ-MOON'))).text).toContain('No save has the password SP09-ZZZZ-MOON')
})
