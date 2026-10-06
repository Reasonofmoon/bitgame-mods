import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import { padWide, widthOf } from '../hooks/register'

type Outcome = 'ok' | 'fail' | 'guard'

function world(on: On, kept: Record<string, unknown> = {}) {
  mock.store(on, kept)
  mock.clock(on, { now: 1_700_000_000_000 })
  const toasts: string[] = []
  const plan: Outcome[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('tool.call', () => {
    const outcome = plan.shift() ?? 'ok'
    if (outcome === 'guard') return { deny: 'game-barrier blocked this call: it discards uncommitted changes.' }
    if (outcome === 'fail') return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1' }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  return {
    toasts,
    async bash($: Engine, command: string, outcome: Outcome = 'ok') {
      plan.push(outcome)
      await $.tool.call({ tool: 'Bash', command })
    },
  }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const done = { answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' as const }
const achievements = { command: 'achievements', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

test('a comeback: a failed command passes after a change', async ($, on) => {
  const w = world(on)
  await start($)
  await w.bash($, 'npm test', 'fail')
  await w.bash($, 'npm test')
  expect(w.toasts).toEqual([])
  await w.bash($, 'npm test', 'fail')
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' })
  await w.bash($, 'npm test')
  expect(w.toasts).toEqual(['★ ACHIEVEMENT 역전승 — 실패한 명령을 고친 뒤 같은 명령 통과'])
})

test('ten clean calls in a row; the record is kept', async ($, on) => {
  const w = world(on)
  await start($)
  for (let i = 0; i < 10; i++) await w.bash($, `echo ${i}`)
  expect(w.toasts).toEqual(['★ ACHIEVEMENT 10 콤보 — 성공한 행동 10번 연속'])
  await w.bash($, 'echo again')
  expect(w.toasts).toHaveLength(1)
})

test('commits count only in turns with no guard refusal', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const w = world(on, { book: { unlocked: {}, safeCommits: 8, bestCombo: 0 } })
  await start($)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await w.bash($, 'git commit -m "x"')
  await w.bash($, 'git push --force', 'guard')
  await $.turn.complete(done)
  expect(w.toasts).toEqual([])
  await $.turn.start({ text: 'b', turnId: 't2' })
  await w.bash($, 'git add -A && git commit -m "y"')
  await $.turn.complete(done)
  expect(w.toasts).toEqual(['안전 운전 9/10'])
  await $.turn.start({ text: 'c', turnId: 't3' })
  await w.bash($, 'git -c user.name=x commit -m "z"')
  await $.turn.complete(done)
  expect(w.toasts.at(-1)).toBe('★ ACHIEVEMENT 안전 운전 — 가드 거절이 없던 턴의 커밋 10번')
})

test('a rest at low HP, before it falls under 10%', async ($, on) => {
  const w = world(on)
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 78 }, rateLimits: [], changed: ['context'] })
  // As /compact raises it: the person's own rest.
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(w.toasts).toEqual(['★ ACHIEVEMENT 제때 휴식 — HP가 10% 아래로 떨어지기 전에 /compact'])
})

test('/achievements lists them with progress', async ($, on) => {
  world(on, { book: { unlocked: { comeback: 1 }, safeCommits: 4, bestCombo: 7 } })
  await start($)
  const out = await $.command.run(achievements)
  expect(out.text).toContain('ACHIEVEMENTS · 1/5')
  expect(out.text).toContain('★ 역전승')
  expect(out.text).toContain('· 안전 운전 — 가드 거절이 없던 턴의 커밋 10번 · 4/10')
  expect(out.text).toContain('· 10 콤보 — 성공한 행동 10번 연속 · 최고 7')
  const ui = await $.ui.mount({ plugin: 'game-achievement', surface: 'terminal', component: 'CommandOutput', props: { command: 'achievements', args: '', text: out.text ?? '', isErrored: false } })
  const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(shown.slice(0, 2)).toEqual(['★ ACHIEVEMENTS', '1/5'])
  expect(shown).toContain('CLEAR')
})

test('names line up by the columns they take', () => {
  expect(widthOf('첫 세이브')).toBe(9)
  expect(widthOf('10 콤보')).toBe(7)
  expect(widthOf(padWide('10 콤보', 9))).toBe(9)
})
