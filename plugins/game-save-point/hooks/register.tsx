import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Save, TitleState } from '../types'
import { bar, intensityOf, paletteOf, windowProps } from './palette'

// GAME MODE · SAVE POINT
//
// /save        Claude writes a save of this session (what was cleared, the
//              quest log, decisions waiting on you, a resume prompt, the
//              items made) through $.model.fork, over the same transcript,
//              so the prompt cache serves it. In a session resumed with
//              --continue that has not sent anything yet, the stored
//              transcript is summarized instead. Kept per project, last 5.
//              The resume prompt goes to the clipboard, and the save gets a
//              password (SP07-KTX9-MOON) that /load takes.
// /save show   the latest save again · /save list   the last five
// /load [n|code]  puts a save's resume prompt in the prompt box (1 = latest)
//
// Next session in the same project: a title screen above the prompt
// (CONTINUE · NEW GAME · LOAD, the last three slots), the status line names
// the save, and the empty prompt box offers its resume prompt on Tab.

const MAX_SAVES = 5
const HEADER = '◆ SAVE POINT · '
const CODE_LINE = '[CODE] '
const CODE_RE = /^SP\d{2}-[A-Z0-9]{4}-MOON$/

const FORK_PROMPT = [
  'Write a SAVE POINT for this coding session so the user can resume it later in a new session.',
  'Reply with one JSON object only, no prose and no code fence, in this shape:',
  '{"title": "...", "done": ["..."], "todo": ["..."], "decide": ["..."], "resume": "...", "artifacts": ["..."]}',
  '- title: the quest in a few words',
  '- done: what was finished, short items, at most 6',
  '- todo: what is left, at most 6, the main next step first; start an optional item with "SIDE: "',
  '- decide: decisions only the user can make, at most 4, each as "choice — what it leads to" (an empty list when none)',
  '- resume: one prompt the user can paste into a new session to continue exactly here; name the files and the next concrete step',
  '- artifacts: files, branches, PRs or links produced, at most 8',
  'Write the strings in the language the user wrote in. State only what happened in this session.',
].join('\n')

type Slots = Record<string, Save[]>

