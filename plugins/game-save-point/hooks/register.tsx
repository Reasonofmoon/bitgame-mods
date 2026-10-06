import type { EngineInterface, Register } from 'claude-code'

import type { Save } from '../types'
import { intensityOf, paletteOf } from './palette'

// GAME MODE · SAVE POINT
//
// /save        Claude writes a save of this session (what was cleared, the
//              quest log, decisions waiting on you, a resume prompt, the
//              items made) through $.model.fork, over the same transcript,
//              so the prompt cache serves it. In a session resumed with
//              --continue that has not sent anything yet, the stored
//              transcript is summarized instead. Kept per project, last 5.
// /save show   the latest save again · /save list   the last five
// /load [n]    puts save n's resume prompt in the prompt box (1 = latest)
//
// Next session in the same project: the status line names the save and the
// empty prompt box offers its resume prompt, Tab to take it.

const MAX_SAVES = 5
const HEADER = '◆ SAVE POINT · '

const FORK_PROMPT = [
  'Write a SAVE POINT for this coding session so the user can resume it later in a new session.',
  'Reply with one JSON object only, no prose and no code fence, in this shape:',
  '{"title": "...", "done": ["..."], "todo": ["..."], "decide": ["..."], "resume": "...", "artifacts": ["..."]}',
  '- title: the quest in a few words',
  '- done: what was finished, short items, at most 6',
  '- todo: what is left, at most 6',
  '- decide: decisions only the user can make, at most 4 (an empty list when none)',
  '- resume: one prompt the user can paste into a new session to continue exactly here; name the files and the next concrete step',
  '- artifacts: files, branches, PRs or links produced, at most 8',
  'Write the strings in the language the user wrote in. State only what happened in this session.',
].join('\n')

type Slots = Record<string, Save[]>

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const maxAgeDays = Math.max(1, Math.min(365, Number(options.maxAgeDays ?? 14) || 14))
  let showingSave = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'save',
      description: 'GAME MODE save point: save this session (status summary + resume prompt), or show / list saves',
      argumentHint: '[note|show|list]',
    })
    await $.command.register({
      name: 'load',
      description: 'GAME MODE save point: put a save\'s resume prompt in the prompt box (1 = latest)',
      argumentHint: '[n]',
    })

    const root = await $.session.root()
    const last = (await slotsOf($))[root]?.[0]
    const now = await $.clock.now()
    if (last !== undefined && now - last.savedAt <= maxAgeDays * 86_400_000) {
      showingSave = true
      $.ui.status(`◆ SAVE ${ago(now - last.savedAt)} · ${last.title} · Tab 이어하기 · /load`)
      offer($, last.resume, 0)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (showingSave) {
      showingSave = false
      $.ui.status(undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'save' }, async ($, e) => {
    const root = await $.session.root()
    const slots = await slotsOf($)
    const saves = slots[root] ?? []
    const sub = e.args.trim()

    if (sub === 'show') {
      const last = saves[0]
      return { text: last ? screenText(last, 1, saves.length) : 'No save in this project yet. Type /save to make one.' }
    }
    if (sub === 'list') {
      if (saves.length === 0) return { text: 'No save in this project yet. Type /save to make one.' }
      return { text: saves.map((s, i) => `${i + 1}. ${stamp(s.savedAt)} · ${s.title}`).join('\n') + '\n\n/load <n> puts that save\'s resume prompt in the prompt box.' }
    }

    const prompt = sub === '' ? FORK_PROMPT : `${FORK_PROMPT}\nThe user's note for this save: ${sub}`
    const reply = await summarize($, prompt)
    if (reply.text === undefined) return { text: reply.why, exitCode: reply.isEmpty ? 0 : 1 }

    const usage = await $.session.usage()
    const save: Save = {
      ...parseSave(reply.text),
      v: 1,
      savedAt: await $.clock.now(),
      root,
      turns: await $.session.turns(),
      usd: usage.cost?.usd ?? null,
      contextUsed: usage.context.percent ?? null,
    }
    const kept = [save, ...saves].slice(0, MAX_SAVES)
    await $.store.set('slots', { ...slots, [root]: kept })
    $.ui.toast('♪ 세이브 완료')
    return { text: screenText(save, 1, kept.length) }
  })

  on('command.run', { command: 'load' }, async ($, e) => {
    const root = await $.session.root()
    const saves = (await slotsOf($))[root] ?? []
    const n = Math.max(1, Number.parseInt(e.args.trim() || '1', 10) || 1)
    const save = saves[n - 1]
    if (save === undefined) return { text: saves.length === 0 ? 'No save in this project yet.' : `There are ${saves.length} saves; /save list shows them.` }
    const filled = await $.prompt.fill({ text: save.resume })
    showingSave = false
    $.ui.status(undefined)
    const tail = filled.isFilled ? '\n\nThe resume prompt is in the prompt box: edit it or press Enter.' : `\n\nResume prompt:\n${save.resume}`
    return { text: screenText(save, n, saves.length) + tail }
  })

  // The save screen, drawn from the row's own text so each row shows its own save.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (intensity === 'off' || (e.props.command !== 'save' && e.props.command !== 'load')) return next(e)
    const save = parseScreen(e.props.text)
    if (save === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    const section = (title: string, items: string[], color: string, mark: string) =>
      items.length === 0 ? null : (
        <Box flexDirection="column">
          <Text color={color} bold>
            {title}
          </Text>
          {items.map(item => (
            <Text color={pal.text}>{`  ${mark} ${item}`}</Text>
          ))}
        </Box>
      )

    return (
      <Box flexDirection="column" borderStyle="double" borderColor={pal.frame} paddingX={1} gap={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Text color={pal.title} bold>
            {`★ SAVE POINT ★  ${save.title}`}
          </Text>
          <Text color={pal.dim}>{save.meta}</Text>
        </Box>
        {section(`▣ CLEARED  +${save.done.length * 60} EXP`, save.done, pal.ok, '✓')}
        {section(`▢ QUEST LOG  남은 ${save.todo.length}`, save.todo, pal.title, '·')}
        {section('? 어떻게 하시겠습니까?', save.decide, pal.warn, '▶')}
        <Box flexDirection="column">
          <Text color={pal.dim} bold>
            PASSWORD (이어하기 프롬프트)
          </Text>
          <Text color={pal.info}>{save.resume}</Text>
        </Box>
        {section('◆ INVENTORY', save.artifacts, pal.text, '◆')}
        <Text color={pal.dim}>
          {save.rest !== '' ? save.rest : '세이브 완료. 다음 세션 빈 입력창에서 Tab으로 이어하기 · /load'}
        </Text>
      </Box>
    )
  })
}

