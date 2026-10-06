import type { EngineInterface, Register } from 'claude-code'

// GAME MODE · EARCONS
//
// 8-bit cues so you know what the session needs without watching it:
//   ask    a permission prompt or a question from Claude is waiting on you
//   done   a turn finished (casual: turns of at least `minTurnSeconds`)
//   miss   a turn ended in an API error (hardcore: also every failed tool call)
//   block  a GAME MODE guard (trap guard, barrier, loop breaker) refused a call
//   save   /save made a save point
//   hit    a file changed (hardcore only)
// Clips are the plugin's own WAV files (sounds/). macOS plays them through the
// engine (afplay). Windows plays them with PowerShell's SoundPlayer, the samples
// scaled to the volume first. Linux plays them with paplay (PulseAudio or
// PipeWire, at the volume) or else aplay (ALSA, at the mixer's level).

type Cue = 'ask' | 'done' | 'miss' | 'block' | 'save' | 'hit'

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const BLOCKED = /\bgame-(?:trap-guard|barrier|loop-breaker)\b.*\bblocked\b|^(?:TRAP|BARRIER|LOOP)!/
const GAP_MS = 400

type Player = {
  intensity: 'off' | 'casual' | 'hardcore'
  gain: number
  isMuted: boolean
  lastAt: Map<Cue, number>
  /** Where the clips play, found on the first cue. */
  platform: Platform | undefined
  /** Linux: the player that worked, or `none` once both failed. */
  linux: 'paplay' | 'aplay' | 'none' | undefined
  /** Windows: each clip scaled to the volume, as base64, read once. */
  scaled: Map<Cue, string>
}

/** `engine`: the engine's own player (macOS; elsewhere silent). */
export type Platform = 'engine' | 'windows' | 'linux'

// Reads a WAV from stdin as base64 and plays it to the end. No file is written.
const PS_PLAY =
  '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
  '$s=New-Object System.IO.MemoryStream(,$b);' +
  '(New-Object System.Media.SoundPlayer($s)).PlaySync()'

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (block === null || typeof block !== 'object') return ''
      const b = block as { type?: unknown; text?: unknown; content?: unknown }
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (b.type === 'tool_result') return textOf(b.content)
      return ''
    })
    .join('\n')
}

/** The cue a stored row calls for: a guard's refusal, a failed call (hardcore), a new save. */
export function cueOf(door: string, content: readonly unknown[], intensity: Player['intensity']): Cue | undefined {
  if (door === 'tool-result') {
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      const b = block as { type?: unknown; is_error?: unknown; content?: unknown }
      if (b.type !== 'tool_result' || b.is_error !== true) continue
      if (BLOCKED.test(textOf(b.content))) return 'block'
      if (intensity === 'hardcore') return 'miss'
    }
    return undefined
  }
  if (door === 'command') {
    const text = textOf(content as unknown[])
    if (text.includes('◆ SAVE POINT · ') && text.includes('[PASSWORD]')) return 'save'
  }
  return undefined
}

/** Plays a cue unless muted, or the same cue played less than GAP_MS ago. */
async function play($: EngineInterface, player: Player, cue: Cue): Promise<void> {
  if (player.intensity === 'off' || player.isMuted || player.gain === 0) return
  const now = await $.clock.now()
  if (now - (player.lastAt.get(cue) ?? -Infinity) < GAP_MS) return
  player.lastAt.set(cue, now)
  void sound($, player, cue).catch(() => undefined)
}

/** Plays one clip on this machine's player; resolves once it played or was skipped. */
async function sound($: EngineInterface, player: Player, cue: Cue): Promise<void> {
  if (player.platform === undefined) player.platform = await platformOf($)
  if (player.platform === 'windows') return soundOnWindows($, player, cue)
  if (player.platform === 'linux') return soundOnLinux($, player, cue)
  return $.audio.play({ asset: `sounds/${cue}.wav` }, { gain: player.gain })
}

/** Windows by its OS variable; else uname: Darwin plays through the engine, the rest is Linux. */
async function platformOf($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  try {
    const ran = await $.process.run(['uname', '-s'], { timeoutMs: 3000 })
    return ran.stdout.trim() === 'Darwin' ? 'engine' : 'linux'
  } catch {
    // No process runner here (a remote surface): the engine's player decides.
    return 'engine'
  }
}

