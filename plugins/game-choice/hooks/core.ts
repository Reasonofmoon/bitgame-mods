// core.ts
// Pure parts of game-choice: reading the status summary, composing the resume prompt,
// and the Jev (TypeSafe System One) request and response shapes. No engine calls here.
import type { Decision, DecisionOption, ShadowVerdict, SkillCandidate, SkillHint, Summary } from '../types'

const SUMMARY_TAG = '[상태 요약]'

function stripBullet(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim()
}

/** The text of numbered section `n` ("3." … up to "4."), fences removed. */
function section(block: string, n: number): string[] {
  const lines = block.split(/\r?\n/).filter(l => !/^\s*```/.test(l))
  const start = lines.findIndex(l => new RegExp(`^\\s*${n}\\.\\s`).test(l))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^\s*\d\.\s/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

/** Reads the last `[상태 요약]` in an answer; null when there is none or item 4 is empty. */
export function parseStatusSummary(answer: string): Summary | null {
  const at = answer.lastIndexOf(SUMMARY_TAG)
  if (at < 0) return null
  const block = answer.slice(at + SUMMARY_TAG.length)

  const resume = section(block, 4)
    .map(stripBullet)
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!resume || resume === '(해당 없음)') return null

  const decisions: Decision[] = []
  for (const raw of section(block, 3)) {
    const line = stripBullet(raw)
    const q = /^Q:\s*(.+)$/.exec(line)
    if (q?.[1]) {
      decisions.push({ question: q[1].trim(), options: [], picked: null, confidence: null })
      continue
    }
    const current = decisions.at(-1)
    const arrow = line.indexOf('=>')
    if (!current || arrow < 0) continue
    const label = line.slice(0, arrow).trim()
    const append = line.slice(arrow + 2).trim()
    if (label && append) current.options.push({ label, append, p: null })
  }
  return {
    resume,
    decisions: decisions.filter(d => d.options.length >= 2),
    done: bullets(section(block, 1)),
    todo: bullets(section(block, 2)),
  }
}

/** Top-level bullets of a section; continuation lines join the bullet above. "(해당 없음)" is dropped. */
function bullets(lines: string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    if (!raw.trim()) continue
    const isBullet = /^\s*[-*]\s+/.test(raw)
    const text = stripBullet(raw)
    if (isBullet || out.length === 0) out.push(text)
    else out[out.length - 1] = `${out[out.length - 1]} ${text}`
  }
  return out.filter(t => t && t !== '(해당 없음)')
}

/** Cap on the context sent to Jev; item 4 always goes whole, items 1 and 2 are cut to fit. */
export const STATE_MAX_CHARS = 3000

/** What Jev judges the options against: the resume prompt, then what was done and what is left. */
export function decisionState(summary: Summary): string {
  const parts = [`Work to resume: ${summary.resume}`]
  let room = STATE_MAX_CHARS - parts[0]!.length
  for (const [title, items] of [
    ['Done so far:', summary.done],
    ['Still to do:', summary.todo],
  ] as const) {
    if (items.length === 0 || room <= title.length) continue
    const lines: string[] = [title]
    room -= title.length + 1
    for (const item of items) {
      const line = `- ${item}`
      if (line.length + 1 > room) break
      lines.push(line)
      room -= line.length + 1
    }
    if (lines.length > 1) parts.push(lines.join('\n'))
  }
  return parts.join('\n')
}

/** The resume prompt with each picked option's sentence appended, in decision order. */
export function composePrompt(summary: Summary): string {
  const extra = summary.decisions
    .map(d => (d.picked === null ? null : d.options[d.picked]?.append ?? null))
    .filter((s): s is string => Boolean(s))
  return [summary.resume, ...extra].join(' ')
}

export function allPicked(summary: Summary): boolean {
  return summary.decisions.length > 0 && summary.decisions.every(d => d.picked !== null)
}

/** Options with their original index, highest probability first (original order breaks ties). */
export function rankedOptions(d: Decision): Array<DecisionOption & { index: number }> {
  return d.options
    .map((o, index) => ({ ...o, index }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1) || a.index - b.index)
}

// ---- Jev (TypeSafe System One) ----

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const NONE = 'none'

export type ChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export type JevRequest = {
  model: string
  state: string
  questions: Record<string, ChoiceQuestion>
}

export type ChoiceAnswer = {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

const optionKey = (i: number): string => String.fromCharCode(65 + i) // A, B, C…

/** One Choice question per decision, keyed d0, d1…; options keyed A, B, C. */
export function decisionRequest(summary: Summary): JevRequest {
  const questions: Record<string, ChoiceQuestion> = {}
  summary.decisions.forEach((d, i) => {
    const criteria: Record<string, string> = {}
    d.options.forEach((o, j) => {
      criteria[optionKey(j)] = `${o.label} — ${o.append}`
    })
    questions[`d${i}`] = {
      type: 'choice',
      instructions: `Which option is the better next step for this work? ${d.question}`,
      criteria,
    }
  })
  return { model: JEV_MODEL, state: decisionState(summary), questions }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The Choice answers in a Jev response body; null when it is not the documented shape. */
export function parseChoiceAnswers(body: unknown): Record<string, ChoiceAnswer> | null {
  if (!isRecord(body) || !isRecord(body.answers)) return null
  const out: Record<string, ChoiceAnswer> = {}
  for (const [id, a] of Object.entries(body.answers)) {
    if (!isRecord(a) || a.type !== 'choice' || typeof a.choice !== 'string' || !isRecord(a.probabilities)) continue
    const probabilities: Record<string, number> = {}
    for (const [k, p] of Object.entries(a.probabilities)) if (typeof p === 'number') probabilities[k] = p
    out[id] = { choice: a.choice, confidence: typeof a.confidence === 'number' ? a.confidence : 0, probabilities }
  }
  return out
}

/** The summary with each option's probability filled from Jev's answers. */
export function applyDecisionRanks(summary: Summary, answers: Record<string, ChoiceAnswer>): Summary {
  return {
    ...summary,
    decisions: summary.decisions.map((d, i) => {
      const a = answers[`d${i}`]
      if (!a) return d
      return {
        ...d,
        confidence: a.confidence,
        options: d.options.map((o, j) => ({ ...o, p: a.probabilities[optionKey(j)] ?? null })),
      }
    }),
  }
}

// ---- shadow auto-approval ----

/** Bars an auto-approver would hold every decision of a card to. */
export const SHADOW_MIN_P = 0.9
export const SHADOW_MIN_CONFIDENCE = 0.8

/**
 * Acts an auto-approver must never take on its own: commit, push, merge, deploy, delete, publish,
 * send, anything that costs money, and settings changes. Matched in every option of the card.
 */
export const RISK_KEYWORDS: readonly string[] = [
  '커밋', 'commit',
  '푸시', 'push',
  '머지', '병합', 'merge',
  '배포', 'deploy', 'release',
  '삭제', 'delete', 'remove', 'rm ',
  '발행', 'publish',
  '전송', '보내', 'send',
  '비용', '결제', '과금', 'eval', '$',
  '설정', 'settings', 'config',
]

/** The first risk keyword in `text`, or null. */
export function riskIn(text: string): string | null {
  const t = text.toLowerCase()
  return RISK_KEYWORDS.find(k => t.includes(k.toLowerCase())) ?? null
}

/** What an auto-approver would have done with this card. `rankNote` explains an unranked card. */
export function shadowVerdict(summary: Summary, ranked: boolean, rankNote: string | null = null): ShadowVerdict {
  const n = summary.decisions.length
  if (!ranked) return { eligible: false, picks: Array<number | null>(n).fill(null), reasons: [`Jev 순위 없음${rankNote ? ` (${rankNote})` : ''}`] }
  const reasons: string[] = []
  const tops: Array<number | null> = summary.decisions.map((d, i) => {
    const top = rankedOptions(d)[0]
    const q = `Q${i + 1}`
    if (!top || top.p === null) {
      reasons.push(`${q} 확률 없음`)
      return null
    }
    if (top.p < SHADOW_MIN_P) reasons.push(`${q} 확률 미달 (${Math.round(top.p * 100)}% < ${SHADOW_MIN_P * 100}%)`)
    if ((d.confidence ?? 0) < SHADOW_MIN_CONFIDENCE) {
      reasons.push(`${q} 확신도 미달 (${Math.round((d.confidence ?? 0) * 100)}% < ${SHADOW_MIN_CONFIDENCE * 100}%)`)
    }
    for (const o of d.options) {
      const k = riskIn(`${o.label} ${o.append}`)
      if (k) {
        reasons.push(`${q} 위험 키워드 '${k.trim()}' (${o.label})`)
        break
      }
    }
    return top.index
  })
  const eligible = n > 0 && reasons.length === 0
  return { eligible, picks: eligible ? tops : Array<number | null>(n).fill(null), reasons }
}

// ---- skills ----

/** Jev's Choice cap is 255 options; one is kept for "none". */
export const MAX_SKILLS = 254

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w.length >= 2),
  )
}

/** Up to `max` candidates, the ones sharing the most words with the draft first. */
export function shortlistSkills(draft: string, skills: SkillCandidate[], max = MAX_SKILLS): SkillCandidate[] {
  if (skills.length <= max) return skills
  const w = words(draft)
  const score = (s: SkillCandidate): number => {
    let n = 0
    for (const x of words(`${s.name} ${s.description}`)) if (w.has(x)) n++
    return n
  }
  return skills
    .map((s, i) => ({ s, i, n: score(s) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max)
    .map(x => x.s)
}

export function skillRequest(draft: string, skills: SkillCandidate[]): JevRequest {
  const criteria: Record<string, string> = {}
  for (const s of skills) criteria[s.name] = s.description.slice(0, 300) || s.name
  criteria[NONE] = 'No listed skill fits; an ordinary request.'
  return {
    model: JEV_MODEL,
    state: draft,
    questions: {
      skill: {
        type: 'choice',
        instructions: 'Which skill (slash command) best handles this request a developer is typing?',
        criteria,
      },
    },
  }
}

/** The skill Jev picked, when it is a real skill above `threshold`; null otherwise. */
export function pickSkill(answers: Record<string, ChoiceAnswer>, skills: SkillCandidate[], draft: string, threshold: number): SkillHint | null {
  const a = answers.skill
  if (!a || a.choice === NONE) return null
  const p = a.probabilities[a.choice] ?? 0
  const s = skills.find(x => x.name === a.choice)
  return s && p >= threshold ? { ...s, p, draft } : null
}

/** A draft worth classifying: long enough, not already a slash command. */
export function shouldClassify(draft: string): boolean {
  const t = draft.trim()
  return t.length >= 12 && !t.startsWith('/')
}

export const pct = (p: number | null): string => (p === null ? '' : ` ${Math.round(p * 100)}%`)
