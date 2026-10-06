import type { Register } from 'claude-code'

// GAME MODE · LOOP BREAKER
//
// A loop is the same call failing the same way, again and again, with
// nothing changed in between. The loop breaker counts those:
//   2nd identical failure  LOOP 2/3: Claude is told to change something
//   3rd identical failure  LOOP 3/3: Claude is told the next one is blocked
//   4th identical run      refused (mode block) or let through with a note
//                          (mode warn)
// "Identical" ignores timings and temp paths but keeps counts, so
// "2 failed" → "1 failed" is progress, not a loop.
//
// What counts as a change: a successful Edit/Write (for commands) or a
// successful Read of the file (for an Edit that keeps missing its text)
// takes the call one strike back from the block. A new message from the
// user clears everything. /loop-breaker pass lets one refused call run.

type Mode = 'block' | 'warn' | 'off'

type Key = { id: string; label: string; kind: 'command' | 'file' }

type Streak = { signature: string; count: number; line: string; label: string; kind: Key['kind'] }

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const PASS_MS = 10 * 60 * 1000

export const register: Register = (on, options) => {
  let mode: Mode = modeOf(options.mode)
  const limit = Math.max(2, Math.min(10, Math.round(Number(options.limit ?? 3)) || 3))
  const streaks = new Map<string, Streak>()
  let passUntil = 0

  on('session.start', async ($, e, next) => {
    // A reload starts with no streaks, so a LOOP line kept from before it is stale.
    $.ui.status(undefined)
    const stored = await $.store.get('mode')
    if (stored === 'block' || stored === 'warn' || stored === 'off') mode = stored
    await $.command.register({
      name: 'loop-breaker',
      description: 'GAME MODE loop breaker: status, reset, block, warn, off, or pass the next refused call once',
      argumentHint: '[reset|block|warn|off|pass]',
    })
    return next(e)
  })

  // New words from the person are new information: every streak starts over.
  // The line is cleared even with no streak held: one may be left from before a reload.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'task-notification') {
      streaks.clear()
      $.ui.status(undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (mode === 'off') return next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const key = keyOf(tool, input)

    if (key !== undefined) {
      const held = streaks.get(key.id)
      if (held !== undefined && held.count >= limit && mode === 'block') {
        if ((await $.clock.now()) < passUntil) {
          passUntil = 0
          $.ui.log(`passed once by /loop-breaker pass — ${key.label}`)
        } else {
          $.ui.toast(`LOOP! ${key.label} 봉인 — 같은 실패 ${held.count}번 · /loop-breaker pass`)
          $.ui.log(`LOOP! blocked ${key.label} after ${held.count} identical failures`)
          return { deny: denyText(held) }
        }
      }
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (ran.isError !== true) {
      // A change of state: one strike back for what it may have fixed.
      if (WRITES.has(tool)) easeAll(streaks, 'command', limit)
      if (tool === 'Read') ease(streaks, fileKey('Edit', str(input, 'file_path')), limit)
      if (key !== undefined && streaks.delete(key.id) && streaks.size === 0) $.ui.status(undefined)
      return ran
    }
    if (key === undefined) return ran

    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
    const signature = signatureOf(text)
    const prev = streaks.get(key.id)
    const count = prev !== undefined && prev.signature === signature ? prev.count + 1 : 1
    const streak: Streak = { signature, count, line: lineOf(text), label: key.label, kind: key.kind }
    streaks.set(key.id, streak)

    if (count < limit - 1) return ran
    $.ui.status(`LOOP ${Math.min(count, limit)}/${limit} · ${key.label}`)
    const note = count >= limit ? sealedText(streak, mode) : warnText(streak, limit)
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'game-loop-breaker: the guard failed while checking this call, so it was stopped. Ask the user to check /loop-breaker.' },
  )

  on('command.run', { command: 'loop-breaker' }, async ($, e) => {
    const sub = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const byPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'

    if (sub === 'reset') {
      streaks.clear()
      $.ui.status(undefined)
      return { text: 'loop breaker: every streak cleared' }
    }
    if (sub === 'block' || sub === 'warn' || sub === 'off') {
      if (sub !== 'block' && !byPerson) return { text: 'Only you can loosen the loop breaker: type the command yourself.' }
      mode = sub
      await $.store.set('mode', mode)
      return { text: `loop breaker: ${mode}` }
    }
    if (sub === 'pass') {
      if (!byPerson) return { text: 'Only you can pass a refused call: type /loop-breaker pass yourself.' }
      passUntil = (await $.clock.now()) + PASS_MS
      return { text: 'The next call the loop breaker would refuse runs once (within 10 minutes).' }
    }
    if (sub !== '') return { text: `Unknown option "${sub}". Use reset, block, warn, off or pass.` }

    const open = [...streaks.values()].filter(s => s.count > 1)
    return {
      text: [
        `loop breaker: ${mode} · seal at ${limit} identical failures`,
        ...(open.length === 0 ? ['no loops'] : open.map(s => `  LOOP ${Math.min(s.count, limit)}/${limit} ${s.label} — ${s.line}`)),
        '/loop-breaker reset · block · warn · off · pass',
      ].join('\n'),
    }
  })
}

