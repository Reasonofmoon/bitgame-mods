import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { HintCues } from '../types'
import { intensityOf } from './palette'

// GAME MODE · HINT
//
// The dim line under the prompt adds what to press now, after the engine's own words:
//   while Claude works         ▸ ESC 후퇴
//   context running low        ▸ /compact 휴식
//   the same kind of failure   ▸ 오류부터 읽기   (two or more failed calls in a row)
//   several turns, no save     ▸ /save 세이브    (with game-save-point)
// Other plugins' additions to the line are kept, before these. The engine sets the tail off
// from its own words with ` · `.

const START: HintCues = { hpLeft: null, failStreak: 0, turnsSinceSave: 0, canSave: false }
const cues = atom({ plugin: 'game-hint', key: 'cues' } as const, START)

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const lowHp = Math.max(5, Math.min(60, Number(options.lowHp ?? 25)))
  const saveEvery = Math.max(1, Number(options.saveEvery ?? 5))

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const commands = await $.command.list().catch(() => [])
    const canSave = commands.some(c => c.name === 'save' && c.plugin === 'game-save-point')
    await update($, cues, c => ({ ...c, canSave }))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const used = e.context.percent
    if (used !== undefined && used !== null) await update($, cues, c => ({ ...c, hpLeft: Math.max(0, 100 - used) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      const failed = ran.deny !== undefined || ran.isError === true
      await update($, cues, c => ({ ...c, failStreak: failed ? c.failStreak + 1 : 0 }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, cues, c => ({ ...c, turnsSinceSave: c.turnsSinceSave + 1 }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A save point row resets the count, whoever wrote it.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'command' && isSaveRow(e.message.content)) await update($, cues, c => ({ ...c, turnsSinceSave: 0 })).catch(() => undefined)
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (intensity === 'off') return next(e)
    const tips = hintsOf(await read($, cues), e.props, lowHp, saveEvery, intensity === 'hardcore')
    if (tips.length === 0) return next(e)
    const mine = tips.map(t => `▸ ${t}`).join('  ')
    const tail = e.props.tail === undefined || e.props.tail === '' ? mine : `${e.props.tail} · ${mine}`
    return next({ ...e, props: { ...e.props, tail } })
  })
}

/** What to press now, most urgent first; two at most. */
export function hintsOf(c: HintCues, line: { isDraft: boolean; isWorking: boolean }, lowHp: number, saveEvery: number, isHardcore: boolean): string[] {
  const tips: string[] = []
  if (line.isWorking) tips.push('ESC 후퇴')
  if (c.failStreak >= 2) tips.push(isHardcore ? `오류부터 읽기 (연속 실패 ${c.failStreak})` : '오류부터 읽기')
  if (!line.isWorking) {
    if (c.hpLeft !== null && c.hpLeft <= lowHp) tips.push('/compact 휴식')
    else if (!line.isDraft && c.canSave && c.turnsSinceSave >= saveEvery) tips.push('/save 세이브')
  }
  return tips.slice(0, 2)
}

function isSaveRow(content: readonly unknown[]): boolean {
  return content.some(block => {
    if (block === null || typeof block !== 'object') return false
    const b = block as { type?: unknown; text?: unknown }
    return b.type === 'text' && typeof b.text === 'string' && b.text.includes('◆ SAVE POINT · ') && b.text.includes('[PASSWORD]')
  })
}
