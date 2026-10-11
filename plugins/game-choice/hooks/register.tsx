// game-choice: the status summary's resume prompt becomes the prompt box's dim suggestion,
// its decisions become Jev-ranked buttons that refine that prompt, and drafts are matched to skills.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, SkillCandidate, SkillHint } from '../types'
import {
  JEV_URL,
  allPicked,
  applyDecisionRanks,
  composePrompt,
  decisionRequest,
  parseChoiceAnswers,
  parseStatusSummary,
  pct,
  pickSkill,
  rankedOptions,
  shadowVerdict,
  shortlistSkills,
  shouldClassify,
  skillRequest,
} from './core'
import type { ChoiceAnswer, JevRequest } from './core'

const card = atom({ plugin: 'game-choice', key: 'card' } as const, null)
const skill = atom({ plugin: 'game-choice', key: 'skill' } as const, null)
const isTailoring = atom({ plugin: 'game-choice', key: 'isTailoring' } as const, false)

const PICKS_KEY = 'picks'
const MAX_PICKS = 500
const TYPING_PAUSE_MS = 800
const JEV_TIMEOUT_MS = 8000

// Module state: a reload starts these over, which only drops an in-flight skill lookup.
let typing = 0
let lastClassified = ''
let threshold = 0.5
let shadowMode = true

type JevResult =
  | { ok: true; answers: Record<string, ChoiceAnswer> }
  | { ok: false; failure: 'no-key' | 'error'; note: string }

const LAST_JEV_KEY = 'lastJev'

/** What /choice shows about the latest Jev call; never the key itself. */
type JevTrace = {
  at: number
  purpose: 'decisions' | 'skill'
  hasKey: boolean
  ms: number
  status: number | null
  note: string | null
  /** The start of the response body, for a response that did not parse. */
  bodyHead: string | null
  answers: Record<string, ChoiceAnswer> | null
  /** Why ~/.claude/game-choice/last-jev.json could not be written, when it could not. */
  fileError?: string
}

async function askJev($: EngineInterface, body: JevRequest, purpose: JevTrace['purpose']): Promise<JevResult> {
  const started = await $.clock.now()
  const key = await $.env.get('TYPESAFE_API_KEY')
  const trace: JevTrace = { at: started, purpose, hasKey: Boolean(key), ms: 0, status: null, note: null, bodyHead: null, answers: null }
  // Written before the request, so a call that never returns still shows how far it got.
  await $.store.set(LAST_JEV_KEY, { ...trace, note: '요청 보냄, 응답 대기 중' }).catch(() => undefined)
  let result: JevResult
  if (!key) {
    result = { ok: false, failure: 'no-key', note: 'TYPESAFE_API_KEY 없음' }
  } else {
    try {
      const res = await $.http.fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      trace.status = res.status
      const answers = res.ok ? parseChoiceAnswers(JSON.parse(res.text)) : null
      if (!answers) trace.bodyHead = res.text.slice(0, 300)
      result = !res.ok
        ? { ok: false, failure: 'error', note: `HTTP ${res.status}` }
        : answers
          ? { ok: true, answers }
          : { ok: false, failure: 'error', note: '응답 형식이 다름' }
    } catch (err) {
      result = { ok: false, failure: 'error', note: err instanceof Error ? err.message.slice(0, 120) : 'request failed' }
    }
  }
  trace.ms = (await $.clock.now()) - started
  if (result.ok) trace.answers = result.answers
  else trace.note = result.note
  await $.store.set(LAST_JEV_KEY, trace).catch(() => undefined)
  await writeTrace($, trace)
  return result
}

/**
 * Mirrors the trace to ~/.claude/game-choice/last-jev.json so it can be read outside the
 * session. Outside the mod's own folder on purpose: a write there would hot-reload the mod.
 */
async function writeTrace($: EngineInterface, trace: JevTrace): Promise<void> {
  const failed = await writeOutside($, 'last-jev.json', trace)
  // A failed write must not vanish: it shows in /choice instead.
  if (failed) await $.store.set(LAST_JEV_KEY, { ...trace, fileError: failed }).catch(() => undefined)
}

/**
 * Writes `value` as JSON to ~/.claude/game-choice/<name>, outside the mod's own folder
 * (a write there would hot-reload the mod). Resolves the error text, or null on success.
 */
async function writeOutside($: EngineInterface, name: string, value: unknown): Promise<string | null> {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return 'USERPROFILE/HOME 없음'
    await $.fs.write(`${home}/.claude/game-choice/${name}`, `${JSON.stringify(value, null, 2)}\n`)
    return null
  } catch (err) {
    return err instanceof Error ? err.message.slice(0, 160) : 'write failed'
  }
}