async function soundOnWindows($: EngineInterface, player: Player, cue: Cue): Promise<void> {
  let wav = player.scaled.get(cue)
  if (wav === undefined) {
    const { base64 } = await $.fs.read(`${$.plugin.root}/sounds/${cue}.wav`, { as: 'bytes' })
    wav = scaledWav(base64, player.gain)
    player.scaled.set(cue, wav)
  }
  const args = ['-NoProfile', '-NonInteractive', '-Command', PS_PLAY]
  try {
    await $.process.run(['powershell.exe', ...args], { stdin: wav, timeoutMs: 15000 })
  } catch {
    // Not on PATH: the copy every Windows keeps.
    const system = (await $.env.get('SystemRoot')) ?? 'C:\\Windows'
    await $.process.run([`${system}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ...args], { stdin: wav, timeoutMs: 15000 })
  }
}

async function soundOnLinux($: EngineInterface, player: Player, cue: Cue): Promise<void> {
  if (player.linux === 'none') return
  const file = `${$.plugin.root}/sounds/${cue}.wav`
  if (player.linux !== 'aplay') {
    try {
      const ran = await $.process.run(['paplay', `--volume=${Math.round(player.gain * 65536)}`, file], { timeoutMs: 15000 })
      if (ran.exitCode === 0) {
        player.linux = 'paplay'
        return
      }
    } catch {
      // paplay is not installed: try ALSA.
    }
  }
  try {
    const ran = await $.process.run(['aplay', '-q', file], { timeoutMs: 15000 })
    player.linux = ran.exitCode === 0 ? 'aplay' : 'none'
  } catch {
    player.linux = 'none'
  }
}

/** A 16-bit PCM WAV with its samples scaled by `gain`, as base64; any other file comes back as it was. */
export function scaledWav(base64: string, gain: number): string {
  if (gain >= 0.999) return base64
  const bytes = fromBase64(base64)
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return base64
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format = 0
  let bits = 0
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true)
      bits = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16) return base64
      const end = Math.min(body + size, bytes.length)
      for (let i = body; i + 1 < end; i += 2) {
        const sample = Math.round(view.getInt16(i, true) * gain)
        view.setInt16(i, Math.max(-32768, Math.min(32767, sample)), true)
      }
      return toBase64(bytes)
    }
    at = body + size + (size % 2)
  }
  return base64
}

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let n = 0
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (value >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(triple >> 18) & 63]
    out += B64[(triple >> 12) & 63]
    out += b === undefined ? '=' : B64[(triple >> 6) & 63]
    out += c === undefined ? '=' : B64[triple & 63]
  }
  return out
}

export const register: Register = (on, options) => {
  const intensity = options.intensity === 'off' || options.intensity === 'hardcore' ? options.intensity : 'casual'
  const gain = Math.max(0, Math.min(1, Number(options.volume ?? 0.6)))
  const minTurnMs = Math.max(0, Number(options.minTurnSeconds ?? 30)) * 1000
  const player: Player = { intensity, gain, isMuted: false, lastAt: new Map(), platform: undefined, linux: undefined, scaled: new Map() }

  on('session.start', async ($, e, next) => {
    player.isMuted = (await $.store.get('muted')) === true
    await $.command.register({
      name: 'earcons',
      description: 'GAME MODE sound cues: status, test, on or off',
      argumentHint: '[test|on|off]',
    })
    return next(e)
  })

  // A permission prompt is about to open for this call.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) await play($, player, 'ask')
    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'AskUserQuestion') await play($, player, 'ask')
    const ran = await next(e)
    if (intensity === 'hardcore' && ran.deny === undefined && ran.isError !== true && WRITES.has(tool)) await play($, player, 'hit')
    return ran
  }).catch(($, e, next) => next(e))

  // Refusals, failures and saves are heard from the rows the transcript keeps: every row passes
  // here whichever plugin made it and in whatever order the plugins load.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const cue = cueOf(e.door, e.message.content, intensity)
    if (cue !== undefined) await play($, player, cue)
    return stored
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (e.reason === 'error') await play($, player, 'miss')
      else if (e.reason === 'answer' && (intensity === 'hardcore' || e.durationMs >= minTurnMs)) await play($, player, 'done')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'earcons' }, async ($, e) => {
    const sub = e.args.trim().toLowerCase()
    if (sub === 'on' || sub === 'off') {
      player.isMuted = sub === 'off'
      await $.store.set('muted', player.isMuted)
      return { text: `earcons ${sub}` }
    }
    if (sub === 'test') {
      const order: Cue[] = ['ask', 'done', 'miss', 'block', 'save', 'hit']
      if (player.platform === undefined) player.platform = await platformOf($)
      order.forEach((cue, i) => {
        $.clock.after(i * 900, () => {
          void sound($, player, cue).catch(() => undefined)
        })
      })
      const how = player.platform === 'windows' ? 'PowerShell SoundPlayer' : player.platform === 'linux' ? 'paplay, else aplay' : 'afplay on macOS'
      return { text: `playing ${order.join(' → ')} (${how})` }
    }
    if (sub !== '') return { text: `Unknown option "${sub}". Use /earcons test, on or off.` }
    return {
      text: [
        `earcons ${player.isMuted ? 'off' : 'on'} · intensity ${intensity} · volume ${gain}`,
        'ask    a permission prompt or a question is waiting on you',
        `done   a turn finished${intensity === 'hardcore' ? '' : ` (${minTurnMs / 1000}s or longer)`}`,
        `miss   a turn ended in an error${intensity === 'hardcore' ? ', or a tool call failed' : ''}`,
        'block  a GAME MODE guard refused a call',
        'save   /save made a save point',
        ...(intensity === 'hardcore' ? ['hit    a file changed'] : []),
        '/earcons test · on · off',
      ].join('\n'),
    }
  })
}