function modeOf(value: unknown): Mode {
  return value === 'warn' || value === 'off' ? value : 'block'
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function fileKey(tool: string, path: string | undefined): string | undefined {
  return path === undefined ? undefined : `${tool === 'MultiEdit' ? 'Edit' : tool}:${path}`
}

export function keyOf(tool: string, input: Record<string, unknown>): Key | undefined {
  if (tool === 'Bash') {
    const command = (str(input, 'command') ?? '').replace(/\s+/g, ' ').trim()
    if (command === '') return undefined
    return { id: `Bash:${command}`, label: command.length > 48 ? command.slice(0, 47) + '…' : command, kind: 'command' }
  }
  if (WRITES.has(tool)) {
    const path = str(input, 'file_path') ?? str(input, 'notebook_path')
    const id = fileKey(tool, path)
    if (id === undefined || path === undefined) return undefined
    return { id, label: `${tool.toUpperCase()} ${path.split(/[\\/]/).pop()}`, kind: 'file' }
  }
  if (tool === 'WebFetch') {
    const url = str(input, 'url')
    return url === undefined ? undefined : { id: `WebFetch:${url}`, label: `FETCH ${url}`, kind: 'command' }
  }
  return undefined
}

function ease(streaks: Map<string, Streak>, id: string | undefined, limit: number): void {
  const s = id === undefined ? undefined : streaks.get(id)
  if (s !== undefined && s.count >= limit) s.count = limit - 1
}

function easeAll(streaks: Map<string, Streak>, kind: Key['kind'], limit: number): void {
  for (const s of streaks.values()) if (s.kind === kind && s.count >= limit) s.count = limit - 1
}

/** The failure, minus what changes between identical runs (timings, temp paths, addresses). */
export function signatureOf(text: string): string {
  const clean = text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z?\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min)\b/g, '<dur>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/(?:\/private)?\/(?:tmp|var\/folders)\/\S+/g, '<tmp>')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > 1600 ? clean.slice(0, 800) + ' … ' + clean.slice(-800) : clean
}

/** The line that best says what failed. */
export function lineOf(text: string): string {
  const lines = text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^Exit code \d+$/.test(l))
  const best = lines.find(l => /error|fail|cannot|not found|exception|denied/i.test(l)) ?? lines[0] ?? '(no output)'
  return best.length > 120 ? best.slice(0, 119) + '…' : best
}

function times(n: number): string {
  return n === 1 ? 'once' : `${n} times`
}

function warnText(s: Streak, limit: number): string {
  return (
    `game-loop-breaker: LOOP ${s.count}/${limit} — \`${s.label}\` failed the same way ${times(s.count)} in a row ("${s.line}"). ` +
    'Running it again unchanged will not help: read the error, change something, or try a smaller check. ' +
    'One more identical failure and it will be blocked.'
  )
}

function sealedText(s: Streak, mode: Mode): string {
  return (
    `game-loop-breaker: LOOP ${s.count} — \`${s.label}\` failed the same way ${times(s.count)} in a row ("${s.line}"). ` +
    (mode === 'block'
      ? 'The next identical run will be blocked until something changes. '
      : 'This is a loop. ') +
    'Stop and say what you tried; then change the approach or ask the user.'
  )
}

function denyText(s: Streak): string {
  const change = s.kind === 'file' ? 'Read the file again to see its current text' : 'Change the code or the command first'
  return (
    `game-loop-breaker blocked this call: \`${s.label}\` already failed the same way ${times(s.count)} in a row ("${s.line}"). ` +
    `Running it again unchanged will not help. ${change}, try a smaller check, or ask the user. ` +
    'The block lifts after a change, when the user sends a new message, or when the user types /loop-breaker pass.'
  )
}