type Reply = { text: string; why?: undefined; isEmpty?: undefined } | { text?: undefined; why: string; isEmpty: boolean }

/**
 * The save, written by the model. A fork asks over the live transcript (the
 * prompt cache serves it). A session resumed with --continue has sent nothing
 * yet, so there is nothing to fork: the stored transcript is then read and
 * summarized in one completion on the session's model.
 */
async function summarize($: EngineInterface, prompt: string): Promise<Reply> {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered) return { text: forked.text }
  if (forked.reason !== 'nothing-to-fork') return { why: `The save failed (${forked.reason}). Try /save again in a moment.`, isEmpty: false }

  const rows = await $.session.messages()
  if (rows.length === 0) return { why: 'Nothing to save yet: this session has no turns.', isEmpty: true }
  const transcript = transcriptOf(rows)
  const ask = `${prompt}\n\nThe session so far:\n<transcript>\n${transcript}\n</transcript>`
  let model = 'sonnet'
  try {
    model = await $.session.model()
  } catch {
    // The alias above stands in.
  }
  const done = await $.model.complete({ model, prompt: ask, maxTokens: 2000 })
  if (done.isAnswered) return { text: done.text }
  return { why: `The save failed (${done.reason}). Try /save again in a moment.`, isEmpty: false }
}

/** The rows as plain text, newest kept when long: who said what, and what each tool touched. */
export function transcriptOf(rows: readonly { role: string; text: string; toolUses: readonly { tool: string; input: Record<string, unknown> }[] }[]): string {
  const lines = rows.map(row => {
    const tools = row.toolUses.map(use => {
      const target = ['file_path', 'command', 'path', 'url', 'pattern']
        .map(key => use.input[key])
        .find((v): v is string => typeof v === 'string')
      return target === undefined ? use.tool : `${use.tool}(${target.slice(0, 120)})`
    })
    const said = row.text.trim().slice(0, 4000)
    return `${row.role === 'user' ? 'USER' : 'CLAUDE'}: ${said}${tools.length > 0 ? ` [tools: ${tools.join(', ')}]` : ''}`
  })
  const all = lines.join('\n')
  return all.length > 60_000 ? '…' + all.slice(-60_000) : all
}