function describeTrace(t: JevTrace | undefined): string {
  if (!t) return '아직 Jev를 부른 적이 없습니다. 상태 요약이 있는 답변이 끝나거나, 입력하다 멈추면 부릅니다.'
  const lines = [
    `마지막 Jev 호출: ${t.purpose === 'decisions' ? '결정 순위' : '스킬 제안'} · ${t.ms}ms`,
    `키: ${t.hasKey ? '있음' : '없음 (TYPESAFE_API_KEY)'} · HTTP ${t.status ?? '-'}`,
  ]
  if (t.note) lines.push(`실패: ${t.note}`)
  if (t.bodyHead) lines.push(`응답 앞부분: ${t.bodyHead}`)
  if (t.fileError) lines.push(`기록 파일 쓰기 실패: ${t.fileError}`)
  for (const [id, a] of Object.entries(t.answers ?? {})) {
    const probs = Object.entries(a.probabilities)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([k, p]) => `${k} ${Math.round(p * 100)}%`)
      .join(', ')
    lines.push(`${id}: ${a.choice} (확신도 ${Math.round(a.confidence * 100)}%) — ${probs}`)
  }
  return lines.join('\n')
}

/** The prompt the box should offer for this card. */
function target(c: Card): string {
  return c.refined ?? composePrompt(c)
}

async function offer($: EngineInterface, text: string): Promise<void> {
  try {
    await $.prompt.suggest({ text })
  } catch {
    // The box may be busy or headless; the engine's next suggestion is rewritten to ours anyway.
  }
}

function refinePrompt(c: Card): string {
  const picks = c.decisions.map(d => {
    const o = d.picked === null ? null : d.options[d.picked]
    return o ? `- ${d.question} → ${o.label} (${o.append})` : ''
  })
  return [
    '아래는 다음에 이어서 할 때 붙여넣을 재개 프롬프트와, 사용자가 방금 고른 결정이다.',
    '이 대화의 맥락을 반영해 결정을 확정 사항으로 녹인 하나의 self-contained 한국어 단락으로 다시 써라.',
    '결정 질문이나 고르지 않은 옵션은 남기지 말고, 프롬프트 본문만 출력하라.',
    '',
    `재개 프롬프트: ${c.resume}`,
    '고른 결정:',
    ...picks,
  ].join('\n')
}

function tailorPrompt(s: SkillHint): string {
  return [
    `사용자가 입력 중인 초안을 /${s.name} 스킬로 실행할 프롬프트로 다듬어라.`,
    `스킬 설명: ${s.description}`,
    '이 대화에서 이미 알려진 파일·경로·결정을 채워 넣고, 모르는 것은 지어내지 마라.',
    `출력은 "/${s.name} "로 시작하는 한 단락만.`,
    '',
    `초안: ${s.draft}`,
  ].join('\n')
}

async function rank($: EngineInterface, c: Card): Promise<void> {
  if (c.decisions.length === 0) return
  // Whatever goes wrong — an exception or a call that never returns — the card must leave 'pending' and say why.
  const asked: Promise<JevResult> = askJev($, decisionRequest(c), 'decisions').catch((err: unknown) => ({
    ok: false as const,
    failure: 'error' as const,
    note: err instanceof Error ? err.message.slice(0, 120) : 'request failed',
  }))
  const timedOut: Promise<JevResult> = $.clock
    .sleep(JEV_TIMEOUT_MS)
    .then(() => ({ ok: false as const, failure: 'error' as const, note: `Jev 응답 시간 초과 (${JEV_TIMEOUT_MS / 1000}초)` }))
  const r = await Promise.race([asked, timedOut])
  await update($, card, cur => {
    if (!cur || cur.resume !== c.resume) return cur // a newer summary replaced it
    if (!r.ok) return { ...cur, rank: r.failure, rankNote: r.note, shadow: shadowVerdict(cur, false, r.note) }
    const ranked = applyDecisionRanks(cur, r.answers)
    return { ...cur, ...ranked, rank: 'jev' as const, rankNote: null, shadow: shadowVerdict(ranked, true) }
  })
}

