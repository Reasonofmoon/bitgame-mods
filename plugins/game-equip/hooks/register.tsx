import type { Register } from 'claude-code'

import { intensityOf, paletteOf } from './palette'

// GAME MODE · EQUIP
//
// The model is the session's equipment. At the start, and whenever it changes (/model,
// a fallback), the transcript says which one is on:
//   EQUIP 모델 Sonnet 5.5 장착 · 교체는 /model
//   EQUIP 모델 Opus 5.5 장착 · Sonnet 5.5에서 교체
// Where the engine shows a model notice under the logo, that notice reads the same.

const MODEL_NOTICE = /\b(?:opus|sonnet|haiku|fable|mythos|claude-[a-z0-9.-]+)\b|\bmodel\b/i

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  let current = ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (intensity === 'off') return result
    current = await $.session.model().catch(() => '')
    if (current !== '') $.ui.log(equipLine(current))
    return result
  })

  // A change the session made between turns (/model, a fallback): told at the next turn.
  on('turn.start', async ($, e, next) => {
    if (intensity !== 'off') {
      const now = await $.session.model().catch(() => '')
      if (now !== '' && current !== '' && now !== current) {
        $.ui.log(equipLine(now, current))
        if (intensity === 'hardcore') $.ui.toast(`EQUIP ${nameOf(now)}`)
      }
      if (now !== '') current = now
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    if (intensity !== 'off' && e.to_model !== current) {
      $.ui.log(equipLine(e.to_model, e.from_model))
      if (intensity === 'hardcore') $.ui.toast(`EQUIP ${nameOf(e.to_model)}`)
      current = e.to_model
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The engine's own model notice, where it shows one.
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    const isModel = e.props.command === 'model' || e.props.command === '/model' || MODEL_NOTICE.test(e.props.text)
    if (intensity === 'off' || !isModel || current === '') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={pal.title} bold>
          EQUIP
        </Text>
        <Text color={pal.text}>{`모델 ${nameOf(current)} 장착`}</Text>
        <Text color={pal.dim}>· 교체는 /model</Text>
      </Box>
    )
  })
}

/** `claude-sonnet-5-5` → `Sonnet 5.5`; a name already plain stays. */
export function nameOf(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(?:\[.*\])?$/i.exec(model.trim())
  if (m === null) return model
  const family = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1)
  return `${family} ${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}`
}

export function equipLine(model: string, from?: string): string {
  return from === undefined ? `EQUIP 모델 ${nameOf(model)} 장착 · 교체는 /model` : `EQUIP 모델 ${nameOf(model)} 장착 · ${nameOf(from)}에서 교체`
}
