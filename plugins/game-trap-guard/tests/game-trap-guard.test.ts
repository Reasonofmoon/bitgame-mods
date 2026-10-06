import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Fake secrets are assembled at run time so this file holds none.
const FAKE_ANTHROPIC = ['sk', 'ant', 'api03', 'A'.repeat(40)].join('-')
const FAKE_AWS = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'

function world(on: On) {
  mock.store(on)
  mock.clock(on, { now: 1_700_000_000_000 })
  const toasts: string[] = []
  const ran: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', (_, e) => {
    ran.push(String(e.tool))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return { toasts, ran }
}

/** The refusal a call came back with, as a deny or as an errored result. */
function refusal(r: { deny?: string; isError?: true; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

function guard(args: string, byPerson = true) {
  return {
    command: 'trap-guard',
    args,
    origin: byPerson ? { kind: 'composer' as const } : { kind: 'sdk' as const },
    presentation: { isFullscreen: false, columns: 120 },
  }
}

test('cat .env is refused with what to do instead; .env.example is fine', async ($, on) => {
  const { toasts, ran } = world(on)
  await start($)
  const refused = await $.tool.call({ tool: 'Bash', command: 'cat .env' })
  expect(refusal(refused)).toContain('game-trap-guard blocked this call: it prints a .env file into the conversation (.env)')
  expect(refusal(refused)).toContain('environment variable')
  expect(toasts[0]).toContain('TRAP!')

  await $.tool.call({ tool: 'Bash', command: 'cat .env.example' })
  await $.tool.call({ tool: 'Bash', command: 'grep -n PORT config/.env.sample' })
  expect(ran).toEqual(['Bash', 'Bash'])
})

test('a literal key in a command is refused and never repeated', async ($, on) => {
  const { ran } = world(on)
  await start($)
  const refused = await $.tool.call({
    tool: 'Bash',
    command: `curl -H "x-api-key: ${FAKE_ANTHROPIC}" https://api.anthropic.com/v1/models`,
  })
  expect(refusal(refused)).toContain('it writes an Anthropic API key into a command (sk-ant…, 53자)')
  expect(refusal(refused)).not.toContain(FAKE_ANTHROPIC)

  // Using the variable is the right way and runs.
  await $.tool.call({ tool: 'Bash', command: 'curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/models' })
  expect(ran).toEqual(['Bash'])
})

test('reading key files is refused; ordinary files are not', async ($, on) => {
  const { ran } = world(on)
  await start($)
  for (const file_path of ['/proj/.env', '/proj/.env.local', '/home/me/.ssh/id_ed25519', '/proj/certs/server.pem']) {
    const refused = await $.tool.call({ tool: 'Read', file_path })
    expect(refusal(refused)).toContain('game-trap-guard blocked this call')
  }
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/env.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/home/me/.ssh/id_ed25519.pub' })
  expect(ran).toEqual(['Read', 'Read'])
})

test('a key in a source file is refused; in an .env file it belongs', async ($, on) => {
  const { ran } = world(on)
  await start($)
  const refused = await $.tool.call({
    tool: 'Write',
    file_path: '/proj/src/config.ts',
    content: `export const AWS_KEY = '${FAKE_AWS}'\n`,
  })
  expect(refusal(refused)).toContain('it writes an AWS access key into config.ts')

  await $.tool.call({ tool: 'Write', file_path: '/proj/.env', content: `AWS_ACCESS_KEY_ID=${FAKE_AWS}\n` })
  expect(ran).toEqual(['Write'])
})

test('printing secret variables is refused; harmless env reads are not', async ($, on) => {
  const { ran } = world(on)
  await start($)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'echo "$OPENAI_API_KEY"' }))).toContain('game-trap-guard blocked this call')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'printenv' }))).toContain('game-trap-guard blocked this call')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'printenv GITHUB_TOKEN' }))).toContain('game-trap-guard blocked this call')
  await $.tool.call({ tool: 'Bash', command: 'printenv PATH' })
  await $.tool.call({ tool: 'Bash', command: "sed -i 's/PORT=3000/PORT=4000/' .env" })
  await $.tool.call({ tool: 'Bash', command: 'echo $HOME' })
  expect(ran).toEqual(['Bash', 'Bash', 'Bash'])
})

test('warn mode lets the call run and tells Claude', { options: { mode: 'warn' } }, async ($, on) => {
  const { toasts, ran } = world(on)
  await start($)
  const ran1 = await $.tool.call({ tool: 'Bash', command: 'cat .env' })
  expect(ran).toEqual(['Bash'])
  expect(ran1.context?.join('\n') ?? '').toContain('game-trap-guard (warn mode)')
  expect(toasts[0]).toContain('warn mode')
})

test('/trap-guard pass lets one refused call through, and only you can pass', async ($, on) => {
  const { ran } = world(on)
  await start($)
  const fromClaude = await $.command.run(guard('pass', false))
  expect(fromClaude.text).toContain('Only you can')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'cat .env' }))).toContain('game-trap-guard blocked this call')

  await $.command.run(guard('pass'))
  await $.tool.call({ tool: 'Bash', command: 'cat .env' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'cat .env' }))).toContain('game-trap-guard blocked this call')
  expect(ran).toEqual(['Bash'])
})

test('only you can switch it off; anyone can switch it back to block', async ($, on) => {
  const { ran } = world(on)
  await start($)
  expect((await $.command.run(guard('off', false))).text).toContain('Only you can')
  expect((await $.command.run(guard('off'))).text).toBe('trap guard: off')
  await $.tool.call({ tool: 'Bash', command: 'cat .env' })
  expect((await $.command.run(guard('block', false))).text).toBe('trap guard: block')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'cat .env' }))).toContain('game-trap-guard blocked this call')
  expect(ran).toEqual(['Bash'])
})
