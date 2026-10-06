import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StanceMode } from '../types'
import { intensityOf, paletteOf } from './palette'
import type { Palette } from './palette'

// GAME MODE · STANCE
//
// The permission mode as a badge at the right of the prompt footer, in its own
// color, so a session left in 자동 승인 or 우회 does not go unnoticed:
//   STANCE  자동 승인
//
// Where the mode comes from:
// - the hook input of each prompt and tool result (`permission_mode`), exact;
// - the settings' `permissions.defaultMode` when the session starts;
// - shift+tab between prompts: the footer's line, as handed to a PromptHint hook, names
//   the mode only in the one drawing made as the mode changes, and then names the mode
//   it is leaving. The badge moves to the mode after it in shift+tab's order
//   (기본 → 자동 승인 → 계획 → [우회] → 자동 판정 → 기본). Steady lines tell 기본
//   (`? for shortcuts`) from the rest (`shift+tab to cycle`). The next prompt or
//   tool result confirms or corrects it.

type Stance = { label: string; meaning: string; tone: keyof Palette }

export const STANCES: Record<StanceMode, Stance> = {
  default: { label: '기본', meaning: '위험한 행동은 묻는다', tone: 'ok' },
  acceptEdits: { label: '자동 승인', meaning: '파일 수정은 묻지 않는다', tone: 'title' },
  plan: { label: '계획', meaning: '읽고 계획만 세운다', tone: 'info' },
  auto: { label: '자동 판정', meaning: '분류기가 허용 여부를 정한다', tone: 'warn' },
  bypassPermissions: { label: '우회', meaning: '아무것도 묻지 않는다', tone: 'bad' },
  dontAsk: { label: '묻지 않음', meaning: '허용 목록 밖은 거절한다', tone: 'dim' },
}

const mode = atom({ plugin: 'game-stance', key: 'mode' } as const, 'default' as StanceMode)

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  // 우회 joins shift+tab's order only in a session that allows it.
  let hasBypass = false

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const settings = await $.settings.read().catch(() => undefined)
    const configured = modeOfSetting((settings as { permissions?: { defaultMode?: unknown } } | undefined)?.permissions?.defaultMode)
    if (configured !== undefined) {
      if (configured === 'bypassPermissions') hasBypass = true
      await update($, mode, () => configured)
    }
    return result
  })

  // What the classic hooks are told: the mode at each prompt and after each tool call.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const told = modeOfSetting(e.permission_mode)
    if (told === 'bypassPermissions') hasBypass = true
    await settle($, told)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const told = e.agent_id === undefined ? modeOfSetting(e.permission_mode) : undefined
    if (told === 'bypassPermissions') hasBypass = true
    await settle($, told)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // A change while Claude works is the engine's (leaving plan mode): the next tool result says it.
    if (intensity === 'off' || e.props.isWorking) return next(e)
    const now = await read($, mode)
    const left = modeOfHint(e.props.hint)
    let target: StanceMode | undefined
    if (left !== undefined) {
      if (left === 'bypassPermissions') hasBypass = true
      target = nextMode(left, hasBypass)
    } else if (!e.props.isDraft && e.props.hint.includes('? for shortcuts') && !e.props.hint.includes('shift+tab')) {
      target = 'default'
    }
    if (target !== undefined && target !== now) {
      const to = target
      // A drawing cannot write state: write on the next tick, then draw the badge again.
      $.clock.after(0, () => {
        void update($, mode, () => to).then(() => $.ui.invalidate('ui.render'))
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (intensity === 'off') return next(e)
    const stance = STANCES[await read($, mode)]
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        <Text color={pal.dim}>STANCE</Text>
        <Text color={pal[stance.tone]} inverse bold>
          {` ${stance.label} `}
        </Text>
        {intensity === 'hardcore' && <Text color={pal.dim}>{stance.meaning}</Text>}
      </Box>
    )
  })
}

/** Sets the mode from an exact source and draws the badge again when it changed. */
async function settle($: EngineInterface, told: StanceMode | undefined): Promise<void> {
  if (told === undefined || told === (await read($, mode))) return
  await update($, mode, () => told)
  $.ui.invalidate('ui.render')
}

/** The mode shift+tab moves to from `from`. */
export function nextMode(from: StanceMode, hasBypass: boolean): StanceMode {
  switch (from) {
    case 'default':
      return 'acceptEdits'
    case 'acceptEdits':
      return 'plan'
    case 'plan':
      return hasBypass ? 'bypassPermissions' : 'auto'
    case 'bypassPermissions':
      return 'auto'
    default:
      return 'default'
  }
}

/** The mode a settings name stands for (`acceptEdits`, ...); undefined for anything else. */
export function modeOfSetting(value: unknown): StanceMode | undefined {
  return typeof value === 'string' && value in STANCES ? (value as StanceMode) : undefined
}

/** The mode the footer's line names (`⏵⏵ accept edits on`, `⏸ plan mode on`, ...). */
export function modeOfHint(hint: string): StanceMode | undefined {
  const h = hint.toLowerCase()
  if (h.includes('accept edits on')) return 'acceptEdits'
  if (h.includes('plan mode on')) return 'plan'
  if (h.includes('auto mode on')) return 'auto'
  if (h.includes('bypass permissions on')) return 'bypassPermissions'
  if (/don['’]?t ask(?: mode)? on/.test(h)) return 'dontAsk'
  if (h.includes('manual mode on') || h.includes('default mode on')) return 'default'
  return undefined
}
