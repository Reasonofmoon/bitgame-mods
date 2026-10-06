import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { intensityOf, paletteOf } from './palette'
import type { Palette } from './palette'

// GAME MODE · BATTLE LOG
//
// Tool rows as a battle log, so a failure stands out in a long transcript:
//   ▸ BASH  npm test                      HIT    ran without an error
//   ▸ EDIT  src/auth.ts                   CRIT   changed a file
//   ▸ BASH  npm test                      MISS   errored; first lines shown
//     ✗ 2 failed
//   ▸ BASH  curl …                        BLOCK  a GAME MODE guard refused it
// A folded group of reads and searches stays one line (탐색 ×5 … HIT) and
// unfolds by itself when one of its calls failed.
//
// Only one-line tools are redrawn (ROWS below). Rows that draw their own
// content (TodoWrite, Agent, ExitPlanMode, AskUserQuestion, MCP tools) are
// left to the engine, and successful results (diffs, output) keep the
// engine's own drawing.

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

const isOn = atom({ plugin: 'game-battle-log', key: 'isOn' } as const, true)

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

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const label = ROWS[String(e.props.tool)]
    if (intensity === 'off' || label === undefined || !(await read($, isOn))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const text = textOf(e.props.output)
    const kind = kindOf(String(e.props.tool), e.props, text)
    const shown = kind === 'miss' || kind === 'block' ? excerpt(text, 3) : undefined
    const tone = toneOf(kind, pal)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={pal.title}>{intensity === 'hardcore' ? '▶' : '▸'}</Text>
          <Text color={WRITES.has(String(e.props.tool)) ? pal.info : pal.text} bold>
            {intensity === 'hardcore' ? `CLAUDE의 ${label}!` : label}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={pal.dim} wrap="truncate-end">
              {summarize(String(e.props.tool), e.props.input, root)}
            </Text>
          </Box>
          <Text color={tone} bold>
            {words[kind]}
          </Text>
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

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.isExpanded || !(await read($, isOn))) return next(e)
    const calls = e.props.calls
    if (calls.some(c => c.isErrored)) return next({ ...e, props: { ...e.props, isExpanded: true } })

    const { Box, Text } = $.ui.resolve(e)
    const counts = new Map<string, number>()
    for (const c of calls) {
      const name = ROWS[String(c.tool)] ?? String(c.tool).toUpperCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const isRunning = e.props.isActive && calls.some(c => c.isRunning)
    const detail = [...counts].map(([name, n]) => `${name} ${n}`).join(' · ')

    return (
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

function short(path: string, root: string): string {
  return root !== '' && path.startsWith(root + '/') ? path.slice(root.length + 1) : path
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
