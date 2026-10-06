import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ClearRecord, TurnNow } from '../types'
import { clock, intensityOf, money, paletteOf } from './palette'

// GAME MODE · CLEAR TIME
//
// The line that closes a turn says how it went, against how turns usually go in this project:
//   ✦ CLEAR 0:42 · 행동 7 · 이번 턴 ₩312 · 평소보다 −0:13
// "평소" is the median of the project's last 20 finished turns, kept across sessions.

const HISTORY = 20
const KEEP = 100
const MATCH_MS = 1500

const turn = atom({ plugin: 'game-clear-time', key: 'turn' } as const, { actions: 0, startUsd: null, isOpen: false } as TurnNow)
const records = atom({ plugin: 'game-clear-time', key: 'records' } as const, [] as ClearRecord[])

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const currency = options.currency === 'usd' ? 'usd' : 'krw'
  const krwPerUsd = Number(options.krwPerUsd ?? 1400) || 1400
  let key = 'durations'

  on('session.start', async ($, e, next) => {
    key = `durations:${await $.session.root()}`
    await $.command.register({ name: 'clear-time', description: 'GAME MODE clear time: this project\'s usual turn, best and worst' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const usage = await $.session.usage().catch(() => undefined)
    await update($, turn, () => ({ actions: 0, startUsd: usage?.cost?.usd ?? null, isOpen: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) await update($, turn, t => ({ ...t, actions: t.actions + 1 }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A cost reading that lands after the turn closed settles that turn's cost.
  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd !== undefined && !(await read($, turn)).isOpen) {
      await update($, records, list => settle(list, usd))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await read($, turn)
    const kept = await $.store.get(key)
    const history = Array.isArray(kept) ? kept.filter((n): n is number => typeof n === 'number') : []
    const median = history.length >= 3 ? medianOf(history) : null
    const usage = await $.session.usage().catch(() => undefined)
    const usdNow = usage?.cost?.usd ?? null
    const record: ClearRecord = {
      durationMs: e.durationMs,
      actions: now.actions,
      startUsd: now.startUsd,
      usd: usdNow !== null && now.startUsd !== null ? Math.max(0, usdNow - now.startUsd) : null,
      deltaMs: median === null ? null : e.durationMs - median,
      medianMs: median,
    }
    await update($, records, list => [...list, record].slice(-KEEP))
    await update($, turn, t => ({ ...t, isOpen: false }))
    // Only turns that ran to an answer say how long a turn usually takes.
    if (e.reason === 'answer') await $.store.set(key, [...history, e.durationMs].slice(-HISTORY))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (intensity === 'off') return next(e)
    const rec = recordFor(await read($, records), e.props.durationMs)
    const { Box, Text } = $.ui.resolve(e)
    const delta = rec?.deltaMs ?? null
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={pal.title} bold>
          ✦ CLEAR
        </Text>
        <Text color={pal.text} bold>
          {clock(e.props.durationMs)}
        </Text>
        {rec !== undefined && <Text color={pal.dim}>{`· 행동 ${rec.actions}`}</Text>}
        {rec !== undefined && rec.usd !== null && <Text color={pal.dim}>{`· 이번 턴 ${money(rec.usd, currency, krwPerUsd)}`}</Text>}
        {delta !== null && (
          <Text color={delta <= 0 ? pal.ok : pal.warn}>{`· 평소보다 ${delta <= 0 ? '−' : '+'}${clock(Math.abs(delta))}`}</Text>
        )}
        {intensity === 'hardcore' && rec?.medianMs != null && <Text color={pal.dim}>{`(평소 ${clock(rec.medianMs)})`}</Text>}
      </Box>
    )
  })

  on('command.run', { command: 'clear-time' }, async ($) => {
    const kept = await $.store.get(key)
    const history = Array.isArray(kept) ? kept.filter((n): n is number => typeof n === 'number') : []
    if (history.length === 0) return { text: 'No finished turns on record for this project yet.' }
    const sorted = [...history].sort((a, b) => a - b)
    return {
      text: [
        `CLEAR TIME · last ${history.length} turns of this project`,
        `평소 (median) ${clock(medianOf(history))}`,
        `최단 ${clock(sorted[0] ?? 0)} · 최장 ${clock(sorted[sorted.length - 1] ?? 0)}`,
      ].join('\n'),
    }
  })
}

export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/** The record a closing line belongs to: the same duration, or the nearest within 1.5 s, newest first. */
export function recordFor(list: readonly ClearRecord[], durationMs: number): ClearRecord | undefined {
  let best: ClearRecord | undefined
  let bestGap = MATCH_MS + 1
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (r === undefined) continue
    const gap = Math.abs(r.durationMs - durationMs)
    if (gap === 0) return r
    if (gap < bestGap) {
      best = r
      bestGap = gap
    }
  }
  return bestGap <= MATCH_MS ? best : undefined
}

/** The newest record's cost, from a reading taken after its turn closed. */
function settle(list: readonly ClearRecord[], usd: number): ClearRecord[] {
  const last = list[list.length - 1]
  if (last === undefined || last.startUsd === null) return [...list]
  return [...list.slice(0, -1), { ...last, usd: Math.max(0, usd - last.startUsd) }]
}
