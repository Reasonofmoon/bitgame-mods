import type { EngineInterface, Register } from 'claude-code'

import { intensityOf, paletteOf, windowProps } from './palette'

// GAME MODE · ACHIEVEMENT
//
// Milestones of good habits, each raised once as a toast and kept across sessions:
//   ★ ACHIEVEMENT 역전승 — 실패한 명령을 고친 뒤 같은 명령 통과
// /achievements lists them with progress.

type Achievement = { id: string; name: string; how: string; goal?: number }

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-save', name: '첫 세이브', how: '처음으로 /save 하기' },
  { id: 'safe-10', name: '안전 운전', how: '가드 거절이 없던 턴의 커밋 10번', goal: 10 },
  { id: 'comeback', name: '역전승', how: '실패한 명령을 고친 뒤 같은 명령 통과' },
  { id: 'combo-10', name: '10 콤보', how: '성공한 행동 10번 연속', goal: 10 },
  { id: 'well-rested', name: '제때 휴식', how: 'HP가 10% 아래로 떨어지기 전에 /compact' },
]

const GUARD = /\bgame-(?:trap-guard|barrier|loop-breaker)\b/
const COMMIT = /(?:^|[;&|]\s*|\s)git\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*commit\b/
const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

type Record_ = { unlocked: Record<string, number>; safeCommits: number; bestCombo: number }

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const keep: Keeper = { isOn: intensity !== 'off', book: { unlocked: {}, safeCommits: 0, bestCombo: 0 } }
  // This session.
  let combo = 0
  let changes = 0
  const failedAt = new Map<string, number>()
  let turnCommits = 0
  let turnRefusals = 0
  let hpLeft: number | null = null

  on('session.start', async ($, e, next) => {
    keep.book = bookOf(await $.store.get('book'))
    await $.command.register({ name: 'achievements', description: 'GAME MODE achievements: what you have unlocked and how far the rest are' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turnCommits = 0
    turnRefusals = 0
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const used = e.context.percent
    if (used !== undefined && used !== null) hpLeft = 100 - used
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || intensity === 'off') return ran
    const failed = ran.deny !== undefined || ran.isError === true
    if (GUARD.test(ran.deny ?? (ran.isError === true ? ran.text ?? '' : ''))) turnRefusals++

    combo = failed ? 0 : combo + 1
    if (combo > keep.book.bestCombo) {
      keep.book = { ...keep.book, bestCombo: combo }
      await $.store.set('book', keep.book)
    }
    if (combo >= 10) await unlock($, keep, 'combo-10')

    const tool = String(e.tool)
    if (WRITES.has(tool) && !failed) changes++
    if (tool === 'Bash') {
      const command = String((e as { command?: unknown }).command ?? '').trim().replace(/\s+/g, ' ')
      if (ran.isError === true) failedAt.set(command, changes)
      else if (!failed) {
        const was = failedAt.get(command)
        if (was !== undefined && changes > was) await unlock($, keep, 'comeback')
        failedAt.delete(command)
        if (COMMIT.test(command)) turnCommits++
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Refusals by a guard seated above this plugin, and save points, as the conversation keeps them.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    const text = textOf(e.message.content)
    if (e.door === 'tool-result' && GUARD.test(text) && hasError(e.message.content)) turnRefusals++
    if (e.door === 'command' && text.includes('◆ SAVE POINT · ') && text.includes('[PASSWORD]')) await unlock($, keep, 'first-save').catch(() => undefined)
    return stored
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && turnCommits > 0 && turnRefusals === 0 && intensity !== 'off') {
      keep.book = { ...keep.book, safeCommits: keep.book.safeCommits + turnCommits }
      await $.store.set('book', keep.book)
      if (keep.book.safeCommits >= 10) await unlock($, keep, 'safe-10')
      else if (intensity === 'hardcore') $.ui.toast(`안전 운전 ${keep.book.safeCommits}/10`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined && e.trigger === 'manual' && hpLeft !== null && hpLeft > 10 && hpLeft <= 30) await unlock($, keep, 'well-rested')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'achievements' }, async () => ({ text: bookText(keep.book) }))

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.command !== 'achievements' || e.props.isErrored) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const book = keep.book
    const done = ACHIEVEMENTS.filter(a => book.unlocked[a.id] !== undefined).length
    return (
      <Box {...windowProps(pal)} flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={pal.title} bold>
            ★ ACHIEVEMENTS
          </Text>
          <Text color={pal.text}>{`${done}/${ACHIEVEMENTS.length}`}</Text>
        </Box>
        {ACHIEVEMENTS.map(a => {
          const isDone = book.unlocked[a.id] !== undefined
          return (
            <Box key={a.id} flexDirection="row" gap={1}>
              <Text color={isDone ? pal.title : pal.dim} bold>
                {isDone ? '★' : '·'}
              </Text>
              <Text color={isDone ? pal.text : pal.dim} bold={isDone}>
                {padWide(a.name, NAME_WIDTH)}
              </Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={pal.dim} wrap="truncate-end">
                  {a.how}
                </Text>
              </Box>
              <Text color={isDone ? pal.ok : pal.info}>{progressOf(a, book)}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}

type Keeper = { isOn: boolean; book: Record_ }

/** Columns a text takes in a terminal: Hangul and other wide letters take two. */
export function widthOf(text: string): number {
  let w = 0
  for (const ch of text) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
  return w
}

export function padWide(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - widthOf(text)))
}

const NAME_WIDTH = Math.max(...ACHIEVEMENTS.map(a => widthOf(a.name)))

/** Unlocks an achievement once: kept across sessions, raised as a toast. */
async function unlock($: EngineInterface, keep: Keeper, id: string): Promise<void> {
  if (!keep.isOn || keep.book.unlocked[id] !== undefined) return
  const a = ACHIEVEMENTS.find(x => x.id === id)
  if (a === undefined) return
  keep.book = { ...keep.book, unlocked: { ...keep.book.unlocked, [id]: await $.clock.now() } }
  await $.store.set('book', keep.book)
  $.ui.toast(`★ ACHIEVEMENT ${a.name} — ${a.how}`, { timeoutMs: 6000 })
}

export function progressOf(a: Achievement, book: Record_): string {
  if (book.unlocked[a.id] !== undefined) return 'CLEAR'
  if (a.id === 'safe-10') return `${Math.min(book.safeCommits, 10)}/10`
  if (a.id === 'combo-10') return `최고 ${book.bestCombo}`
  return '-'
}

export function bookText(book: Record_): string {
  const done = ACHIEVEMENTS.filter(a => book.unlocked[a.id] !== undefined).length
  return [
    `ACHIEVEMENTS · ${done}/${ACHIEVEMENTS.length}`,
    ...ACHIEVEMENTS.map(a => `${book.unlocked[a.id] !== undefined ? '★' : '·'} ${a.name} — ${a.how} · ${progressOf(a, book)}`),
  ].join('\n')
}

function bookOf(value: unknown): Record_ {
  const o = value !== null && typeof value === 'object' ? (value as Partial<Record_>) : {}
  return {
    unlocked: o.unlocked !== null && typeof o.unlocked === 'object' ? { ...o.unlocked } : {},
    safeCommits: typeof o.safeCommits === 'number' ? o.safeCommits : 0,
    bestCombo: typeof o.bestCombo === 'number' ? o.bestCombo : 0,
  }
}

function textOf(content: readonly unknown[]): string {
  return content
    .map(block => {
      if (block === null || typeof block !== 'object') return ''
      const b = block as { type?: unknown; text?: unknown; content?: unknown }
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (b.type === 'tool_result') return typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? textOf(b.content) : ''
      return ''
    })
    .join('\n')
}

function hasError(content: readonly unknown[]): boolean {
  return content.some(b => b !== null && typeof b === 'object' && (b as { is_error?: unknown }).is_error === true)
}
