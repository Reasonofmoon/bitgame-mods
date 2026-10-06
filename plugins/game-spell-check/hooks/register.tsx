import { atom, read, update } from 'claude-code'
import type { PromptDecoration, Register } from 'claude-code'

import type { Draft, Sent } from '../types'
import { intensityOf, paletteOf } from './palette'

// GAME MODE · SPELL CHECK
//
// While you type, words that leave the finish line open (적당히, 알아서, 대충, 깔끔하게 …)
// are underlined in the warning color, values that look like secrets in the error color,
// and the hint line says what to add:
//   ⚠ '적당히' — 무엇이 되면 끝인지 적어라
// A prompt sent with such a word and no done condition carries a note only Claude reads,
// asking it to state the done condition before it starts. Your messages draw in a window:
//   ╭ P1 · moon ─────────────────────────╮
//   │ 로그인 버그 적당히 고쳐줘             │
//   │ ⚑ 완료 조건 · Claude에게 먼저 정하라고 함 │

type Found = { word: string; start: number; end: number }

const VAGUE = [
  '적당히',
  '알아서',
  '대충',
  '깔끔하게',
  '대강',
  '적절히',
  '예쁘게',
  '그럴듯하게',
  '웬만하면',
  '잘 좀',
  '좋게 좀',
  'properly',
  'nicely',
  'somehow',
  'appropriately',
  'as needed',
  'clean it up',
  'make it better',
]
const VAGUE_RE = new RegExp(VAGUE.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')

// Values that look like credentials. Shapes only: no real key is kept here.
const SECRETS: readonly RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/gi,
]

// A done condition the person wrote: a line naming it, or a sentence that says when it ends.
const DONE_LINE = /^\s*(?:완료\s*조건|끝\s*조건|done\s*when|definition\s+of\s+done|acceptance)\s*[:：]\s*(.+)$/im
const DONE_SENTENCE = /[^.!?\n]*(?:통과하면|되면\s*끝|하면\s*끝|까지만|나오면\s*끝|done when|until [^.!?\n]+ pass(?:es)?)[^.!?\n]*/i

const EMPTY: Draft = { vague: '', hasSecret: false }
const draft = atom({ plugin: 'game-spell-check', key: 'draft' } as const, EMPTY)
const sent = atom({ plugin: 'game-spell-check', key: 'sent' } as const, [] as Sent[])

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  let player = typeof options.player === 'string' ? options.player.trim() : ''

  on('session.start', async ($, e, next) => {
    if (player === '') player = (await $.env.get('USER')) ?? (await $.env.get('USERNAME')) ?? (await $.env.get('LOGNAME')) ?? 'PLAYER'
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (intensity === 'off') return box
    const vague = vagueIn(box.text)
    const secrets = secretsIn(box.text)
    const now: Draft = { vague: vague[0]?.word ?? '', hasSecret: secrets.length > 0 }
    const was = await read($, draft)
    if (was.vague !== now.vague || was.hasSecret !== now.hasSecret) await update($, draft, () => now)
    if (vague.length === 0 && secrets.length === 0) return box
    const marks: PromptDecoration[] = [
      ...vague.map(f => ({ start: f.start, end: f.end, color: pal.warn, underline: true })),
      ...secrets.map(f => ({ start: f.start, end: f.end, color: pal.bad, underline: true, bold: true })),
    ]
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (intensity === 'off' || !e.props.isDraft) return next(e)
    const d = await read($, draft)
    const mine = d.hasSecret ? '⚠ 비밀 값이 보인다 — 보내기 전에 지워라' : d.vague !== '' ? `⚠ '${d.vague}' — 무엇이 되면 끝인지 적어라` : ''
    if (mine === '') return next(e)
    const tail = e.props.tail === undefined || e.props.tail === '' ? mine : `${e.props.tail} · ${mine}`
    return next({ ...e, props: { ...e.props, tail } })
  })

  on('prompt.submit', async ($, e, next) => {
    if (intensity === 'off' || e.origin.kind !== 'composer') return next(e)
    const vague = vagueIn(e.text).map(f => f.word)
    const done = doneOf(e.text)
    const isLong = intensity === 'hardcore' && e.text.length > 200
    const isAsked = done === '' && (vague.length > 0 || isLong)
    await update($, draft, () => EMPTY)
    await update($, sent, list => [...list, { text: e.text, done, isAsked }].slice(-50))
    if (!isAsked) return next(e)
    return next({ ...e, context: [...(e.context ?? []), noteFor(vague)] })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.origin.kind !== 'composer') return next(e)
    const list = await read($, sent)
    const s = [...list].reverse().find(x => x.text === e.props.text)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={pal.frame} paddingX={1}>
        <Text color={pal.title} bold>
          {`P1 · ${player}`}
        </Text>
        <Text color={pal.text}>{e.props.text}</Text>
        {s !== undefined && s.done !== '' && <Text color={pal.ok}>{`⚑ 완료 조건 · ${s.done}`}</Text>}
        {s !== undefined && s.isAsked && <Text color={pal.warn}>⚑ 완료 조건 · Claude에게 먼저 정하라고 함</Text>}
      </Box>
    )
  })
}

export function vagueIn(text: string): Found[] {
  return [...text.matchAll(VAGUE_RE)].map(m => ({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
}

export function secretsIn(text: string): Found[] {
  const out: Found[] = []
  for (const re of SECRETS) {
    for (const m of text.matchAll(re)) out.push({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The done condition the prompt states, as written; '' when it states none. */
export function doneOf(text: string): string {
  const line = DONE_LINE.exec(text)
  if (line?.[1] !== undefined) return line[1].trim()
  return DONE_SENTENCE.exec(text)?.[0].trim() ?? ''
}

export function noteFor(vague: readonly string[]): string {
  const words = vague.length > 0 ? `모호한 표현(${[...new Set(vague)].map(w => `'${w}'`).join(', ')})이 있고 ` : ''
  return [
    '[GAME MODE · Spell Check] 이 메모는 사용자에게 보이지 않습니다.',
    `사용자의 요청에 ${words}완료 조건이 적혀 있지 않습니다.`,
    '작업을 시작하기 전에 무엇이 되면 끝인지(완료 조건)를 한 줄로 먼저 밝히고, 그 기준으로 진행한 뒤 끝에서 그 조건을 확인하세요.',
    '합리적인 기준을 정할 수 없으면 사용자에게 먼저 물어보세요.',
  ].join('\n')
}
