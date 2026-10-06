import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { HudEvent, Vitals } from '../types'
import { bar, intensityOf, money, paletteOf, windowProps } from './palette'
import type { Palette } from './palette'

// GAME MODE · HUD
//
// A framed band above the prompt, drawn from figures the engine already keeps:
//   LV / EXP = successful tool calls, as levels and progress to the next
//   HP  = context window left   (session.measure → context.percent)
//   MP  = plan usage left       (session.measure → rateLimits, five_hour first)
//   G   = what the session cost (session.measure → cost.usd), ₩ by default
// The second row says what needs you (HP LOW!) or what just happened (REST,
// SAVED, LEVEL UP!), with buttons for rest (/compact) and, when
// game-save-point is installed, save (/save). Another plugin's band is drawn
// above this one, never replaced.

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
  event: null,
}

const vitals = atom({ plugin: 'game-hud', key: 'vitals' } as const, INITIAL)
const REST: HudEvent = { kind: 'rest' }
const SAVED: HudEvent = { kind: 'saved' }

type Currency = 'usd' | 'krw'

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const lowHp = clamp(Number(options.lowHp ?? 25), 5, 60)
  const currency: Currency = options.currency === 'usd' ? 'usd' : 'krw'
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
    // game-save-point may register /save after this hook ran: look again shortly.
    $.clock.after(1500, () => {
      void recheckSave($)
    })
    await $.command.register({
      name: 'hud',
      description: 'GAME MODE HUD: show HP/MP/G as text, or hide/show the band',
      argumentHint: '[hide|show]',
    })
    return next(e)
  })

  // A new prompt: last turn's news is old. Another plugin's /save may register late.
  on('turn.start', async ($, e, next) => {
    const commands = await $.command.list()
    const hasSave = commands.some(c => c.name === 'save')
    await update($, vitals, v => ({ ...v, hasSave, event: null }))
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
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, vitals, v => {
        const before = levelOf(v.hits).level
        const after = levelOf(v.hits + 1).level
        const event: HudEvent | null = after > before ? { kind: 'levelup', level: after } : v.event
        return { ...v, hits: v.hits + 1, event }
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await update($, vitals, v => ({ ...v, event: REST }))
    return done
  }).catch(($, e, next) => next(e))

  // A save is heard from the row it leaves, whichever plugin answered /save.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'command' && isSaveRow(e.message.content)) await update($, vitals, v => ({ ...v, event: SAVED }))
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.hasSurvey) return next(e)
    const v = await read($, vitals)
    const below = await next(e)
    if (v.isHidden) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const inner = e.props.bodyColumns - 4
    const cells = inner >= 90 ? 10 : inner >= 72 ? 8 : inner >= 56 ? 5 : 0

    const hpLeft = v.contextUsed === null ? null : clamp(100 - v.contextUsed, 0, 100)
    const mpLeft = v.limitUsed === null ? null : clamp(100 - v.limitUsed, 0, 100)
    const lv = levelOf(v.hits)
    const expPercent = Math.round((lv.into / lv.span) * 100)
    const status = statusOf(v, hpLeft, lowHp, lv, intensity === 'hardcore', pal)

    const gauge = (label: string, left: number | null, extra = '') =>
      left === null ? `${label} --` : `${label} ${cells > 0 ? bar(left, cells) + ' ' : ''}${left}%${extra ? ' ' + extra : ''}`

    const press = (command: string) => () => {
      void $.command.run({ command }).catch(() => $.ui.toast(`/${command}을(를) 실행하지 못했다`))
    }

    const band = (
      <Box {...windowProps(pal)} flexDirection="column">
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Text color={pal.title} bold>
            LV {String(lv.level).padStart(2, '0')}
          </Text>
          <Text color={pal.ok}>{gauge('EXP', expPercent)}</Text>
          <Text color={toneOf(hpLeft, lowHp, pal)}>{gauge('HP', hpLeft)}</Text>
          {mpLeft !== null && <Text color={pal.info}>{gauge('MP', mpLeft, shortKind(v.limitKind))}</Text>}
          {v.usd !== null && (
            <Text color={pal.title} bold>
              G {money(v.usd, currency, krwPerUsd)}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text color={status.color} bold>
            {status.tag}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={pal.text} wrap="truncate-end">
              {status.message}
            </Text>
          </Box>
          <Button key="rest" label="휴식 /compact" hotkey="r" variant={status.tag === 'HP LOW!' ? 'primary' : 'secondary'} onPress={press('compact')} />
          {v.hasSave && <Button key="save" label="세이브 /save" hotkey="s" onPress={press('save')} />}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {below}
        {band}
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
      `LV ${lv.level} · EXP ${lv.into}/${lv.span} (successful tool calls ${v.hits}) · turns ${v.turns}`,
      `intensity ${intensity} · HP LOW! at ≤ ${lowHp}%`,
    ]
    return { text: lines.join('\n') }
  })
}

type Status = { tag: string; message: string; color: string }

/** The second row: what needs you first, then what just happened, else the way to the next level. */
export function statusOf(
  v: Vitals,
  hpLeft: number | null,
  lowHp: number,
  lv: { level: number; into: number; span: number },
  isHardcore: boolean,
  pal: Palette,
): Status {
  if (hpLeft !== null && hpLeft <= lowHp) {
    return { tag: 'HP LOW!', message: `컨텍스트 ${hpLeft}% 남음 · 휴식(/compact)하면 지금까지를 요약하고 이어간다`, color: pal.bad }
  }
  if (v.event?.kind === 'saved') return { tag: 'SAVED', message: '세이브 완료 · 다음 세션 빈 입력창에서 Tab 하면 이어하기', color: pal.title }
  if (v.event?.kind === 'rest') return { tag: 'REST', message: '휴식 완료 · 지금까지를 요약하고 컨텍스트를 비웠다', color: pal.ok }
  if (v.event?.kind === 'levelup') {
    return { tag: 'LEVEL UP!', message: `LV ${v.event.level ?? lv.level} 달성 · 성공한 행동 ${v.hits}번`, color: pal.title }
  }
  const turns = isHardcore ? ` · 턴 ${v.turns}` : ''
  return { tag: 'READY', message: `다음 레벨까지 성공 행동 ${lv.span - lv.into}${turns}`, color: pal.ok }
}

async function recheckSave($: EngineInterface): Promise<void> {
  const commands = await $.command.list()
  if (commands.some(c => c.name === 'save')) await update($, vitals, v => (v.hasSave ? v : { ...v, hasSave: true }))
}

function isSaveRow(content: readonly unknown[]): boolean {
  const text = content
    .map(b => (b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .join('\n')
  return text.includes('◆ SAVE POINT · ') && text.includes('[PASSWORD]')
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

function toneOf(left: number | null, low: number, pal: Palette): string {
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

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo
}
