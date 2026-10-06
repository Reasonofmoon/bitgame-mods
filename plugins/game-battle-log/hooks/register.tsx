import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BattleRun, CallMark } from '../types'
import { intensityOf, paletteOf } from './palette'
import type { Palette } from './palette'

// GAME MODE · BATTLE LOG
//
// Tool rows as a battle log, so a failure stands out in a long transcript:
//   ⚔ BATTLE LOG · TURN 3
//   ▸ BASH  npm test                         HIT
//   ▸ EDIT  src/auth.ts             +3 −1    CRIT  COMBO ×3
//   ▸ BASH  npm test                         MISS  COMBO ×3 → BREAK
//     ✗ 2 failed
//   ▸ BASH  cat .env                         TRAP!
//     ✗ game-trap-guard blocked this call: …
// The first row of each turn carries the turn's number. Three or more clean calls in a row
// are a combo, and the failure that ends one says so. Edits show the lines they add and
// remove. A GAME MODE guard's refusal shows that guard's verdict (TRAP!, BARRIER!, LOOP!).
// A folded group of reads and searches stays one line (탐색 ×5 … HIT) and unfolds by itself
// when one of its calls failed. The run-in-background pill reads SUMMON.
//
// Only one-line tools are redrawn (ROWS below). Rows that draw their own content (TodoWrite,
// Agent, ExitPlanMode, AskUserQuestion, MCP tools) are left to the engine, with the turn
// header above them when they open a turn, and successful results (diffs, output) keep the
// engine's own drawing.
//
// Turns, combos and first rows are counted from the rows the conversation keeps
// (session.append), where every call's row passes whichever plugin refused the call, and
// from tool.call, whichever comes first.

const ROWS: Record<string, string> = {
  Bash: 'BASH',
  Read: 'READ',
  Edit: 'EDIT',
  MultiEdit: 'EDIT',
  Write: 'WRITE',
  NotebookEdit: 'NOTE',
  Grep: 'GREP',
  Glob: 'GLOB',
  LS: 'LS',
  WebFetch: 'FETCH',
  WebSearch: 'SEARCH',
  BashOutput: 'OUTPUT',
  KillShell: 'KILL',
}

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const BLOCKED = /\bgame-(?:trap-guard|barrier|loop-breaker)\b/
// Each guard's own verdict, by the name its refusal starts with.
const GUARDS: readonly (readonly [RegExp, string])[] = [
  [/\bgame-trap-guard\b/, 'TRAP!'],
  [/\bgame-barrier\b/, 'BARRIER!'],
  [/\bgame-loop-breaker\b/, 'LOOP!'],
]
const COMBO_MIN = 3

const NONE: CallMark = { turn: 0, isFirst: false, combo: null, broke: 0 }
const START: BattleRun = { turn: 0, isTurnOpen: false, combo: 0 }

const isOn = atom({ plugin: 'game-battle-log', key: 'isOn' } as const, true)
const run = atom({ plugin: 'game-battle-log', key: 'run' } as const, START)
// One mark per call, by its tool_use_id (the row's requestId).
const call = atom({ plugin: 'game-battle-log', key: 'call' } as const, NONE)

type Kind = 'run' | 'hit' | 'crit' | 'miss' | 'block' | 'esc'