async function refine($: EngineInterface, c: Card): Promise<void> {
  await update($, card, cur => (cur && cur.resume === c.resume ? { ...cur, isRefining: true } : cur))
  const r = await $.model.fork({ prompt: refinePrompt(c) })
  const done = await update($, card, cur => {
    if (!cur || cur.resume !== c.resume) return cur
    const text = r.isAnswered ? r.text.trim() : ''
    return { ...cur, isRefining: false, refined: text || null }
  })
  if (done?.refined) await offer($, done.refined)
  else if (!r.isAnswered) $.ui.toast(`다듬기 실패: ${r.reason}`)
}

async function pick($: EngineInterface, di: number, oi: number): Promise<void> {
  const next = await update($, card, cur => {
    if (!cur) return cur
    const decisions = cur.decisions.map((d, i) => (i === di ? { ...d, picked: oi } : d))
    return { ...cur, decisions, refined: null }
  })
  if (!next) return
  const d = next.decisions[di]
  if (d) {
    // Kept for calibrating the order later: what was offered, at what odds, and what was chosen.
    const stored = await $.store.get(PICKS_KEY)
    const history = Array.isArray(stored) ? stored : []
    const top = rankedOptions(d)[0]
    const row = {
      at: await $.clock.now(),
      /** Groups the decisions of one card. */
      cardAt: next.cardAt,
      question: d.question,
      options: d.options.map(o => ({ label: o.label, p: o.p })),
      confidence: d.confidence,
      picked: oi,
      /** Jev's first choice (or Claude's first option when unranked). */
      top: top?.index ?? null,
      rank: next.rank,
      /** Whether the person saw Claude's order without Jev's odds when picking. */
      shadowMode,
      /** What the shadow auto-approver would have picked for this decision, and why not when it would not. */
      shadow: next.shadow
        ? { eligible: next.shadow.eligible, pick: next.shadow.picks[di] ?? null, reasons: next.shadow.reasons }
        : { eligible: false, pick: null, reasons: ['Jev 순위 전에 고름'] },
      /** A person's pick; the auto-approver, once on, writes true and the analysis leaves those out. */
      auto: false,
    }
    const picks = [...history, row].slice(-MAX_PICKS)
    await $.store.set(PICKS_KEY, picks)
    // Mirrored outside the session so the picks can be analysed later.
    await writeOutside($, 'picks.json', picks)
  }
  await offer($, target(next))
  if (allPicked(next)) await refine($, next)
}

async function classify($: EngineInterface, draft: string, ticket: number): Promise<void> {
  await $.clock.sleep(TYPING_PAUSE_MS)
  if (ticket !== typing || draft === lastClassified) return
  lastClassified = draft
  const commands = await $.command.list()
  const skills: SkillCandidate[] = commands
    .filter(c => c.source !== 'builtin')
    .map(c => ({ name: c.name, description: c.description }))
  if (skills.length === 0) return
  const shortlist = shortlistSkills(draft, skills)
  const r = await askJev($, skillRequest(draft, shortlist), 'skill')
  if (ticket !== typing) return
  await update($, skill, () => (r.ok ? pickSkill(r.answers, shortlist, draft, threshold) : null))
}

async function applySkill($: EngineInterface, s: SkillHint): Promise<void> {
  await $.prompt.fill({ text: `/${s.name} ${s.draft}` })
  await update($, skill, () => null)
}

async function tailorSkill($: EngineInterface, s: SkillHint): Promise<void> {
  await update($, isTailoring, () => true)
  const r = await $.model.fork({ prompt: tailorPrompt(s) })
  await update($, isTailoring, () => false)
  if (r.isAnswered && r.text.trim()) {
    await $.prompt.fill({ text: r.text.trim() })
    await update($, skill, () => null)
  } else if (!r.isAnswered) {
    $.ui.toast(`다듬기 실패: ${r.reason}`)
  }
}

function rankLabel(c: Card): string {
  if (shadowMode) {
    // Odds and order stay hidden so the pick is the person's own; Jev still runs and is recorded.
    if (c.rank === 'pending') return '섀도 모드 · Jev 기록 중…'
    if (c.rank === 'jev') return '섀도 모드 · Claude 순서 (Jev 순위 숨김)'
    return `섀도 모드 · Claude 순서 (Jev 실패: ${c.rankNote ?? '알 수 없음'})`
  }
  if (c.rank === 'jev') return 'Jev 확률순'
  if (c.rank === 'pending') return 'Jev가 순위를 매기는 중…'
  return `Claude 추천순 (${c.rankNote ?? 'Jev 없음'})`
}

function statusLine(c: Card): string {
  if (c.isRefining) return '선택을 반영해 프롬프트를 다듬는 중…'
  if (c.refined) return '다듬은 프롬프트가 입력창 제안에 있습니다 (Tab)'
  return '고른 내용이 입력창 제안에 붙습니다 (Tab)'
}

