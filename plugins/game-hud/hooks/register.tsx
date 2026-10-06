import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Vitals } from '../types'
import { bar, intensityOf, paletteOf } from './palette'

// GAME MODE · HUD
//
// One band above the prompt, drawn from figures the engine already keeps:
//   HP  = context window left   (session.measure → context.percent)
//   MP  = plan usage left       (session.measure → rateLimits, five_hour first)
//   G   = what the session cost (session.measure → cost.usd)
//   LV  = successful tool calls, as levels (flavor; hardcore shows EXP)
// When HP drops to `lowHp`, a second row offers rest (/compact) and, when
// game-save-point is installed, save (/save). Both run as if typed, queued
// until the session is idle.

const INITIAL: Vitals = {
  contextUsed: null,
  limitKind: null,
  limitUsed: null,
  usd: null,
  turns: 0,
  hits: 0,
  hasSave: false,
  isHidden: false,
  warned: false,
}

const vitals = atom({ plugin: 'game-hud', key: 'vitals' } as const, INITIAL)

type Currency = 'usd' | 'krw'

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const lowHp = clamp(Number(options.lowHp ?? 25), 5, 60)
  const currency: Currency = options.currency === 'krw' ? 'krw' : 'usd'
  const krwPerUsd = Number(options.krwPerUsd ?? 1400)

  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    const turns = await $.session.turns()
    const commands = await $.command.list()
    const isHidden = (await $.store.get('hidden')) === true
    await update($, vitals, v => ({
      ...v,
      ...fromUsage(usage),
      turns,
      isHidden,
      hasSave: commands.some(c => c.name === 'save'),
    }))
    await $.command.register({
      name: 'hud',
      description: 'GAME MODE HUD: show HP/MP/G as text, or hide/show the band',
      argumentHint: '[hide|show]',
    })
    return next(e)
  })

  // Another plugin's /save may register after this one did at session.start.
  on('turn.start', async ($, e, next) => {
    const v = await read($, vitals)
    if (!v.hasSave) {
      const commands = await $.command.list()
      if (commands.some(c => c.name === 'save')) await update($, vitals, x => ({ ...x, hasSave: true }))
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    let warning: string | undefined
    await update($, vitals, v => {
      const nv: Vitals = {
        ...v,
        contextUsed: e.context.percent ?? v.contextUsed,
        ...limitOf(e.rateLimits),
        usd: e.cost?.usd ?? v.usd,
      }
      const left = nv.contextUsed === null ? null : 100 - nv.contextUsed
      if (left !== null && left <= lowHp && !v.warned) {
        nv.warned = true
        warning = `HP LOW! 컨텍스트 ${left}% 남음 · 휴식(/compact) 또는 세이브(/save)`
      } else if (left !== null && left > lowHp + 10) {
        nv.warned = false
      }
      return nv
    })
    if (warning !== undefined && intensity !== 'off') $.ui.toast(warning)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, vitals, v => ({ ...v, turns: v.turns + 1 }))
    return next(e)
  })

  // Observes only: whatever happens here, the call's own result goes on.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await update($, vitals, v => ({ ...v, hits: v.hits + 1 }))
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.hasSurvey) return next(e)
    const v = await read($, vitals)
    if (v.isHidden) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const cells = cols >= 110 ? 10 : cols >= 84 ? 8 : cols >= 64 ? 5 : 0

    const hpLeft = v.contextUsed === null ? null : clamp(100 - v.contextUsed, 0, 100)
    const mpLeft = v.limitUsed === null ? null : clamp(100 - v.limitUsed, 0, 100)
    const isLow = hpLeft !== null && hpLeft <= lowHp
    const lv = levelOf(v.hits)

    const gauge = (label: string, left: number | null, extra = '') =>
      left === null
        ? `${label} --`
        : `${label} ${cells > 0 ? bar(left, cells) + ' ' : ''}${left}%${extra ? ' ' + extra : ''}`

    const press = (command: string) => () => {
      void $.command.run({ command }).catch(() => $.ui.toast(`/${command}을(를) 실행하지 못했다`))
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Text color={pal.title} bold>
            LV {lv.level}
          </Text>
          <Text color={toneOf(hpLeft, lowHp, pal)}>{gauge('HP', hpLeft)}</Text>
          {mpLeft !== null && (
            <Text color={toneOf(mpLeft, lowHp, pal)}>{gauge('MP', mpLeft, shortKind(v.limitKind))}</Text>
          )}
          {v.usd !== null && <Text color={pal.title}>G {money(v.usd, currency, krwPerUsd)}</Text>}
          {intensity === 'hardcore' && (
            <Text color={pal.info}>
              EXP {bar((lv.into / lv.span) * 100, 5)} {lv.into}/{lv.span}
            </Text>
          )}
          {intensity === 'hardcore' && <Text color={pal.dim}>TURN {v.turns}</Text>}
        </Box>
        {isLow && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color={pal.bad} bold>
              HP LOW!
            </Text>
            <Text color={pal.text}>컨텍스트 {hpLeft}% 남음 · 휴식하면 지금까지를 요약하고 이어간다</Text>
            <Button key="rest" label="휴식 /compact" hotkey="r" variant="primary" onPress={press('compact')} />
            {v.hasSave && <Button key="save" label="세이브 /save" hotkey="s" onPress={press('save')} />}
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const sub = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (sub === 'hide' || sub === 'show') {
      const isHidden = sub === 'hide'
      await $.store.set('hidden', isHidden)
      await update($, vitals, v => ({ ...v, isHidden }))
      return { text: isHidden ? 'HUD hidden. /hud show brings it back.' : 'HUD shown.' }
    }
    if (sub !== '') return { text: `Unknown option "${sub}". Use /hud, /hud hide or /hud show.` }

    const v = await read($, vitals)
    const lv = levelOf(v.hits)
    const lines = [
      `HP ${v.contextUsed === null ? '--' : `${100 - v.contextUsed}% (context used ${v.contextUsed}%)`}`,
      `MP ${v.limitUsed === null ? '-- (no plan usage reading)' : `${100 - v.limitUsed}% (${v.limitKind} used ${v.limitUsed}%)`}`,
      `G  ${v.usd === null ? '--' : money(v.usd, currency, krwPerUsd)}`,
      `LV ${lv.level} (successful tool calls ${v.hits}) · turns ${v.turns}`,
      `intensity ${intensity} · rest/save row at HP ≤ ${lowHp}%`,
    ]
    return { text: lines.join('\n') }
  })
}