const WORDS: Record<'casual' | 'hardcore', Record<Kind, string>> = {
  casual: { run: '…', hit: 'HIT', crit: 'CRIT', miss: 'MISS', block: 'BLOCK', esc: 'ESC' },
  hardcore: { run: 'CASTING…', hit: 'HIT!', crit: 'CRITICAL!', miss: 'MISS…', block: 'BLOCKED!', esc: 'ESCAPE' },
}

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const words = WORDS[intensity === 'hardcore' ? 'hardcore' : 'casual']
  let root = ''

  on('session.start', async ($, e, next) => {
    root = await $.session.root()
    const stored = await $.store.get('isOn')
    if (stored === false) await update($, isOn, () => false)
    await $.command.register({
      name: 'battle-log',
      description: 'GAME MODE battle log: turn the tool-row styling on or off',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  // A turn opens: its first call carries the header.
  on('turn.start', async ($, e, next) => {
    const sent = await $.session.turns()
    await update($, run, r => ({ ...r, turn: Math.max(sent, r.turn + 1), isTurnOpen: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Calls of the main loop, seen twice: as the conversation keeps them (the model's tool_use
  // block, then its result, a guard's refusal included whichever plugin refused it) and as they
  // run. Each call is marked once, by whichever comes first.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    if (e.door === 'response') {
      for (const id of usesOf(e.message.content)) await made($, id).catch(() => undefined)
    } else if (e.door === 'tool-result') {
      for (const r of resultsOf(e.message.content)) await answered($, r.id, r.isError).catch(() => undefined)
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await made($, e.tool_use_id).catch(() => undefined)
    const ran = await next(e)
    await answered($, e.tool_use_id, ran.deny !== undefined || ran.isError === true).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (intensity === 'off' || !(await read($, isOn))) return next(e)
    const mark = await read($, memberOf(call, { requestId: e.props.tool_use_id }))
    const { Box, Text } = $.ui.resolve(e)
    const header = (
      <Text color={pal.title} bold>
        {`⚔ BATTLE LOG · TURN ${mark.turn}`}
      </Text>
    )

    const tool = String(e.props.tool)
    const label = ROWS[tool]
    if (label === undefined) {
      if (!mark.isFirst) return next(e)
      const below = await next(e)
      return (
        <Box flexDirection="column">
          {header}
          {below}
        </Box>
      )
    }

    const text = textOf(e.props.output)
    const kind = kindOf(tool, e.props, text)
    const shown = kind === 'miss' || kind === 'block' ? excerpt(text, 3) : undefined
    const stat = kind === 'crit' ? diffstat(e.props.output) : undefined
    const combo = comboOf(mark)

    return (
      <Box flexDirection="column">
        {mark.isFirst && header}
        <Box flexDirection="row" gap={1}>
          <Text color={pal.title}>{intensity === 'hardcore' ? '▶' : '▸'}</Text>
          <Text color={WRITES.has(tool) ? pal.info : pal.text} bold>
            {intensity === 'hardcore' ? `CLAUDE의 ${label}!` : label}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={pal.dim} wrap="truncate-end">
              {summarize(tool, e.props.input, root)}
            </Text>
          </Box>
          {stat !== undefined && <Text color={pal.ok}>{`+${stat.added}`}</Text>}
          {stat !== undefined && <Text color={pal.bad}>{`−${stat.removed}`}</Text>}
          <Text color={toneOf(kind, pal)} bold>
            {kind === 'block' ? (guardOf(text) ?? words.block) : words[kind]}
          </Text>
          {combo !== undefined && (
            <Text color={combo.isBreak ? pal.bad : pal.title} bold>
              {combo.text}
            </Text>
          )}
        </Box>
        {shown?.lines.map(line => (
          <Text color={kind === 'block' ? pal.title : pal.bad} wrap="truncate-end">
            {'  ✗ ' + line}
          </Text>
        ))}
        {shown !== undefined && shown.more > 0 && <Text color={pal.dim}>{`  … +${shown.more}줄 (ctrl+o)`}</Text>}
      </Box>
    )
  })

  // The ToolUse row above already shows the failure's first lines.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (intensity === 'off' || !e.props.isErrored || ROWS[String(e.props.tool)] === undefined) return next(e)
    if (!(await read($, isOn))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // An unfolded group's rows are ToolUse rows: the one that opens the turn draws the header.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.isExpanded || !(await read($, isOn))) return next(e)
    const calls = e.props.calls
    if (calls.some(c => c.isErrored)) return next({ ...e, props: { ...e.props, isExpanded: true } })

    const marks: CallMark[] = []
    for (const c of calls) marks.push(c.tool_use_id === undefined ? NONE : await read($, memberOf(call, { requestId: c.tool_use_id })))
    const first = marks.find(m => m.isFirst)
    const last = [...marks].reverse().find(m => m.combo !== null)
    const combo = last === undefined ? undefined : comboOf(last)

    const { Box, Text } = $.ui.resolve(e)
    const counts = new Map<string, number>()
    for (const c of calls) {
      const name = ROWS[String(c.tool)] ?? String(c.tool).toUpperCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const isRunning = e.props.isActive && calls.some(c => c.isRunning)
    const detail = [...counts].map(([name, n]) => `${name} ${n}`).join(' · ')

    return (
      <Box flexDirection="column">
        {first !== undefined && (
          <Text color={pal.title} bold>
            {`⚔ BATTLE LOG · TURN ${first.turn}`}
          </Text>
        )}
        <Box flexDirection="row" gap={1}>
          <Text color={pal.title}>{intensity === 'hardcore' ? '▶' : '▸'}</Text>
          <Text color={pal.info} bold>
            {`탐색 ×${calls.length}`}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={pal.dim} wrap="truncate-end">
              {detail}
            </Text>
          </Box>
          <Text color={isRunning ? pal.dim : pal.ok} bold>
            {isRunning ? words.run : words.hit}
          </Text>
          {!isRunning && combo !== undefined && (
            <Text color={combo.isBreak ? pal.bad : pal.title} bold>
              {combo.text}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // The run-in-background pill: hand the call to a summon and keep going.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.kind !== 'background_hint' || !(await read($, isOn))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={pal.info} bold>
          SUMMON
        </Text>
        <Text color={pal.dim}>{`${keyOf(e.props.hint)} ▸ 소환수에게 맡기기 (백그라운드)`}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'battle-log' }, async ($, e) => {
    const sub = e.args.trim().toLowerCase()
    if (sub === 'on' || sub === 'off') {
      await $.store.set('isOn', sub === 'on')
      await update($, isOn, () => sub === 'on')
      return { text: `battle log ${sub}` }
    }
    const now = await read($, isOn)
    return { text: `battle log ${now ? 'on' : 'off'} · intensity ${intensity}\n/battle-log on · /battle-log off` }
  })
}

type RowState = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

/** A call was made: the turn it belongs to and whether it opens that turn. Once per call. */
async function made($: EngineInterface, id: string): Promise<void> {
  const mark = await read($, memberOf(call, { requestId: id }))
  if (mark.turn !== 0) return
  const now = await read($, run)
  if (now.isTurnOpen) await update($, run, r => ({ ...r, isTurnOpen: false }))
  await update($, memberOf(call, { requestId: id }), m => ({ ...m, turn: now.turn, isFirst: now.isTurnOpen }))
}

/** A call was answered: the run of clean calls it extends, or the one it ends. Once per call. */
async function answered($: EngineInterface, id: string, isError: boolean): Promise<void> {
  const mark = await read($, memberOf(call, { requestId: id }))
  if (mark.combo !== null) return
  const before = (await read($, run)).combo
  const combo = isError ? 0 : before + 1
  await update($, run, r => ({ ...r, combo }))
  await update($, memberOf(call, { requestId: id }), m => ({ ...m, combo, broke: isError ? before : 0 }))
}

/** The ids of the tool_use blocks in a stored row. */
export function usesOf(content: readonly unknown[]): string[] {
  const ids: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; id?: unknown }
    if (b.type === 'tool_use' && typeof b.id === 'string') ids.push(b.id)
  }
  return ids
}

/** The tool results in a stored row, in order, with whether each one failed. */
export function resultsOf(content: readonly unknown[]): { id: string; isError: boolean }[] {
  const out: { id: string; isError: boolean }[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; tool_use_id?: unknown; is_error?: unknown }
    if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') out.push({ id: b.tool_use_id, isError: b.is_error === true })
  }
  return out
}

/** `COMBO ×n` from three clean calls in a row; on the failure that ends one, `COMBO ×n → BREAK`. */
export function comboOf(mark: CallMark): { text: string; isBreak: boolean } | undefined {
  if (mark.combo === null) return undefined
  if (mark.combo === 0) return mark.broke >= COMBO_MIN ? { text: `COMBO ×${mark.broke} → BREAK`, isBreak: true } : undefined
  return mark.combo >= COMBO_MIN ? { text: `COMBO ×${mark.combo}`, isBreak: false } : undefined
}

/** The verdict of the GAME MODE guard that refused a call, by the name its refusal carries. */
export function guardOf(text: string): string | undefined {
  return GUARDS.find(([name]) => name.test(text))?.[1]
}

/** The key the background pill names (`ctrl+b`, or the person's own binding). */
export function keyOf(hint: string): string {
  return /\(\s*(.+?)\s+to run in background\s*\)/.exec(hint)?.[1] ?? 'ctrl+b'
}

/** Lines an edit or a write added and removed, from the patch the tool kept. */
export function diffstat(output: unknown): { added: number; removed: number } | undefined {
  if (output === null || typeof output !== 'object') return undefined
  const o = output as { structuredPatch?: unknown; gitDiff?: unknown; type?: unknown; content?: unknown }
  if (Array.isArray(o.structuredPatch) && o.structuredPatch.length > 0) {
    let added = 0
    let removed = 0
    for (const hunk of o.structuredPatch) {
      const lines = hunk !== null && typeof hunk === 'object' ? (hunk as { lines?: unknown }).lines : undefined
      if (!Array.isArray(lines)) continue
      for (const line of lines) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
    return { added, removed }
  }
  const git = o.gitDiff as { additions?: unknown; deletions?: unknown } | undefined
  if (git !== undefined && typeof git.additions === 'number' && typeof git.deletions === 'number') {
    return { added: git.additions, removed: git.deletions }
  }
  if (o.type === 'create' && typeof o.content === 'string') {
    const lines = o.content.split('\n')
    return { added: lines.length - (lines[lines.length - 1] === '' ? 1 : 0), removed: 0 }
  }
  return undefined
}

export function kindOf(tool: string, row: RowState, text: string): Kind {
  if (row.isRunning) return 'run'
  if (row.isInterrupted) return 'esc'
  if (row.isErrored) return BLOCKED.test(text) ? 'block' : 'miss'
  return WRITES.has(tool) ? 'crit' : 'hit'
}

function toneOf(kind: Kind, pal: Palette): string {
  switch (kind) {
    case 'hit':
      return pal.ok
    case 'crit':
      return pal.info
    case 'miss':
      return pal.bad
    case 'block':
      return pal.title
    default:
      return pal.dim
  }
}

function field(input: unknown, key: string): string | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The path relative to the project root; on Windows, slash direction and case are ignored. */
export function short(path: string, root: string): string {
  if (root === '') return path
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  const isWin = /^[A-Za-z]:\//.test(r)
  const inside = isWin ? p.toLowerCase().startsWith(r.toLowerCase() + '/') : p.startsWith(r + '/')
  return inside ? p.slice(r.length + 1) : path
}

export function summarize(tool: string, input: unknown, root: string): string {
  switch (tool) {
    case 'Bash': {
      const command = field(input, 'command') ?? ''
      const lines = command.trim().split('\n')
      return (lines[0] ?? '').replace(/\s+/g, ' ') + (lines.length > 1 ? ' …' : '')
    }
    case 'Grep':
    case 'Glob': {
      const pattern = field(input, 'pattern') ?? ''
      const where = field(input, 'path')
      return `"${pattern}"` + (where ? ` in ${short(where, root)}` : '')
    }
    case 'WebFetch':
      return field(input, 'url') ?? ''
    case 'WebSearch':
      return field(input, 'query') ?? ''
    case 'BashOutput':
      return field(input, 'bash_id') ?? ''
    case 'KillShell':
      return field(input, 'shell_id') ?? ''
    default: {
      const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path') ?? ''
      return short(path, root)
    }
  }
}

export function textOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (output !== null && typeof output === 'object') {
    const o = output as Record<string, unknown>
    const parts = [o.stdout, o.stderr].filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (parts.length > 0) return parts.join('\n')
    try {
      return JSON.stringify(output).slice(0, 4000)
    } catch {
      return ''
    }
  }
  return ''
}

// Lines that only say a failure happened, or say nothing about it.
const NOISE = /^(?:Exit code \d+|TAP version \d+|.*\b(?:Warning|DeprecationWarning|ExperimentalWarning)\b.*)$/
// Lines that say what failed.
const SIGNAL = /\b(?:fail(?:ed|ure|ing)?|errors?|not ok|exception|cannot|can't|denied|not found|no such|expected|assert\w*|blocked|refused|panic\w*|traceback)\b|[✗✕×]/i

/** The lines worth seeing first: what failed, in order; plain lines only when none says so. */
export function excerpt(text: string, max: number): { lines: string[]; more: number } {
  const all = text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map(l => l.trimEnd().replace(/^Error: (?=\S)/, ''))
    .filter(l => l.trim().length > 0)
  const useful = all.filter(l => !NOISE.test(l.trim()))
  const signal = useful.filter(l => SIGNAL.test(l))
  const picked = (signal.length > 0 ? signal : useful.length > 0 ? useful : all).slice(0, max)
  return { lines: picked.map(l => (l.length > 160 ? l.slice(0, 159) + '…' : l)), more: Math.max(0, all.length - picked.length) }
}
