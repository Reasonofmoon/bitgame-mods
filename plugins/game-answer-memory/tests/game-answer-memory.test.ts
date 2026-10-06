import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { keyOf, markLast } from '../hooks/register'

// The dialog itself is the engine's own drawing, which the kit does not stand in for: the
// marking is checked as a function and the dialog was checked in a session (README).

const QUESTION = {
  question: '어떤 방식으로 고칠까요?',
  header: '수정 방식',
  options: [
    { label: '테스트를 바꾼다', description: '기대값을 초 단위로 맞춘다' },
    { label: '구현을 바꾼다', description: 'refresh가 초를 쓴다' },
  ],
  multiSelect: false,
}

function world(on: On) {
  const saved: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: saved[e.key] }))
  on('store.set', (_, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') return { result: { questions: e.questions, answers: { [QUESTION.question]: '구현을 바꾼다' } } }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return { saved }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

test('the answer a dialog brings back is kept for the project', async ($, on) => {
  const { saved } = world(on)
  await start($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] })
  const kept = saved['answers:/proj'] as Record<string, { answer: string }>
  expect(kept[keyOf(QUESTION.question)]?.answer).toBe('구현을 바꾼다')
})

test('the option chosen last time is marked; labels and order stay', () => {
  const kept = { [keyOf(QUESTION.question)]: { answer: '구현을 바꾼다', at: 0 } }
  const marked = markLast(QUESTION, kept, null) as typeof QUESTION
  expect(marked.options.map(o => o.description)).toEqual(['기대값을 초 단위로 맞춘다', '★ 지난번 선택 · refresh가 초를 쓴다'])
  expect(marked.options.map(o => o.label)).toEqual(['테스트를 바꾼다', '구현을 바꾼다'])
  // hardcore says when.
  const when = markLast(QUESTION, kept, 3 * 3_600_000) as typeof QUESTION
  expect(when.options[1]?.description).toBe('★ 지난번 선택 (3시간 전) · refresh가 초를 쓴다')
  // A multi-select answer marks each choice; a new question is left alone.
  const both = markLast(QUESTION, { [keyOf(QUESTION.question)]: { answer: '테스트를 바꾼다, 구현을 바꾼다', at: 0 } }, null) as typeof QUESTION
  expect(both.options.every(o => o.description.startsWith('★ 지난번 선택'))).toBe(true)
  expect(markLast({ ...QUESTION, question: '다른 질문?' }, kept, null)).toEqual({ ...QUESTION, question: '다른 질문?' })
})

test('the question matches through spacing, case and the question mark', () => {
  expect(keyOf('  Which  Library? ')).toBe(keyOf('which library'))
})
