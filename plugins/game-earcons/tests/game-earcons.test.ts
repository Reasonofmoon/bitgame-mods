import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

function world(on: On, opts: { verdict?: 'allow' | 'ask' | 'deny'; fail?: string; deny?: string } = {}) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const played: { asset: string | undefined; gain: number | undefined }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('audio.play', (_, e) => {
    played.push({ asset: e.clip.asset, gain: e.gain })
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.check', () => ({ decision: opts.verdict ?? 'allow' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => {
    if (opts.deny !== undefined) return { deny: opts.deny }
    if (opts.fail !== undefined) return { isError: true as const, result: opts.fail, text: opts.fail }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('command.run', (_, e) => ({ text: e.args === 'list' ? '1. x' : '◆ SAVE POINT · quest\n...' }))
  const cues = () => played.map(p => p.asset)
  return { clock, played, cues }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function turn(durationMs: number, reason: 'answer' | 'error' | 'aborted' = 'answer', agentId?: string) {
  return { answer: 'ok', durationMs, isAborted: reason === 'aborted', turnId: 't1', reason, ...(agentId ? { agentId } : {}) }
}

function earcons(args: string) {
  return { command: 'earcons', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
}

test('a permission prompt and a question both say "ask"', async ($, on) => {
  const { cues, clock } = world(on, { verdict: 'ask' })
  await start($)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'toolu_1' })
  await clock.advance(1000)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(cues()).toEqual(['sounds/ask.wav', 'sounds/ask.wav'])
})

test('an allowed call and a permission query stay quiet', async ($, on) => {
  const { cues } = world(on, { verdict: 'allow' })
  await start($)
  await $.tool.check({ tool: 'Read', input: { file_path: '/proj/a' }, tool_use_id: 'toolu_1' })
  expect(cues()).toEqual([])
})

test('casual: long turns say "done", short ones do not, errors say "miss"', async ($, on) => {
  const { cues, clock } = world(on)
  await start($)
  await $.turn.complete(turn(5_000))
  await $.turn.complete(turn(45_000))
  await clock.advance(1000)
  await $.turn.complete(turn(1_000, 'error'))
  await $.turn.complete(turn(90_000, 'answer', 'agent-1'))
  expect(cues()).toEqual(['sounds/done.wav', 'sounds/miss.wav'])
})

test('a guard refusal says "block"', async ($, on) => {
  const { cues } = world(on, { deny: 'game-barrier blocked this call: it discards uncommitted changes (git reset --hard).' })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(cues()).toEqual(['sounds/block.wav'])
})

test('a plain tool failure is quiet in casual', async ($, on) => {
  const { cues } = world(on, { fail: 'Exit code 1' })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(cues()).toEqual([])
})

test('hardcore adds failures, file changes and every turn', { options: { intensity: 'hardcore', volume: 0.3 } }, async ($, on) => {
  const { played, clock } = world(on, { fail: 'Exit code 1' })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await clock.advance(1000)
  await $.turn.complete(turn(2_000))
  expect(played).toEqual([
    { asset: 'sounds/miss.wav', gain: 0.3 },
    { asset: 'sounds/done.wav', gain: 0.3 },
  ])
})

test('a save says "save"; the list does not', async ($, on) => {
  const { cues } = world(on)
  await start($)
  await $.command.run({ command: 'save', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await $.command.run({ command: 'save', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(cues()).toEqual(['sounds/save.wav'])
})

test('the same cue twice within 400 ms plays once', async ($, on) => {
  const { cues } = world(on)
  await start($)
  await $.turn.complete(turn(60_000))
  await $.turn.complete(turn(60_000))
  expect(cues()).toEqual(['sounds/done.wav'])
})

test('/earcons off mutes; /earcons test plays each cue in turn', async ($, on) => {
  const { cues, clock } = world(on)
  await start($)
  expect((await $.command.run(earcons('off'))).text).toBe('earcons off')
  await $.turn.complete(turn(60_000))
  expect(cues()).toEqual([])
  await $.command.run(earcons('test'))
  await clock.advance(6000)
  expect(cues()).toEqual(['ask', 'done', 'miss', 'block', 'save', 'hit'].map(c => `sounds/${c}.wav`))
})

test('off is silent', { options: { intensity: 'off' } }, async ($, on) => {
  const { cues } = world(on, { verdict: 'ask' })
  await start($)
  await $.tool.check({ tool: 'Bash', input: { command: 'x' }, tool_use_id: 'toolu_1' })
  await $.turn.complete(turn(60_000, 'error'))
  expect(cues()).toEqual([])
})
