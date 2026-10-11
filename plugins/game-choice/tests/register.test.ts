import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}

const SURFACES = ['terminal', 'desktop'] as const

const ANSWER = [
  '끝났습니다.',
  '[상태 요약]',
  '1. 지금까지 한 일:',
  '   - 무언가',
  '3. 내가 결정해야 할 것:',
  '   - Q: eval을 지금 돌릴까요?',
  '     - 지금 실행 => eval을 실행하라.',
  '     - 나중에 => eval은 건너뛰어라.',
  '4. 다음에 이어서 할 때 붙여넣을 프롬프트:',
  '   - 판정기 작업을 이어서 하라.',
  '5. 산출물/파일/링크:',
  '   - (해당 없음)',
].join('\n')

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type WorldOpts = {
  key?: string
  probs?: Record<string, number>
  status?: number
  /** The box holds the suggestion back, as it does while a turn still runs. */
  suggestHangs?: boolean
  /** Jev never answers. */
  fetchHangs?: boolean
  confidence?: number
}

function world(on: On, opts: WorldOpts = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const suggested: string[] = []
  const jevBodies: unknown[] = []
  const forks: string[] = []
  const written: Array<{ path: string; text: string }> = []
  on('env.get', (_, e) => ({ value: e.name === 'TYPESAFE_API_KEY' ? opts.key : e.name === 'USERPROFILE' ? 'C:/Users/t' : undefined }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    jevBodies.push(JSON.parse(e.init?.body ?? 'null'))
    if (opts.fetchHangs) return new Promise<never>(() => undefined)
    const answers = { d0: { type: 'choice', choice: 'B', confidence: opts.confidence ?? 0.5, probabilities: opts.probs ?? { A: 0.3, B: 0.7 } } }
    const status = opts.status ?? 200
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify({ model: 'jev-1.13.0', answers }) } }
  })
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    if (opts.suggestHangs) return new Promise<never>(() => undefined)
    return { isShown: true }
  })
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true as const, text: '다듬은 재개 프롬프트', usage: USAGE } }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, 'engine') as RenderElement
  })
  return { suggested, jevBodies, forks, clock, written }
}

async function finish($: Engine, answer = ANSWER) {
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}

type Finder = { findAll: (q: { type: string }) => Promise<Array<{ text: string }>> }

async function labels(ui: Finder): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(b => b.text)
}

test('the resume prompt is suggested and the decisions are Jev-ranked buttons', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k' })
  await finish($)
  expect(w.suggested[0]).toBe('판정기 작업을 이어서 하라.')
  expect(w.jevBodies).toHaveLength(1)
  // Jev judges against what was done (item 1), not just the resume prompt.
  expect((w.jevBodies[0] as { state: string }).state).toBe('Work to resume: 판정기 작업을 이어서 하라.\nDone so far:\n- 무언가')
  // The trace lands outside the mod's folder, with the odds and no key.
  // The engine hands paths on in the platform's own form (backslashes on Windows).
  const trace = w.written.find(f => f.path.replace(/\\/g, '/').endsWith('/.claude/game-choice/last-jev.json'))
  expect(trace?.text.includes('"B": 0.7')).toBe(true)
  expect(trace?.text.includes('"k"')).toBe(false)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'game-choice', surface, ...BAND })
    expect(await labels(ui)).toEqual(['닫기', '나중에 70%', '지금 실행 30%'])
    expect(await ui.find({ type: 'Text', text: /Jev 확률순/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('picking appends the sentence, then the last pick is polished by a fork', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k' })
  await finish($)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  await ui.press({ key: 'd0-o0' })
  expect(w.suggested).toContain('판정기 작업을 이어서 하라. eval을 실행하라.')
  // The pick is mirrored to picks.json with Jev's first choice beside the one taken.
  const picksFile = w.written.find(f => f.path.replace(/\\/g, '/').endsWith('/.claude/game-choice/picks.json'))
  const picks = JSON.parse(picksFile?.text ?? '[]') as Array<{ picked: number; top: number | null; rank: string }>
  expect(picks.map(p => [p.picked, p.top, p.rank])).toEqual([[0, 1, 'jev']])
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('eval을 지금 돌릴까요? → 지금 실행')
  expect(w.suggested.at(-1)).toBe('다듬은 재개 프롬프트')
  expect(await labels(ui)).toContain('✓ 지금 실행 30%')
  // The engine's own guess gives way to the polished prompt; another plugin's passes untouched.
  await $.prompt.suggest({ text: 'engine guess', origin: { kind: 'suggestion' } })
  expect(w.suggested.at(-1)).toBe('다듬은 재개 프롬프트')
  await $.prompt.suggest({ text: 'another plugin', origin: { kind: 'plugin', name: 'other' } })
  expect(w.suggested.at(-1)).toBe('another plugin')
  await ui.unmount()
})

// Regression: in a real session the box holds a suggestion back while the turn runs, and the
// turn.complete hook is part of that turn; awaiting the suggestion there kept Jev from ever being asked.
test('Jev still ranks while the box holds the suggestion back', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k', suggestHangs: true })
  await finish($)
  expect(w.jevBodies).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'desktop', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '나중에 70%', '지금 실행 30%'])
})