function fromUsage(u: SessionUsage): Pick<Vitals, 'contextUsed' | 'limitKind' | 'limitUsed' | 'usd'> {
  return { contextUsed: u.context.percent ?? null, ...limitOf(u.rateLimits), usd: u.cost?.usd ?? null }
}

function limitOf(list: readonly SessionRateLimit[]): Pick<Vitals, 'limitKind' | 'limitUsed'> {
  const w = list.find(r => r.kind === 'five_hour') ?? list[0]
  return w ? { limitKind: w.kind, limitUsed: Math.round(w.percentUsed) } : { limitKind: null, limitUsed: null }
}

function shortKind(kind: string | null): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'spend'
  return kind ?? ''
}

function toneOf(left: number | null, low: number, pal: { ok: string; title: string; bad: string; dim: string }): string {
  if (left === null) return pal.dim
  if (left > 50) return pal.ok
  if (left > low) return pal.title
  return pal.bad
}

/** Level n starts at 4·(n−1)² successful calls. */
export function levelOf(hits: number): { level: number; into: number; span: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, hits) / 4)) + 1
  const floor = 4 * (level - 1) ** 2
  return { level, into: hits - floor, span: 4 * (2 * level - 1) }
}

export function money(usd: number, currency: Currency, krwPerUsd: number): string {
  if (currency === 'krw') return '₩' + String(Math.round(usd * krwPerUsd)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return '$' + usd.toFixed(2)
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo
}