/** Offers the resume prompt once the prompt box is up and empty; a few tries, then gives up. */
function offer($: EngineInterface, text: string, attempt: number): void {
  if (attempt >= 5) return
  $.clock.after(attempt === 0 ? 800 : 2000, () => {
    void $.prompt
      .suggest({ text })
      .then(shown => {
        if (!shown.isShown) offer($, text, attempt + 1)
      })
      .catch(() => undefined)
  })
}

async function slotsOf($: EngineInterface): Promise<Slots> {
  const raw = await $.store.get('slots')
  return raw !== null && typeof raw === 'object' ? (raw as Slots) : {}
}

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map(v => v.trim().replace(/\s+/g, ' ').slice(0, 200))
        .slice(0, max)
    : []

/** The fork's reply as a save; a reply that is not the JSON asked for becomes the resume prompt. */
export function parseSave(text: string): Pick<Save, 'title' | 'done' | 'todo' | 'decide' | 'resume' | 'artifacts'> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      const resume = typeof o.resume === 'string' ? o.resume.trim().slice(0, 2000) : ''
      if (resume !== '') {
        return {
          title: typeof o.title === 'string' && o.title.trim() !== '' ? o.title.trim().slice(0, 80) : 'untitled quest',
          done: strings(o.done, 6),
          todo: strings(o.todo, 6),
          decide: strings(o.decide, 4),
          resume,
          artifacts: strings(o.artifacts, 8),
        }
      }
    } catch {
      // Not JSON after all: kept as the resume prompt below.
    }
  }
  return { title: 'save', done: [], todo: [], decide: [], resume: text.trim().slice(0, 2000), artifacts: [] }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}시간 전`
  return `${Math.round(hours / 24)}일 전`
}

/** The save as text: what the transcript keeps and Claude reads; the screen is drawn from it. */
export function screenText(s: Save, slot: number, of: number): string {
  const meta = [
    `SLOT ${slot}/${of}`,
    stamp(s.savedAt),
    `TURN ${s.turns}`,
    s.usd === null ? '' : `$${s.usd.toFixed(2)}`,
    s.contextUsed === null ? '' : `CTX ${s.contextUsed}%`,
  ]
    .filter(x => x !== '')
    .join(' · ')
  const list = (items: string[]) => (items.length === 0 ? ['- (none)'] : items.map(i => `- ${i}`))
  return [
    HEADER + s.title,
    meta,
    '[CLEARED]',
    ...list(s.done),
    '[QUEST LOG]',
    ...list(s.todo),
    '[DECIDE]',
    ...list(s.decide),
    '[PASSWORD]',
    s.resume,
    '[INVENTORY]',
    ...list(s.artifacts),
  ].join('\n')
}

type Screen = { title: string; meta: string; done: string[]; todo: string[]; decide: string[]; resume: string; artifacts: string[]; rest: string }

/** Reads screenText back; undefined for a row that is not a save. */
export function parseScreen(text: string): Screen | undefined {
  if (!text.startsWith(HEADER)) return undefined
  const [head, meta = '', ...lines] = text.split('\n')
  const out: Screen = { title: (head ?? '').slice(HEADER.length), meta, done: [], todo: [], decide: [], resume: '', artifacts: [], rest: '' }
  const sections: Record<string, keyof Pick<Screen, 'done' | 'todo' | 'decide' | 'artifacts'> | 'resume'> = {
    '[CLEARED]': 'done',
    '[QUEST LOG]': 'todo',
    '[DECIDE]': 'decide',
    '[PASSWORD]': 'resume',
    '[INVENTORY]': 'artifacts',
  }
  let at: (typeof sections)[string] | undefined
  const resume: string[] = []
  const rest: string[] = []
  for (const line of lines) {
    const next = sections[line]
    if (next !== undefined) {
      at = next
      continue
    }
    if (at === 'resume') resume.push(line)
    else if (at !== undefined && line.startsWith('- ')) {
      if (line !== '- (none)') out[at].push(line.slice(2))
    } else if (line.trim() !== '') {
      at = undefined
      rest.push(line)
    }
  }
  out.resume = resume.join('\n').trim()
  out.rest = rest.join(' ').trim()
  return out
}