test('a Jev call that never returns times out into Claude order', async ($, on) => {
  const w = world(on, { key: 'k', fetchHangs: true })
  const done = finish($)
  await w.clock.advance(8000)
  await done
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '지금 실행', '나중에'])
  expect(await ui.find({ type: 'Text', text: /시간 초과/ })).toBeDefined()
})

test('without a Jev key the buttons keep Claude order and say why', async ($, on) => {
  const w = world(on, {})
  await finish($)
  expect(w.jevBodies).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '지금 실행', '나중에'])
  expect(await ui.find({ type: 'Text', text: /TYPESAFE_API_KEY 없음/ })).toBeDefined()
})

test('a Jev error falls back the same way', async ($, on) => {
  world(on, { key: 'k', status: 401 })
  await finish($)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '지금 실행', '나중에'])
  expect(await ui.find({ type: 'Text', text: /HTTP 401/ })).toBeDefined()
})

type PickRow = {
  cardAt: number
  picked: number
  top: number | null
  confidence: number | null
  shadowMode: boolean
  auto: boolean
  shadow: { eligible: boolean; pick: number | null; reasons: string[] }
}

function picksOf(w: { written: Array<{ path: string; text: string }> }): PickRow[] {
  const f = w.written.filter(x => x.path.replace(/\\/g, '/').endsWith('/game-choice/picks.json')).at(-1)
  return JSON.parse(f?.text ?? '[]') as PickRow[]
}

const SAFE_ANSWER = [
  '[상태 요약]',
  '1. 지금까지 한 일:',
  '   - 문서 초안',
  '3. 내가 결정해야 할 것:',
  '   - Q: 다음 절은 무엇을 쓸까요?',
  '     - 예시 추가 => 2절에 예시를 하나 더 써라.',
  '     - 표로 정리 => 2절을 표로 정리하라.',
  '4. 다음에 이어서 할 때 붙여넣을 프롬프트:',
  '   - 문서 2절을 이어서 써라.',
  '5. 산출물/파일/링크:',
  '   - (해당 없음)',
].join('\n')

test('shadow mode (default): Claude order, no odds, Jev still asked; the pick records why it was not auto', async ($, on) => {
  const w = world(on, { key: 'k' })
  await finish($)
  expect(w.jevBodies).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '지금 실행', '나중에'])
  expect(await ui.find({ type: 'Text', text: /섀도 모드 · Claude 순서 \(Jev 순위 숨김\)/ })).toBeDefined()
  await ui.press({ key: 'd0-o1' })
  const [row] = picksOf(w)
  expect(row?.picked).toBe(1)
  expect(row?.top).toBe(1)
  expect(row?.confidence).toBe(0.5)
  expect(row?.shadowMode).toBe(true)
  expect(row?.auto).toBe(false)
  expect(row?.shadow.eligible).toBe(false)
  expect(row?.shadow.pick).toBe(null)
  // 70% < 90%, 50% < 80%, and "eval을 실행하라" is a costly run.
  expect(row?.shadow.reasons).toEqual(["Q1 확률 미달 (70% < 90%)", "Q1 확신도 미달 (50% < 80%)", "Q1 위험 키워드 'eval' (지금 실행)"])
})

test('shadow mode: a confident, safe card is recorded as what auto would have picked', async ($, on) => {
  const w = world(on, { key: 'k', probs: { A: 0.95, B: 0.05 }, confidence: 0.92 })
  await finish($, SAFE_ANSWER)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'desktop', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '예시 추가', '표로 정리'])
  await ui.press({ key: 'd0-o1' })
  const [row] = picksOf(w)
  expect(row?.shadow).toEqual({ eligible: true, pick: 0, reasons: [] })
  // The person disagreed with the would-be auto pick: exactly what the shadow hit rate measures.
  expect(row?.picked).toBe(1)
  expect(typeof row?.cardAt).toBe('number')
})

test('submitting clears the card; answers without a summary leave nothing', async ($, on) => {
  const w = world(on, { key: 'k' })
  await finish($, '요약 없는 답변')
  expect(w.suggested).toHaveLength(0)
  await finish($)
  await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false })
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual([])
})
