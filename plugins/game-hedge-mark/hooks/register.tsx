import type { Register } from 'claude-code'

import { intensityOf, paletteOf } from './palette'

// GAME MODE · HEDGE MARK
//
// Claude's replies draw in a window headed CLAUDE, and a sentence that guesses
// (아마, 추정, ~것 같다, probably, might …) is marked [?], so what is checked and what is a
// guess read apart:
//   ╭─────────────────────────────────────────────╮
//   │ CLAUDE                                        │
//   │ 테스트 3개 중 2개가 실패합니다.                   │
//   │ [?] 아마 issuedAt 단위가 원인일 것입니다.        │
//   │ ? 추정 1곳 · 확인되기 전까지는 가설              │
// Code blocks are left as they are. The stored reply is unchanged (ctrl+o shows it).

const KOREAN = /아마(?:도)?|추정|추측|것\s?같(?:습니다|다|아요|네요|은데)|(?<![과와])\s같(?:습니다|아요|네요)|듯(?:합니다|하다|해요|싶)|수도\s?있|가능성이\s?(?:있|높|크)|(?:로|으로|처럼)\s?보입니다|확실하지\s?않|확실치\s?않|모르겠/
const ENGLISH = /\b(?:probably|likely|perhaps|maybe|might|presumably|seems?|appears? to|i think|i believe|i guess|i suspect|not sure|could be)\b/i
const MARK = '**[?]** '

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.isSummary === true) return next(e)
    const { text, count } = markHedges(e.props.text)
    // hardcore: the marks alone, in the engine's own drawing.
    if (intensity === 'hardcore') return count === 0 ? next(e) : next({ ...e, props: { ...e.props, text } })
    const { Box, Markdown, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={pal.frame} paddingX={1}>
        {e.props.isFirstOfReply && (
          <Text color={pal.title} bold>
            CLAUDE
          </Text>
        )}
        <Markdown text={text} />
        {count > 0 && <Text color={pal.warn}>{`? 추정 ${count}곳 · 확인되기 전까지는 가설`}</Text>}
      </Box>
    )
  })
}

export function isHedge(sentence: string): boolean {
  return KOREAN.test(sentence) || ENGLISH.test(sentence)
}

/** The reply with each guessing sentence marked `[?]`, and how many were marked; code is left alone. */
export function markHedges(markdown: string): { text: string; count: number } {
  let count = 0
  let isCode = false
  const lines = markdown.split('\n').map(line => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      isCode = !isCode
      return line
    }
    if (isCode || /^ {4}|^\t/.test(line) || line.trim() === '') return line
    const lead = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)*/.exec(line)?.[0] ?? ''
    const body = line.slice(lead.length)
    const sentences = body.split(/(?<=[.!?。])\s+/)
    const marked = sentences.map(s => {
      if (!isHedge(withoutCode(s))) return s
      count++
      return MARK + s
    })
    return lead + marked.join(' ')
  })
  return { text: lines.join('\n'), count }
}

function withoutCode(s: string): string {
  return s.replace(/`[^`]*`/g, '')
}
