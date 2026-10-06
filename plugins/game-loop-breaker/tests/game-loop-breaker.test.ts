import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine's side: each Bash command fails with the output the test sets.
function world(on: On) {
  mock.store(on)
  mock.clock(on, { now: 1_700_000_000_000 })
  const ran: string[] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const outputs = new Map<string, string>()
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', (_, e) => {
    const key = String(e.tool) === 'Bash' ? String((e as { command?: string }).command) : `${String(e.tool)}:${String((e as { file_path?: string }).file_path)}`
    ran.push(key)
    const failure = outputs.get(key.replace(/\s+/g, ' ').trim())
    if (failure !== undefined) return { isError: true as const, result: failure, text: failure }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return { ran, toasts, statuses, outputs }
}

function refusal(r: { deny?: string; isError?: true; text?: string }): string | undefined {
  return r.deny
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const FAIL = 'Exit code 1\nFAIL src/auth.test.ts (3.21 s)\n  ✕ refresh keeps the session (12 ms)\nTests: 2 failed, 38 passed'

test('the same failure warns at 2, seals at 3, blocks the 4th run', async ($, on) => {
  const { ran, outputs, toasts } = world(on)
  await start($)
  outputs.set('npm test', FAIL)

  const first = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(first.context).toBeUndefined()
  const second = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(second.context?.join('\n')).toContain('LOOP 2/3 — `npm test` failed the same way 2 times in a row ("FAIL src/auth.test.ts (3.21 s)")')
  const third = await $.tool.call({ tool: 'Bash', command: 'npm  test ' })
  expect(third.context?.join('\n')).toContain('The next identical run will be blocked')

  const fourth = refusal(await $.tool.call({ tool: 'Bash', command: 'npm test' }))
  expect(fourth).toContain('game-loop-breaker blocked this call: `npm test` already failed the same way 3 times')
  expect(ran).toEqual(['npm test', 'npm test', 'npm  test ', ])
  expect(toasts[0]).toContain('LOOP!')
})

test('timings do not make a failure new; changed counts do', async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  outputs.set('npm test', FAIL)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  outputs.set('npm test', FAIL.replace('3.21 s', '4.02 s').replace('12 ms', '15 ms'))
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  outputs.set('npm test', FAIL.replace('2 failed, 38 passed', '1 failed, 39 passed'))
  const progressed = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(progressed.context).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(ran).toHaveLength(4)
})

test('an edit after the seal lets the command run once more', async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  outputs.set('npm test', FAIL)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm test' }))).toBeDefined()

  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' })
  const retried = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(retried.context?.join('\n')).toContain('LOOP 3')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm test' }))).toBeDefined()
  expect(ran.filter(k => k === 'npm test')).toHaveLength(4)
})

test('success and a new message from you clear the streak', async ($, on) => {
  const { ran, outputs, statuses } = world(on)
  await start($)
  outputs.set('npm test', FAIL)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.prompt.submit({ text: 'the fixture was wrong, try again', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(ran).toHaveLength(4)
  expect(statuses).toContain(undefined)

  outputs.delete('npm test')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  outputs.set('npm test', FAIL)
  const fresh = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(fresh.context).toBeUndefined()
})

test('an Edit that keeps missing its text is sealed until the file is read again', async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  const miss = 'String to replace not found in file.\nString: const a = 1'
  outputs.set('Edit:/proj/src/a.ts', miss)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: `x${i}`, new_string: 'y' })
  const blocked = refusal(await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'x3', new_string: 'y' }))
  expect(blocked).toContain('Read the file again')

  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
  outputs.delete('Edit:/proj/src/a.ts')
  const fixed = await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'const a = 1', new_string: 'const a = 2' })
  expect(refusal(fixed)).toBeUndefined()
  expect(ran.filter(k => k.startsWith('Edit:'))).toHaveLength(4)
})

test('warn mode notes the loop but runs', { options: { mode: 'warn' } }, async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  outputs.set('npm test', FAIL)
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(ran).toHaveLength(4)
})

test('limit 2 seals on the second identical failure', { options: { limit: 2 } }, async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  outputs.set('make', 'Exit code 2\nmake: *** No rule to make target `all`.  Stop.')
  const first = await $.tool.call({ tool: 'Bash', command: 'make' })
  expect(first.context?.join('\n')).toContain('LOOP 1/2')
  await $.tool.call({ tool: 'Bash', command: 'make' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'make' }))).toBeDefined()
  expect(ran).toEqual(['make', 'make'])
})

test('/loop-breaker pass is yours and lasts one call; reset clears all', async ($, on) => {
  const { ran, outputs } = world(on)
  await start($)
  outputs.set('npm test', FAIL)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const asClaude = await $.command.run({ command: 'loop-breaker', args: 'pass', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(asClaude.text).toContain('Only you can')
  await $.command.run({ command: 'loop-breaker', args: 'pass', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm test' }))).toBeDefined()

  const status = await $.command.run({ command: 'loop-breaker', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(status.text).toContain('LOOP 3/3 npm test')
  await $.command.run({ command: 'loop-breaker', args: 'reset', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 100 } })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(ran).toHaveLength(5)
})
