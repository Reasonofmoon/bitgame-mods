import { expect, mock, test } from 'claude-code/testing'
import { cueOf } from '../hooks/register'
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

// Refusals, failures and saves are heard from the rows the transcript keeps (session.append).
const result = (text: string, isError: boolean) => [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text, is_error: isError }]

test('a guard\'s refusal kept as a tool result is "block", in every intensity', () => {
  const refused = result('game-barrier blocked this call: it discards uncommitted changes (git reset --hard).', true)
  expect(cueOf('tool-result', refused, 'casual')).toBe('block')
  expect(cueOf('tool-result', [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'game-trap-guard blocked this call: …' }], is_error: true }], 'casual')).toBe('block')
})

test('a plain failure is "miss" only in hardcore; a success is nothing', () => {
  expect(cueOf('tool-result', result('Exit code 1', true), 'casual')).toBeUndefined()
  expect(cueOf('tool-result', result('Exit code 1', true), 'hardcore')).toBe('miss')
  expect(cueOf('tool-result', result('ok', false), 'hardcore')).toBeUndefined()
})

test('a save point row is "save"; other command output is nothing', () => {
  const row = (text: string) => [{ type: 'text', text }]
  expect(cueOf('command', row('<local-command-stdout>◆ SAVE POINT · quest\nSLOT 1/1\n[PASSWORD]\nresume</local-command-stdout>'), 'casual')).toBe('save')
  expect(cueOf('command', row('1. 2026-10-06 21:25 · quest'), 'casual')).toBeUndefined()
  expect(cueOf('response', row('◆ SAVE POINT · quoted by Claude\n[PASSWORD]'), 'casual')).toBeUndefined()
})

test('hardcore: a file change is "hit"', { options: { intensity: 'hardcore', volume: 0.3 } }, async ($, on) => {
  const { played } = world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/a.ts', content: 'x' })
  expect(played).toEqual([{ asset: 'sounds/hit.wav', gain: 0.3 }])
})