export const register: Register = (on, options) => {
  threshold = Math.min(95, Math.max(10, Number(options.skillThreshold ?? 50))) / 100
  shadowMode = options.shadowMode !== false
  const skillSuggest = options.skillSuggest !== false

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'choice', description: 'game-choice: 마지막 Jev 호출 결과와 지금 카드 상태' })
    return result
  })

  on('command.run', { command: 'choice' }, async $ => {
    const trace = (await $.store.get(LAST_JEV_KEY)) as JevTrace | undefined
    const c = await read($, card)
    const cardLine = c
      ? `카드: 결정 ${c.decisions.length}개 · 순위 ${c.rank}${c.rankNote ? ` (${c.rankNote})` : ''} · 확률 ${c.decisions.flatMap(d => d.options.map(o => (o.p === null ? '-' : `${Math.round(o.p * 100)}%`))).join(' ')}`
      : '카드: 없음'
    const shadowLine = !c
      ? ''
      : c.shadow === null
        ? `\n섀도: 판정 전${shadowMode ? ' (섀도 모드 켜짐)' : ''}`
        : c.shadow.eligible
          ? `\n섀도: 자동 대상 — 고를 옵션 ${c.shadow.picks.map((p, i) => `Q${i + 1}=${p === null ? '-' : String.fromCharCode(65 + p)}`).join(' ')}`
          : `\n섀도: 자동 아님 — ${c.shadow.reasons.join('; ')}`
    return { text: `${describeTrace(trace)}\n${cardLine}${shadowLine}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    const summary = parseStatusSummary(e.answer)
    if (!summary) return result
    const c: Card = {
      ...summary,
      cardAt: await $.clock.now(),
      shadow: null,
      rank: 'pending',
      rankNote: null,
      refined: null,
      isRefining: false,
    }
    await update($, card, () => c)
    // Not awaited: a suggestion cannot show while the turn runs, and this hook is still part of the turn,
    // so waiting here held Jev back and left the buttons without odds. The box takes it once free.
    void offer($, target(c))
    await rank($, c)
    return result
  })

  // The engine's own next-prompt guess gives way to the summary's resume prompt.
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind !== 'suggestion') return next(e)
    const c = await read($, card)
    return next(c ? { ...e, text: target(c) } : e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!skillSuggest) return box
    typing += 1
    if (shouldClassify(box.text)) void classify($, box.text, typing)
    else void update($, skill, () => null)
    return box
  })

  // Clearing stale cards must never hold up the person's prompt.
  on('prompt.submit', async ($, e, next) => {
    typing += 1
    await update($, card, () => null)
    await update($, skill, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const c = await read($, card)
    const s = await read($, skill)
    const tailoring = await read($, isTailoring)
    const below = await next(e)
    const hasDecisions = c !== null && c.decisions.length > 0
    if (!hasDecisions && !s) return below

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {hasDecisions && c && (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={2}>
              <Text bold>다음 할 일 결정</Text>
              <Text dimColor>{rankLabel(c)}</Text>
              <Button key="close" label="닫기" onPress={() => update($, card, () => null)} />
            </Box>
            {c.decisions.map((d, di) => (
              <Box key={`q${di}`} flexDirection="row" columnGap={1} flexWrap="wrap">
                <Text>{`Q${di + 1}. ${d.question}`}</Text>
                {(shadowMode ? d.options.map((o, index) => ({ ...o, index })) : rankedOptions(d)).map(o => (
                  <Button
                    key={`d${di}-o${o.index}`}
                    label={`${d.picked === o.index ? '✓ ' : ''}${o.label}${shadowMode ? '' : pct(o.p)}`}
                    variant={d.picked === o.index ? 'primary' : 'secondary'}
                    onPress={() => pick($, di, o.index)}
                  />
                ))}
              </Box>
            ))}
            <Text dimColor>{statusLine(c)}</Text>
          </Box>
        )}
        {s && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Text>{`스킬 제안: /${s.name}${pct(s.p)}`}</Text>
            <Text dimColor wrap="truncate-end">
              {s.description.slice(0, 60)}
            </Text>
            <Button key="skill-apply" label="적용" onPress={() => applySkill($, s)} />
            <Button key="skill-tailor" label={tailoring ? '다듬는 중…' : '맞춤 다듬기'} onPress={() => tailorSkill($, s)} />
            <Button key="skill-dismiss" label="×" onPress={() => update($, skill, () => null)} />
          </Box>
        )}
      </Box>
    )
  })
}
