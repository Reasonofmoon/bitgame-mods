import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Visit } from '../types'
import { intensityOf, paletteOf } from './palette'
import type { Palette } from './palette'

// GAME MODE · MINIMAP
//
// /minimap draws the project's files as a map, one cell per file, a row per folder:
//   MINIMAP · 파일 42 · 편집 3 · 읽음 9 · 미탐색 30
//   src/         ▓▓█░░4░░▓
//   test/        ▓█░
//   (root)       ░░▓░
//   █ 편집  ▓ 읽음  ░ 미탐색  4 = 네 번 읽음
//   가장 많이 다시 읽은 파일: src/auth.ts (4회)
// A file read three times or more shows its count: a sign Claude keeps coming back to it.

const PANE = 'minimap'
const MAX_FILES = 800
const READS = new Set(['Read'])
const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const visits = atom({ plugin: 'game-minimap', key: 'visits' } as const, {} as Record<string, Visit>)
const files = atom({ plugin: 'game-minimap', key: 'files' } as const, [] as string[])

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  let root = ''
  let isOpen = false

  on('session.start', async ($, e, next) => {
    root = await $.session.root()
    await $.command.register({ name: 'minimap', description: 'GAME MODE minimap: the project\'s files, edited, read and unexplored' })
    return next(e)
  })

  // Every loop explores the same project: a subagent's reads count too.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (ran.deny !== undefined || ran.isError === true || (!READS.has(tool) && !WRITES.has(tool))) return ran
    const input = e as { file_path?: unknown; notebook_path?: unknown }
    const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
    const path = relative(raw, root)
    if (path !== undefined) {
      await update($, visits, v => {
        const was = v[path] ?? { reads: 0, isEdited: false }
        return { ...v, [path]: READS.has(tool) ? { ...was, reads: was.reads + 1 } : { ...was, isEdited: true } }
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (isOpen && e.agentId === undefined) await survey($).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'minimap' }, async ($) => {
    await survey($).catch(() => undefined)
    if (intensity !== 'off') {
      await $.ui.open({ id: PANE, title: 'MINIMAP' })
      isOpen = true
    }
    const s = summaryOf(await read($, files), await read($, visits))
    return { text: `MINIMAP · 파일 ${s.total} · 편집 ${s.edited} · 읽음 ${s.read} · 미탐색 ${s.unexplored}${s.top.length > 0 ? `\n가장 많이 다시 읽은 파일: ${s.top[0]?.path} (${s.top[0]?.reads}회)` : ''}` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isOpen = false
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, files)
    const v = await read($, visits)
    const s = summaryOf(all, v)
    const labelWidth = 13
    const cellsPerRow = Math.max(8, e.props.bodyColumns - labelWidth)
    const rows: RenderElement[] = []
    for (const [folder, paths] of groupsOf(s.paths)) {
      for (let at = 0; at < paths.length; at += cellsPerRow) {
        const runs = runsOf(paths.slice(at, at + cellsPerRow), v, pal)
        rows.push(
          <Box key={`${folder}:${at}`} flexDirection="row">
            <Text color={pal.dim}>{(at === 0 ? folder : '').padEnd(labelWidth).slice(0, labelWidth)}</Text>
            {runs.map((r, i) => (
              <Text key={String(i)} color={r.color}>
                {r.text}
              </Text>
            ))}
          </Box>,
        )
      }
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={pal.title} bold>
            MINIMAP
          </Text>
          <Text color={pal.text}>{`파일 ${s.total} · 편집 ${s.edited} · 읽음 ${s.read} · 미탐색 ${s.unexplored}`}</Text>
        </Box>
        {rows}
        <Box flexDirection="row" gap={2}>
          <Text color={pal.title}>█ 편집</Text>
          <Text color={pal.info}>▓ 읽음</Text>
          <Text color={pal.dim}>░ 미탐색</Text>
          <Text color={pal.warn}>3 = 세 번 읽음</Text>
        </Box>
        {s.top.length > 0 && (
          <Text color={pal.text}>{`가장 많이 다시 읽은 파일: ${s.top[0]?.path} (${s.top[0]?.reads}회)`}</Text>
        )}
        {intensity === 'hardcore' &&
          s.top.slice(1, 5).map(t => (
            <Text key={t.path} color={pal.dim}>{`  ${t.path} (${t.reads}회)`}</Text>
          ))}
      </Box>
    )
  })
}

/** The project's files from git (tracked and untracked, ignored left out). */
async function survey($: EngineInterface): Promise<void> {
  const listed = await $.process.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], { timeoutMs: 8000 })
  if (listed.exitCode !== 0) return
  const list = listed.stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
    .slice(0, MAX_FILES)
  await update($, files, () => list)
}

/** The path relative to the project root with forward slashes; undefined outside it. */
export function relative(path: string, root: string): string | undefined {
  if (path === '') return undefined
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (!/^(?:[A-Za-z]:)?\//.test(p)) return p.replace(/^\.\//, '')
  const isWin = /^[A-Za-z]:\//.test(r)
  const inside = isWin ? p.toLowerCase().startsWith(r.toLowerCase() + '/') : p.startsWith(r + '/')
  return inside ? p.slice(r.length + 1) : undefined
}

type Summary = { paths: string[]; total: number; edited: number; read: number; unexplored: number; top: { path: string; reads: number }[] }

export function summaryOf(list: readonly string[], v: Readonly<Record<string, Visit>>): Summary {
  const paths = [...new Set([...list, ...Object.keys(v)])].sort()
  let edited = 0
  let read = 0
  for (const p of paths) {
    const x = v[p]
    if (x?.isEdited) edited++
    else if ((x?.reads ?? 0) > 0) read++
  }
  const top = Object.entries(v)
    .filter(([, x]) => x.reads >= 2)
    .sort((a, b) => b[1].reads - a[1].reads || a[0].localeCompare(b[0]))
    .map(([path, x]) => ({ path, reads: x.reads }))
  return { paths, total: paths.length, edited, read, unexplored: paths.length - edited - read, top }
}

/** Files by their top folder (`src/`), the root's own last as `(root)`. */
export function groupsOf(paths: readonly string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const p of paths) {
    const slash = p.indexOf('/')
    const folder = slash === -1 ? '(root)' : p.slice(0, slash + 1)
    groups.set(folder, [...(groups.get(folder) ?? []), p])
  }
  return [...groups].sort((a, b) => (a[0] === '(root)' ? 1 : b[0] === '(root)' ? -1 : a[0].localeCompare(b[0])))
}

/** One file's cell: its read count from three reads, else edited, read or unexplored. */
export function cellOf(x: Visit | undefined): { glyph: string; kind: 'edited' | 'read' | 'none' } {
  const kind = x?.isEdited ? 'edited' : (x?.reads ?? 0) > 0 ? 'read' : 'none'
  const reads = x?.reads ?? 0
  if (reads >= 3) return { glyph: reads >= 10 ? '+' : String(reads), kind }
  return { glyph: kind === 'edited' ? '█' : kind === 'read' ? '▓' : '░', kind }
}

/** Neighbouring cells of one color drawn as one text. */
function runsOf(paths: readonly string[], v: Readonly<Record<string, Visit>>, pal: Palette): { text: string; color: string }[] {
  const runs: { text: string; color: string }[] = []
  for (const p of paths) {
    const cell = cellOf(v[p])
    const color = /\d|\+/.test(cell.glyph) ? pal.warn : cell.kind === 'edited' ? pal.title : cell.kind === 'read' ? pal.info : pal.dim
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === color) last.text += cell.glyph
    else runs.push({ text: cell.glyph, color })
  }
  return runs
}
