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
// Clips are the plugin's own WAV files (sounds/), played with afplay on
// macOS; Linux and Windows terminals have no player and stay silent.

type Cue = 'ask' | 'done' | 'miss' | 'block' | 'save' | 'hit'

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const BLOCKED = /\bgame-(?:trap-guard|barrier|loop-breaker)\b.*\bblocked\b|^(?:TRAP|BARRIER|LOOP)!/
const GAP_MS = 400

type Player = {
  intensity: 'off' | 'casual' | 'hardcore'
  gain: number
  isMuted: boolean
  lastAt: Map<Cue, number>
}

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
  void $.audio.play({ asset: `sounds/${cue}.wav` }, { gain: player.gain }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const intensity = options.intensity === 'off' || options.intensity === 'hardcore' ? options.intensity : 'casual'
  const gain = Math.max(0, Math.min(1, Number(options.volume ?? 0.6)))
  const minTurnMs = Math.max(0, Number(options.minTurnSeconds ?? 30)) * 1000
  const player: Player = { intensity, gain, isMuted: false, lastAt: new Map() }

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
      order.forEach((cue, i) => {
        $.clock.after(i * 900, () => {
          void $.audio.play({ asset: `sounds/${cue}.wav` }, { gain }).catch(() => undefined)
        })
      })
      return { text: `playing ${order.join(' → ')} (macOS plays them with afplay; other systems stay silent)` }
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
