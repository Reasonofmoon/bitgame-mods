import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Item } from '../types'
import { intensityOf, paletteOf, windowProps } from './palette'

// GAME MODE · ITEM GET
//
// A file Claude creates is an item it picked up. Its row in the transcript says so:
//   ✦ ITEM GET!  src/token.ts · 새 파일 42줄
// and /inventory lists what this session made and changed:
//   INVENTORY · 새 아이템 2 · 강화 3
//   ★ NEW  src/token.ts          +42
//   ✎ UP   src/auth.ts           +4 −4  ×2

const WRITES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const items = atom({ plugin: 'game-item-get', key: 'items' } as const, [] as Item[])

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  let root = ''

  on('session.start', async ($, e, next) => {
    root = await $.session.root()
    await $.command.register({ name: 'inventory', description: 'GAME MODE inventory: the files this session made and changed' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (intensity === 'off' || !WRITES.has(tool) || ran.deny !== undefined || ran.isError === true) return ran
    const input = e as { file_path?: unknown; notebook_path?: unknown }
    const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
    if (raw === '') return ran
    const path = relative(raw, root)
    const isNew = isCreated(ran.result)
    const stat = linesOf(ran.result)
    await update($, items, list => {
      const was = list.find(i => i.path === path)
      const item: Item = {
        path,
        isNew: (was?.isNew ?? false) || isNew,
        added: (was?.added ?? 0) + stat.added,
        removed: (was?.removed ?? 0) + stat.removed,
        hits: (was?.hits ?? 0) + 1,
      }
      return [...list.filter(i => i.path !== path), item]
    })
    if (isNew) $.ui.toast(`✦ ITEM GET! ${path}`)
    else if (intensity === 'hardcore') $.ui.toast(`✎ ${path} 강화 +${stat.added} −${stat.removed}`)
    return ran
  }).catch(($, e, next) => next(e))

  // The row of a Write that made a new file: the item banner above the engine's own result.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.tool !== 'Write' || e.props.isErrored || !isCreated(e.props.output)) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const o = e.props.output as { filePath?: unknown; content?: unknown }
    const path = relative(typeof o.filePath === 'string' ? o.filePath : '', root)
    const lines = typeof o.content === 'string' ? linesIn(o.content) : 0
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={pal.title} bold>
            ✦ ITEM GET!
          </Text>
          <Text color={pal.text} bold>
            {path}
          </Text>
          <Text color={pal.dim}>{`· 새 파일 ${lines}줄`}</Text>
        </Box>
        {below}
      </Box>
    )
  })

  on('command.run', { command: 'inventory' }, async ($) => ({ text: inventoryText(await read($, items)) }))

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.command !== 'inventory' || e.props.isErrored) return next(e)
    const list = sorted(await read($, items))
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.min(48, Math.max(12, ...list.map(i => i.path.length)))
    return (
      <Box {...windowProps(pal)} flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={pal.info} bold>
            ◆ INVENTORY
          </Text>
          <Text color={pal.text}>{`새 아이템 ${list.filter(i => i.isNew).length} · 강화 ${list.filter(i => !i.isNew).length}`}</Text>
        </Box>
        {list.length === 0 && <Text color={pal.dim}>이번 세션에 만들거나 고친 파일이 아직 없습니다.</Text>}
        {list.map(i => (
          <Box key={i.path} flexDirection="row" gap={1}>
            <Text color={i.isNew ? pal.title : pal.info} bold>
              {i.isNew ? '★ NEW' : '✎ UP '}
            </Text>
            <Text color={pal.text}>{i.path.length > width ? '…' + i.path.slice(-(width - 1)) : i.path.padEnd(width)}</Text>
            <Text color={pal.ok}>{`+${i.added}`}</Text>
            {i.removed > 0 && <Text color={pal.bad}>{`−${i.removed}`}</Text>}
            {i.hits > 1 && <Text color={pal.dim}>{`×${i.hits}`}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}

function isCreated(output: unknown): boolean {
  return output !== null && typeof output === 'object' && (output as { type?: unknown }).type === 'create'
}

/** Lines added and removed, from the patch the tool kept (or a new file's content). */
export function linesOf(output: unknown): { added: number; removed: number } {
  if (output === null || typeof output !== 'object') return { added: 0, removed: 0 }
  const o = output as { structuredPatch?: unknown; type?: unknown; content?: unknown }
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
  if (o.type === 'create' && typeof o.content === 'string') return { added: linesIn(o.content), removed: 0 }
  return { added: 0, removed: 0 }
}

function linesIn(text: string): number {
  const lines = text.split('\n')
  return lines.length - (lines[lines.length - 1] === '' ? 1 : 0)
}

/** Relative to the project root with forward slashes; a path outside it stays whole. */
export function relative(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (r === '') return p
  const isWin = /^[A-Za-z]:\//.test(r)
  const inside = isWin ? p.toLowerCase().startsWith(r.toLowerCase() + '/') : p.startsWith(r + '/')
  return inside ? p.slice(r.length + 1) : p
}

function sorted(list: readonly Item[]): Item[] {
  return [...list].sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.path.localeCompare(b.path))
}

export function inventoryText(list: readonly Item[]): string {
  const all = sorted(list)
  if (all.length === 0) return 'INVENTORY · 이번 세션에 만들거나 고친 파일이 아직 없습니다'
  return [
    `INVENTORY · 새 아이템 ${all.filter(i => i.isNew).length} · 강화 ${all.filter(i => !i.isNew).length}`,
    ...all.map(i => `${i.isNew ? '★ NEW' : '✎ UP '}  ${i.path}  +${i.added}${i.removed > 0 ? ` −${i.removed}` : ''}${i.hits > 1 ? ` ×${i.hits}` : ''}`),
  ].join('\n')
}
