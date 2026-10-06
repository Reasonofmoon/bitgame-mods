import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Quest, QuestLog } from '../types'
import { bar, intensityOf, paletteOf } from './palette'

// GAME MODE · QUEST
//
// /quest opens the task list as a quest log:
//   QUEST LOG · 2/4 클리어 ████░░░░░░
//   ✓ 저장소 구조 파악
//   ▶ 토큰 만료 단위 수정 · 단위를 맞추는 중
//   · README 갱신
//   · 전체 테스트 통과                        BOSS
// The list is the one Claude keeps (TodoWrite, or TaskCreate and TaskUpdate). It is kept
// for the project, so /compact and the next session in the same folder start from it.

const PANE = 'quest'
const EMPTY: QuestLog = { quests: [], isCarried: false, updatedAt: 0 }
const log = atom({ plugin: 'game-quest', key: 'log' } as const, EMPTY)

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  let key = 'log'

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    key = `log:${await $.session.root()}`
    await $.command.register({ name: 'quest', description: 'GAME MODE quest log: the task list as quests', argumentHint: '[clear]' })
    const kept = logOf(await $.store.get(key))
    if (kept.quests.length > 0 && (await read($, log)).quests.length === 0) {
      await update($, log, () => ({ ...kept, isCarried: true }))
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran
    const now = await $.clock.now()
    let change: ((l: QuestLog) => QuestLog) | undefined
    if (e.tool === 'TodoWrite') {
      const quests = todosOf(e.todos)
      change = () => ({ quests, isCarried: false, updatedAt: now })
    } else if (e.tool === 'TaskCreate') {
      const id = createdId(ran.result)
      if (id !== undefined) {
        const quest: Quest = { id, text: e.subject, doing: e.activeForm ?? '', status: 'pending' }
        change = l => ({ quests: [...(l.isCarried ? [] : l.quests), quest], isCarried: false, updatedAt: now })
      }
    } else if (e.tool === 'TaskUpdate') {
      const { taskId, status, subject, activeForm } = e
      change = l => ({
        ...l,
        updatedAt: now,
        quests:
          status === 'deleted'
            ? l.quests.filter(q => q.id !== taskId)
            : l.quests.map(q =>
                q.id === taskId ? { ...q, status: status ?? q.status, text: subject ?? q.text, doing: activeForm ?? q.doing } : q,
              ),
      })
    }
    if (change !== undefined) await keep($, key, change).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'quest' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'clear') {
      await keep($, key, () => EMPTY)
      return { text: 'quest log cleared' }
    }
    if (intensity !== 'off') await $.ui.open({ id: PANE, title: 'QUEST' })
    return { text: questText(await read($, log)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const l = await read($, log)
    const done = l.quests.filter(q => q.status === 'completed').length
    const total = l.quests.length
    const width = Math.max(20, e.props.bodyColumns)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={pal.title} bold>
            QUEST LOG
          </Text>
          <Text color={pal.text}>{total === 0 ? '퀘스트 없음' : `${done}/${total} 클리어`}</Text>
          {total > 0 && <Text color={pal.ok}>{bar((done / total) * 100, Math.min(10, Math.max(4, width - 30)))}</Text>}
          {l.isCarried && <Text color={pal.dim}>지난 세션에서 이어짐</Text>}
        </Box>
        {total === 0 && <Text color={pal.dim}>Claude가 할 일 목록을 만들면 여기 퀘스트로 나타납니다.</Text>}
        {l.quests.map((q, i) => {
          const isBoss = i === total - 1 && total > 1
          const mark = q.status === 'completed' ? '✓' : q.status === 'in_progress' ? '▶' : '·'
          const tone = q.status === 'completed' ? pal.ok : q.status === 'in_progress' ? pal.title : pal.text
          return (
            <Box key={q.id} flexDirection="row" gap={1}>
              <Text color={tone} bold>
                {mark}
              </Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={q.status === 'completed' ? pal.dim : tone} wrap="truncate-end">
                  {q.text + (intensity === 'hardcore' && q.status === 'in_progress' && q.doing !== '' ? ` · ${q.doing}` : '')}
                </Text>
              </Box>
              {isBoss && (
                <Text color={pal.bad} bold>
                  BOSS
                </Text>
              )}
            </Box>
          )
        })}
        {total > 0 && done === total && (
          <Text color={pal.title} bold>
            ALL CLEAR!
          </Text>
        )}
      </Box>
    )
  })
}

/** Changes the log and keeps it for the project. */
async function keep($: EngineInterface, key: string, change: (l: QuestLog) => QuestLog): Promise<void> {
  await update($, log, change)
  const now = await read($, log)
  await $.store.set(key, { quests: now.quests, updatedAt: now.updatedAt })
}

export function todosOf(todos: unknown): Quest[] {
  if (!Array.isArray(todos)) return []
  return todos.flatMap((t, i) => {
    if (t === null || typeof t !== 'object') return []
    const o = t as { content?: unknown; status?: unknown; activeForm?: unknown }
    if (typeof o.content !== 'string') return []
    const status = o.status === 'completed' || o.status === 'in_progress' ? o.status : 'pending'
    return [{ id: `todo-${i}`, text: o.content, doing: typeof o.activeForm === 'string' ? o.activeForm : '', status }]
  })
}

function createdId(result: unknown): string | undefined {
  const task = result !== null && typeof result === 'object' ? (result as { task?: { id?: unknown } }).task : undefined
  return typeof task?.id === 'string' ? task.id : undefined
}

export function logOf(value: unknown): QuestLog {
  if (value === null || typeof value !== 'object') return EMPTY
  const o = value as { quests?: unknown; updatedAt?: unknown }
  const quests = Array.isArray(o.quests)
    ? o.quests.filter((q): q is Quest => q !== null && typeof q === 'object' && typeof (q as Quest).id === 'string' && typeof (q as Quest).text === 'string')
    : []
  return { quests, isCarried: false, updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0 }
}

export function questText(l: QuestLog): string {
  if (l.quests.length === 0) return 'QUEST LOG · 퀘스트 없음'
  const done = l.quests.filter(q => q.status === 'completed').length
  const lines = l.quests.map((q, i) => {
    const mark = q.status === 'completed' ? '✓' : q.status === 'in_progress' ? '▶' : '·'
    return `${mark} ${q.text}${i === l.quests.length - 1 && l.quests.length > 1 ? '  BOSS' : ''}`
  })
  return [`QUEST LOG · ${done}/${l.quests.length} 클리어${l.isCarried ? ' · 지난 세션에서 이어짐' : ''}`, ...lines].join('\n')
}
