import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Cast } from '../types'
import { intensityOf, money } from './palette'

// GAME MODE · CASTING
//
// The spinner says what the turn is doing and what it has cost so far:
//   ✻ CASTING · BASH npm test… · 행동 3 · G +₩120  (12s · ↓ 300 tokens)
// Only the words are rewritten, so the engine's own time and tokens stay after them.

const START: Cast = { actions: 0, startUsd: null, usd: null, running: [] }
const cast = atom({ plugin: 'game-casting', key: 'cast' } as const, START)

// What the turn is doing while no call runs, by the spinner's mode.
const DOING: Record<string, string> = {
  requesting: '요청 중',
  thinking: '생각하는 중',
  responding: '답을 쓰는 중',
  'tool-input': '행동을 고르는 중',
  'tool-use': '행동하는 중',
}

const LABELS: Record<string, string> = {
  Bash: 'BASH',
  Read: 'READ',
  Edit: 'EDIT',
  MultiEdit: 'EDIT',
  Write: 'WRITE',
  NotebookEdit: 'NOTE',
  Grep: 'GREP',
  Glob: 'GLOB',
  WebFetch: 'FETCH',
  WebSearch: 'SEARCH',
  Agent: 'SUMMON',
  Task: 'SUMMON',
  TodoWrite: 'QUEST',
  AskUserQuestion: 'ASK',
}

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const currency = options.currency === 'usd' ? 'usd' : 'krw'
  const krwPerUsd = Number(options.krwPerUsd ?? 1400) || 1400

  on('turn.start', async ($, e, next) => {
    const usage = await $.session.usage().catch(() => undefined)
    const usd = usage?.cost?.usd ?? null
    await update($, cast, c => ({ actions: 0, startUsd: usd ?? c.usd, usd: usd ?? c.usd, running: [] }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd !== undefined) await update($, cast, c => ({ ...c, usd, startUsd: c.startUsd ?? usd }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const id = e.tool_use_id
    const text = castOf(String(e.tool), e)
    await update($, cast, c => ({ ...c, actions: c.actions + 1, running: [...c.running, { id, text }] }))
    try {
      return await next(e)
    } finally {
      await update($, cast, c => ({ ...c, running: c.running.filter(r => r.id !== id) }))
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // A state the engine names itself (compacting, a retry) keeps its words.
    if (intensity === 'off' || e.props.message !== null) return next(e)
    const c = await read($, cast)
    return next({ ...e, props: { ...e.props, message: castLine(c, e.props.mode, intensity === 'hardcore', currency, krwPerUsd), suffix: '' } })
  })
}

/** `CASTING · BASH npm test… · 행동 3 · G +₩120` */
export function castLine(c: Cast, mode: string, isHardcore: boolean, currency: 'usd' | 'krw', krwPerUsd: number): string {
  const latest = c.running[c.running.length - 1]
  const head = isHardcore && c.running.length > 1 ? `CASTING ×${c.running.length}` : 'CASTING'
  const parts = [`${head} · ${latest?.text ?? DOING[mode] ?? '행동하는 중'}…`, `행동 ${c.actions}`]
  if (c.usd !== null && c.startUsd !== null) parts.push(`G +${money(Math.max(0, c.usd - c.startUsd), currency, krwPerUsd)}`)
  return parts.join(' · ')
}

/** A call by its label and what it works on: `BASH npm test`, `EDIT auth.ts`. */
export function castOf(tool: string, input: unknown): string {
  const label = LABELS[tool] ?? (tool.startsWith('mcp__') ? tool.split('__')[2]?.toUpperCase() ?? 'MCP' : tool.toUpperCase())
  const o = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const str = (key: string) => (typeof o[key] === 'string' ? (o[key] as string) : '')
  let what = ''
  if (tool === 'Bash') what = str('command').trim().split('\n')[0] ?? ''
  else if (tool === 'Grep' || tool === 'Glob') what = str('pattern')
  else if (tool === 'WebFetch') what = str('url').replace(/^https?:\/\//, '')
  else if (tool === 'WebSearch') what = str('query')
  else if (tool === 'Agent' || tool === 'Task') what = str('description')
  else what = (str('file_path') || str('notebook_path') || str('path')).split(/[\\/]/).pop() ?? ''
  what = what.replace(/\s+/g, ' ')
  if (what.length > 36) what = what.slice(0, 35) + '…'
  return what === '' ? label : `${label} ${what}`
}
