import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Member } from '../types'
import { bar, clock, intensityOf, paletteOf } from './palette'

// GAME MODE · PARTY
//
// /party shows the session's subagents as a party:
//   PARTY · 3명 · 진행 1
//   ◆ Explore       ACTIVE  ████░░░░░░  8  로그인 흐름 조사
//   ◆ code-review   CLEAR   ██████████ 21  보안 검토
//   ◆ test-runner   FAIL    ██░░░░░░░░  4  테스트 고치기
// The bar is each member's tool calls against the busiest member's. The pane opens by
// itself when the session's first subagent starts, on a terminal 144 columns wide or more.

const PANE = 'party'
const members = atom({ plugin: 'game-party', key: 'members' } as const, [] as Member[])

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const autoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'party', description: 'GAME MODE party: the subagents of this session' })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId === undefined) return started
    const member: Member = {
      id: started.agentId,
      toolUseId: e.tool_use_id,
      name: e.name ?? e.subagentType,
      job: e.description,
      status: 'active',
      calls: 0,
      fails: 0,
      startedAt: await $.clock.now(),
      durationMs: null,
      isBackground: e.background,
    }
    const before = await read($, members)
    await update($, members, list => [...list, member].slice(-30))
    if (autoOpen && intensity !== 'off' && before.length === 0) void $.ui.open({ id: PANE, title: 'PARTY' }).catch(() => undefined)
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    const agentId = e.agentId
    if (agentId !== undefined) {
      await update($, members, list => list.map(m => (m.id === agentId ? { ...m, calls: m.calls + 1, fails: m.fails + (failed ? 1 : 0) } : m)))
    } else if (String(e.tool) === 'Agent' && failed) {
      // The call that started a member failed: the member failed with it.
      const now = await $.clock.now()
      await update($, members, list =>
        list.map(m => (m.toolUseId === e.tool_use_id && m.status === 'active' ? { ...m, status: 'fail', durationMs: now - m.startedAt } : m)),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A member's loop ends: it handed its report back, or it failed.
  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const status = e.reason === 'answer' ? 'clear' : 'fail'
      await update($, members, list =>
        list.map(m => (m.id === agentId && m.status === 'active' ? { ...m, status, durationMs: e.durationMs } : m)),
      )
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'party' }, async ($) => {
    if (intensity !== 'off') await $.ui.open({ id: PANE, title: 'PARTY' })
    return { text: partyText(await read($, members)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, members)
    const active = list.filter(m => m.status === 'active').length
    const most = Math.max(10, ...list.map(m => m.calls))
    const nameWidth = Math.min(16, Math.max(6, ...list.map(m => m.name.length)))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={pal.title} bold>
            PARTY
          </Text>
          <Text color={pal.text}>{`${list.length}명 · 진행 ${active}`}</Text>
        </Box>
        {list.length === 0 && <Text color={pal.dim}>아직 소환한 동료가 없습니다. Claude가 subagent를 보내면 여기 나타납니다.</Text>}
        {list.map(m => (
          <Box key={m.id} flexDirection="row" gap={1}>
            <Text color={m.isBackground ? pal.info : pal.title}>◆</Text>
            <Text color={pal.text} bold>
              {m.name.length > nameWidth ? m.name.slice(0, nameWidth - 1) + '…' : m.name.padEnd(nameWidth)}
            </Text>
            <Text color={m.status === 'active' ? pal.info : m.status === 'clear' ? pal.ok : pal.bad} bold>
              {STATUS[m.status]}
            </Text>
            <Text color={pal.ok}>{bar((m.calls / most) * 100, 10)}</Text>
            <Text color={pal.text}>{String(m.calls).padStart(3)}</Text>
            {intensity === 'hardcore' && <Text color={m.fails > 0 ? pal.bad : pal.dim}>{`✗${m.fails}`}</Text>}
            {intensity === 'hardcore' && m.durationMs !== null && <Text color={pal.dim}>{clock(m.durationMs)}</Text>}
            <Box flexGrow={1} flexShrink={1}>
              <Text color={pal.dim} wrap="truncate-end">
                {m.job}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}

const STATUS: Record<Member['status'], string> = { active: 'ACTIVE', clear: 'CLEAR ', fail: 'FAIL  ' }

export function partyText(list: readonly Member[]): string {
  if (list.length === 0) return 'PARTY · 아직 소환한 동료가 없습니다'
  return [
    `PARTY · ${list.length}명 · 진행 ${list.filter(m => m.status === 'active').length}`,
    ...list.map(m => `◆ ${m.name} ${STATUS[m.status].trim()} · 행동 ${m.calls} · ${m.job}`),
  ].join('\n')
}
