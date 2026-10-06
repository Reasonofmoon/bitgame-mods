import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { patternsOf, playTime } from '../hooks/register'

const T0 = 1_700_000_000_000

function world(on: On, opts: { branch?: string | null; changed?: number } = {}) {
  const clock = mock.clock(on, { now: T0 })
  const statuses: (string | undefined)[] = []
  let branch = opts.branch === undefined ? 'feat/login' : opts.branch
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: T0, context: { window: 200_000 }, rateLimits: [] } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const out = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const args = e.argv.join(' ')
    if (args === 'git rev-parse --abbrev-ref HEAD') return branch === null ? out(128, '') : out(0, `${branch}\n`)
    if (args === 'git rev-parse --short HEAD') return out(0, 'abc1234\n')
    if (args === 'git status --porcelain') return out(0, ' M src/a.ts\n?? b.ts\n'.repeat(1).split('\n').slice(0, opts.changed ?? 2).join('\n'))
    return out(1, '')
  })
  return { clock, statuses, checkout: (to: string | null) => (branch = to) }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

test('the status line names the branch and the play time, and keeps time', async ($, on) => {
  const { clock, statuses } = world(on)
  await start($)
  expect(statuses.at(-1)).toBe('MAP feat/login · 플레이 0:00')
  await clock.advance(42 * 60_000)
  expect(statuses.at(-1)).toBe('MAP feat/login · 플레이 0:42')
  await clock.advance(23 * 60_000)
  expect(statuses.at(-1)).toBe('MAP feat/login · 플레이 1:05')
})

test('a protected branch is marked; a checkout shows after the turn', async ($, on) => {
  const { statuses, checkout } = world(on)
  await start($)
  checkout('main')
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' })
  expect(statuses.at(-1)).toBe('MAP main ⚠ 보호 · 플레이 0:00')
  checkout('release/2.1')
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' })
  expect(statuses.at(-1)).toBe('MAP release/2.1 ⚠ 보호 · 플레이 0:00')
  checkout('HEAD')
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' })
  expect(statuses.at(-1)).toBe('MAP @abc1234 · 플레이 0:00')
})

test('outside a repository the play time stays', async ($, on) => {
  const { statuses } = world(on, { branch: null })
  await start($)
  expect(statuses.at(-1)).toBe('MAP 저장소 밖 · 플레이 0:00')
})

test('hardcore counts the changed files; /map tells it all', { options: { intensity: 'hardcore' } }, async ($, on) => {
  const { statuses } = world(on, { branch: 'master', changed: 2 })
  await start($)
  expect(statuses.at(-1)).toBe('MAP master ⚠ 보호 · 플레이 0:00 · 변경 2')
  const map = await $.command.run({ command: 'map', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(map.text).toContain('MAP master ⚠ 보호 브랜치')
  expect(map.text).toContain('git switch -c')
})

test('off shows nothing', { options: { intensity: 'off' } }, async ($, on) => {
  const { statuses } = world(on)
  await start($)
  expect(statuses).toEqual([])
})

test('patterns and times', () => {
  const p = patternsOf('main, release/*')
  expect(p.some(r => r.test('release/2.1'))).toBe(true)
  expect(p.some(r => r.test('release/2.1/hotfix'))).toBe(false)
  expect(p.some(r => r.test('maintenance'))).toBe(false)
  expect(playTime(3 * 3600_000 + 7 * 60_000)).toBe('3:07')
})
