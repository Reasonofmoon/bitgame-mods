import type { Register } from 'claude-code'

import { intensityOf } from './palette'

// GAME MODE · ANSWER MEMORY
//
// When Claude asks a question it asked before in this project, the option you chose
// last time is marked in the dialog:
//   어떤 방식으로 고칠까요?
//   ❯ 테스트 기대값을 바꾼다   ★ 지난번 선택 · 기대값을 초 단위로 맞춘다
//     구현을 바꾼다            …
// Only the dialog's drawing changes: the options, their order and the answer stay as asked.
// Answers are kept per project (the last 200 questions).

const KEEP = 200

type Kept = Record<string, { answer: string; at: number }>

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  let key = 'answers'
  let kept: Kept = {}

  on('session.start', async ($, e, next) => {
    key = `answers:${await $.session.root()}`
    kept = keptOf(await $.store.get(key))
    return next(e)
  })

  // The answers a dialog brought back, by question.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (intensity === 'off' || e.tool !== 'AskUserQuestion' || ran.deny !== undefined || ran.isError === true) return ran
    const answers = answersOf(ran.result)
    if (answers.length === 0) return ran
    const at = await $.clock.now()
    for (const [question, answer] of answers) kept[keyOf(question)] = { answer, at }
    const newest = Object.entries(kept)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, KEEP)
    kept = Object.fromEntries(newest)
    await $.store.set(key, kept)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (intensity === 'off') return next(e)
    const now = await $.clock.now()
    let isMarked = false
    const questions = e.props.questions.map(q => {
      const marked = markLast(q, kept, intensity === 'hardcore' ? now : null)
      if (marked !== q) isMarked = true
      return marked
    })
    return isMarked ? next({ ...e, props: { ...e.props, questions } }) : next(e)
  })
}

/** The question as it is matched: case, spacing and a trailing question mark ignored. */
export function keyOf(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?？]+$/, '')
}

/** The question with the option chosen last time marked in its description; the question itself when none was. */
export function markLast(question: unknown, kept: Kept, now: number | null): unknown {
  if (question === null || typeof question !== 'object') return question
  const q = question as { question?: unknown; options?: unknown }
  if (typeof q.question !== 'string' || !Array.isArray(q.options)) return question
  const last = kept[keyOf(q.question)]
  if (last === undefined) return question
  const chosen = new Set(last.answer.split(',').map(a => a.trim()))
  let isMarked = false
  const optionsOut = q.options.map(o => {
    if (o === null || typeof o !== 'object') return o
    const opt = o as { label?: unknown; description?: unknown }
    if (typeof opt.label !== 'string' || !chosen.has(opt.label)) return o
    isMarked = true
    const when = now === null ? '' : ` (${ago(now - last.at)})`
    const description = typeof opt.description === 'string' && opt.description !== '' ? ` · ${opt.description}` : ''
    return { ...opt, description: `★ 지난번 선택${when}${description}` }
  })
  return isMarked ? { ...q, options: optionsOut } : question
}

function answersOf(result: unknown): [string, string][] {
  const answers = result !== null && typeof result === 'object' ? (result as { answers?: unknown }).answers : undefined
  if (answers === null || typeof answers !== 'object') return []
  return Object.entries(answers as Record<string, unknown>).filter((x): x is [string, string] => typeof x[1] === 'string' && x[1] !== '')
}

function keptOf(value: unknown): Kept {
  if (value === null || typeof value !== 'object') return {}
  const out: Kept = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const o = v as { answer?: unknown; at?: unknown } | null
    if (o !== null && typeof o === 'object' && typeof o.answer === 'string' && typeof o.at === 'number') out[k] = { answer: o.answer, at: o.at }
  }
  return out
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}분 전`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`
}