const TITLE_OFF: TitleState = { isShown: false, isLoading: false }
const title = atom({ plugin: 'game-save-point', key: 'title' } as const, TITLE_OFF)
const hits = atom({ plugin: 'game-save-point', key: 'hits' } as const, 0)

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const pal = paletteOf(options.palette)
  const maxAgeDays = Math.max(1, Math.min(365, Number(options.maxAgeDays ?? 14) || 14))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'save',
      description: 'GAME MODE save point: save this session (status summary + resume prompt), or show / list saves',
      argumentHint: '[note|show|list]',
    })
    await $.command.register({
      name: 'load',
      description: 'GAME MODE save point: put a save\'s resume prompt in the prompt box (number, or its password)',
      argumentHint: '[n|SP00-XXXX-MOON]',
    })

    const root = await $.session.root()
    const last = (await slotsOf($))[root]?.[0]
    const now = await $.clock.now()
    if (last !== undefined && now - last.savedAt <= maxAgeDays * 86_400_000) {
      $.ui.status(`◆ SAVE ${ago(now - last.savedAt)} · ${last.title} · Tab 이어하기 · /load`)
      offer($, last.resume, 0)
      if (intensity !== 'off' && (await $.session.turns()) === 0) await update($, title, () => ({ isShown: true, isLoading: false }))
    }
    return next(e)
  })

  // The first prompt starts the game: the title screen and the status line step aside.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      const t = await read($, title)
      if (t.isShown) await update($, title, () => TITLE_OFF)
      $.ui.status(undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // LV and EXP on the save screen count what the HUD counts: calls that ran clean.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await update($, hits, n => n + 1)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'save' }, async ($, e) => {
    const root = await $.session.root()
    const slots = await slotsOf($)
    const saves = slots[root] ?? []
    const sub = e.args.trim()

    if (sub === 'show') {
      const last = saves[0]
      return { text: last ? screenText(last, 1, saves.length, false) : 'No save in this project yet. Type /save to make one.' }
    }
    if (sub === 'list') {
      if (saves.length === 0) return { text: 'No save in this project yet. Type /save to make one.' }
      return {
        text:
          saves.map((s, i) => `${i + 1}. ${stamp(s.savedAt)} · ${s.title}${s.code ? ` · ${s.code}` : ''}`).join('\n') +
          '\n\n/load <n> or /load <password> puts that save\'s resume prompt in the prompt box.',
      }
    }

    const prompt = sub === '' ? FORK_PROMPT : `${FORK_PROMPT}\nThe user's note for this save: ${sub}`
    const reply = await summarize($, prompt)
    if (reply.text === undefined) return { text: reply.why, exitCode: reply.isEmpty ? 0 : 1 }

    const usage = await $.session.usage()
    const savedAt = await $.clock.now()
    const count = await read($, hits)
    const firstAt = saves.length === 0 ? savedAt : Math.min(...saves.map(s => s.savedAt))
    const save: Save = {
      ...parseSave(reply.text),
      v: 1,
      savedAt,
      root,
      turns: await $.session.turns(),
      usd: usage.cost?.usd ?? null,
      contextUsed: usage.context.percent ?? null,
      hits: count,
      day: Math.floor((savedAt - firstAt) / 86_400_000) + 1,
      code: codeOf(levelOf(count).level, savedAt),
    }
    const kept = [save, ...saves].slice(0, MAX_SAVES)
    await $.store.set('slots', { ...slots, [root]: kept })
    const copied = await $.ui
      .copy({ text: save.resume })
      .then(r => r.isCopied)
      .catch(() => false)
    await update($, title, () => TITLE_OFF)
    $.ui.toast(`♪ 세이브 완료 · ${save.code}`)
    return { text: screenText(save, 1, kept.length, copied) }
  })

  on('command.run', { command: 'load' }, async ($, e) => {
    const root = await $.session.root()
    const slots = await slotsOf($)
    const saves = slots[root] ?? []
    const arg = e.args.trim().toUpperCase()
    let found: { save: Save; slot: number; of: number } | undefined
    if (CODE_RE.test(arg)) {
      // A password restores its save from any project.
      for (const list of Object.values(slots)) {
        const i = list.findIndex(s => s.code === arg)
        if (i !== -1) found = { save: list[i] as Save, slot: i + 1, of: list.length }
      }
      if (found === undefined) return { text: `No save has the password ${arg}. /save list shows this project's saves.` }
    } else {
      const n = Math.max(1, Number.parseInt(arg || '1', 10) || 1)
      const save = saves[n - 1]
      if (save === undefined) return { text: saves.length === 0 ? 'No save in this project yet.' : `There are ${saves.length} saves; /save list shows them.` }
      found = { save, slot: n, of: saves.length }
    }
    const filled = await $.prompt.fill({ text: found.save.resume })
    $.ui.status(undefined)
    await update($, title, () => TITLE_OFF)
    const tail = filled.isFilled ? '\n\nThe resume prompt is in the prompt box: edit it or press Enter.' : `\n\nResume prompt:\n${found.save.resume}`
    return { text: screenText(found.save, found.slot, found.of, false) + tail }
  })

  // TITLE: CONTINUE · NEW GAME · LOAD and the last three slots, above whatever else the band holds.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (intensity === 'off' || e.props.hasSurvey) return next(e)
    const t = await read($, title)
    if (!t.isShown) return next(e)
    const root = await $.session.root()
    const saves = ((await slotsOf($))[root] ?? []).slice(0, 3)
    const below = await next(e)
    const latest = saves[0]
    if (latest === undefined) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const cardWidth = Math.max(18, Math.floor((e.props.bodyColumns - 6) / 3) - 1)
    const load = (save: Save) => () => {
      void $.prompt.fill({ text: save.resume })
      void update($, title, () => TITLE_OFF)
      $.ui.status(undefined)
    }
    const close = () => {
      void update($, title, () => TITLE_OFF)
    }
    const toggleLoad = () => {
      void update($, title, v => ({ ...v, isLoading: !v.isLoading }))
    }

    // Six rows in all, so the HUD under it still fits the band.
    const card = (i: number) => {
      const s = saves[i]
      const isFirst = i === 0
      const fill = pal.win === '' ? {} : { backgroundColor: isFirst ? pal.frame : pal.off }
      if (s === undefined) {
        return (
          <Box key={`slot${i}`} flexDirection="column" paddingX={1} width={cardWidth} {...fill}>
            <Text color={pal.dim}>{`SLOT ${i + 1}  ---`}</Text>
            <Text color={pal.dim}>- NO DATA -</Text>
          </Box>
        )
      }
      const left = s.todo.length
      return (
        <Box key={`slot${i}`} flexDirection="column" paddingX={1} width={cardWidth} {...fill}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={isFirst ? pal.title : pal.text} bold>{`${isFirst ? '▸ ' : ''}SLOT ${i + 1}`}</Text>
            <Text color={pal.title}>{`LV ${String(levelOf(s.hits ?? 0).level).padStart(2, '0')} · DAY ${s.day ?? 1}`}</Text>
          </Box>
          <Text color={pal.text} wrap="truncate-end">
            {`${s.title} · ${left > 0 ? `퀘스트 ${left}` : 'CLEAR'}`}
          </Text>
        </Box>
      )
    }

    const screen = (
      <Box {...windowProps(pal)} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text color={pal.title} bold>
            ◆ S A V E   P O I N T ◆
          </Text>
          <Text color={pal.dim}>A CLAUDE CODE MOD · REASONOFMOON</Text>
          <Text color={pal.title} bold>
            PRESS START
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Button key="continue" label="▸ CONTINUE" hotkey="c" variant="primary" onPress={load(latest)} />
          <Button key="new" label="NEW GAME" hotkey="n" onPress={close} />
          <Button key="load" label="LOAD" hotkey="l" onPress={toggleLoad} />
          <Text color={pal.dim} wrap="truncate-end">
            빈 입력창 Tab: 이어하기 · ctrl+x tab: 메뉴
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {card(0)}
          {card(1)}
          {card(2)}
        </Box>
        {t.isLoading && (
          <Box flexDirection="row" columnGap={1}>
            {saves.map((s, i) => (
              <Button key={`load${i + 1}`} label={`${i + 1}: SLOT ${i + 1} 불러오기`} hotkey={String(i + 1)} onPress={load(s)} />
            ))}
          </Box>
        )}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {screen}
        {below}
      </Box>
    )
  })

  // The save screen, drawn from the row's own text so each row shows its own save.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (intensity === 'off' || (e.props.command !== 'save' && e.props.command !== 'load')) return next(e)
    const s = parseScreen(e.props.text)
    if (s === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 100
    const isWide = columns >= 90
    const lv = levelOf(s.hits ?? 0)
    const half = isWide ? '50%' : '100%'

    const items = (list: string[], render: (item: string, i: number) => RenderElement): RenderElement | RenderElement[] =>
      list.length === 0 ? <Text color={pal.dim}>  (없음)</Text> : list.map(render)

    const header = (
      <Box {...windowProps(pal)} flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Box flexDirection="column" flexShrink={1}>
          <Text color={pal.title} bold>
            ◆ ★ SAVE POINT ★
          </Text>
          <Text color={pal.text}>{`QUEST · ${s.title}`}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color={pal.dim}>{[s.slot, s.day ? `DAY ${s.day}` : '', s.time].filter(x => x !== '').join(' · ')}</Text>
          {s.hits !== null && <Text color={pal.ok}>{`LV ${String(lv.level).padStart(2, '0')} ${bar((lv.into / lv.span) * 100, 10)} EXP`}</Text>}
          {s.contextUsed !== null && <Text color={pal.info}>{`CTX ${bar(s.contextUsed, 10)} ${s.contextUsed}%`}</Text>}
        </Box>
      </Box>
    )

    const left = (
      <Box {...windowProps(pal)} flexDirection="column" width={half}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={pal.ok} bold>
            ▣ CLEARED
          </Text>
          <Text color={pal.title}>{`+${s.done.length * 60} EXP`}</Text>
        </Box>
        {items(s.done, d => (
          <Box flexDirection="row">
            <Text color={pal.ok}>{'  ✓ '}</Text>
            <Box flexShrink={1}>
              <Text color={pal.text}>{d}</Text>
            </Box>
          </Box>
        ))}
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text color={pal.title} bold>
            ▢ QUEST LOG
          </Text>
          <Text color={pal.title}>{`남은 퀘스트 ${s.todo.length}`}</Text>
        </Box>
        {items(s.todo, q => {
          const isSide = /^SIDE:\s*/i.test(q)
          return (
            <Box flexDirection="row" columnGap={1}>
              <Text color={isSide ? pal.dim : pal.title} bold>
                {isSide ? 'SIDE' : 'MAIN'}
              </Text>
              <Box flexShrink={1}>
                <Text color={pal.text}>{q.replace(/^SIDE:\s*/i, '')}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const right = (
      <Box flexDirection="column" width={half}>
        <Box {...windowProps(pal)} flexDirection="column">
          <Text color={pal.warn} bold>
            ? 어떻게 하시겠습니까?
          </Text>
          {items(s.decide, (d, i) => {
            const [choice, meaning = ''] = d.split(/\s+—\s+/, 2)
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text color={pal.title}>{i === 0 ? '▶ ' : '  '}</Text>
                  <Box flexShrink={1}>
                    <Text color={i === 0 ? pal.title : pal.text}>{choice}</Text>
                  </Box>
                </Box>
                {meaning !== '' && (
                  <Box paddingLeft={4}>
                    <Text color={pal.dim}>{meaning}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        <Box {...windowProps(pal)} flexDirection="column">
          <Text color={pal.info} bold>
            ◆ INVENTORY
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {[...s.artifacts.slice(0, 7), ''].map(a => (
              <Box borderStyle="single" borderColor={a === '' ? pal.dim : pal.frame} paddingX={1}>
                <Text color={a === '' ? pal.dim : pal.text}>{a === '' ? '? ???' : `${iconOf(a)} ${shortName(a)}`}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    )

    const password = (
      <Box {...windowProps(pal)} flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text color={pal.dim} bold>
          PASSWORD
        </Text>
        <Text color={pal.info} bold>
          {s.code ?? '(이어하기 프롬프트)'}
        </Text>
        {s.copied && (
          <Text color={pal.edge} backgroundColor={pal.title} bold>
            {' COPIED! '}
          </Text>
        )}
        <Text color={pal.title}>{s.code ? `▸ /load ${s.code} · 빈 입력창 Tab 이어하기` : '▸ 빈 입력창 Tab 이어하기 · /load'}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection={isWide ? 'row' : 'column'}>
          {left}
          {right}
        </Box>
        {password}
        <Box borderStyle="round" borderColor={pal.edge} paddingX={1}>
          <Text color={pal.text}>{`▶ 「${s.resume}」`}</Text>
        </Box>
        {s.rest !== '' && <Text color={pal.dim}>{s.rest}</Text>}
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

/** Level n starts at 4·(n−1)² successful calls (the HUD's rule). */
export function levelOf(hits: number): { level: number; into: number; span: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, hits) / 4)) + 1
  const floor = 4 * (level - 1) ** 2
  return { level, into: hits - floor, span: 4 * (2 * level - 1) }
}

/** `SP<level>-<4 letters from the time>-MOON`: short enough to type into /load. */
export function codeOf(level: number, savedAt: number): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let n = Math.abs(Math.floor(savedAt / 1000) * 2654435761) % 1_000_000_007
  let mid = ''
  for (let i = 0; i < 4; i++) {
    mid += letters[n % letters.length]
    n = Math.floor(n / letters.length) + i * 7919
  }
  return `SP${String(Math.min(99, level)).padStart(2, '0')}-${mid}-MOON`
}

function iconOf(item: string): string {
  if (/^https?:\/\//.test(item)) return '↗'
  if (/\.(?:md|txt|docx?|pdf|hwpx?)\b/i.test(item)) return '▤'
  if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|swift|kt|sh|json|ya?ml|toml|html|css)\b/i.test(item)) return '◆'
  return '▣'
}

function shortName(item: string): string {
  const plain = item.replace(/\s*\(.*$/, '')
  // A path shows its file name; anything with words (a branch, a PR) shows as written.
  const base = /\s/.test(plain) || /^https?:/.test(plain) ? plain : (plain.split(/[\\/]/).pop() ?? plain)
  return base.length > 18 ? base.slice(0, 17) + '…' : base
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
export function screenText(s: Save, slot: number, of: number, copied: boolean): string {
  const meta = [
    `SLOT ${slot}/${of}`,
    stamp(s.savedAt),
    s.day === undefined ? '' : `DAY ${s.day}`,
    s.hits === undefined ? '' : `LV ${levelOf(s.hits).level} (${s.hits})`,
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
    ...(s.code === undefined ? [] : [`${CODE_LINE}${s.code}${copied ? ' · COPIED' : ''}`]),
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

export type Screen = {
  title: string
  slot: string
  time: string
  day: number | null
  hits: number | null
  contextUsed: number | null
  code: string | undefined
  copied: boolean
  done: string[]
  todo: string[]
  decide: string[]
  resume: string
  artifacts: string[]
  rest: string
}

/** Reads screenText back; undefined for a row that is not a save. */
export function parseScreen(raw: string): Screen | undefined {
  // The row may lead with the answering plugins' names ("game-save-point: ◆ SAVE POINT · …").
  const start = raw.indexOf(HEADER)
  if (start === -1 || start > 120 || raw.slice(0, start).includes('\n')) return undefined
  const text = raw.slice(start)
  const [head, meta = '', ...lines] = text.split('\n')
  const num = (re: RegExp) => {
    const m = re.exec(meta)
    return m ? Number(m[1]) : null
  }
  const out: Screen = {
    title: (head ?? '').slice(HEADER.length),
    slot: /SLOT \d+\/\d+/.exec(meta)?.[0] ?? '',
    time: /\d{4}-\d\d-\d\d (\d\d:\d\d)/.exec(meta)?.[1] ?? '',
    day: num(/DAY (\d+)/),
    hits: num(/LV \d+ \((\d+)\)/),
    contextUsed: num(/CTX (\d+)%/),
    code: undefined,
    copied: false,
    done: [],
    todo: [],
    decide: [],
    resume: '',
    artifacts: [],
    rest: '',
  }
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
    if (at === undefined && line.startsWith(CODE_LINE)) {
      const [code = '', flag = ''] = line.slice(CODE_LINE.length).split(' · ')
      out.code = code.trim()
      out.copied = flag.trim() === 'COPIED'
      continue
    }
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
