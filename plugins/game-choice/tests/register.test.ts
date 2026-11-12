import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { GEMINI_MODEL, GEMINI_URL } from '../hooks/core'

/** Built at run time so this file holds no real-looking key. */
const GEMINI_KEY = ['not', 'a', 'gemini', 'key'].join('-')

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
  /** When set, Gemini Decision 1 is asked in the shadow. */
  geminiKey?: string
  probs?: Record<string, number>
  status?: number
  /** The box holds the suggestion back, as it does while a turn still runs. */
  suggestHangs?: boolean
  /** Jev never answers. */
  fetchHangs?: boolean
  /** Gemini never answers. */
  geminiHangs?: boolean
  geminiStatus?: number
  geminiAnswers?: Record<string, unknown>
  geminiText?: string
  confidence?: number
}

type GeminiCall = { url: string; headers: Record<string, string> | null; body: unknown }

function world(on: On, opts: WorldOpts = {}) {
  mock.store(on)
  const clock = mock.clock(on)
  const suggested: string[] = []
  const jevBodies: unknown[] = []
  const geminiCalls: GeminiCall[] = []
  const forks: string[] = []
  const written: Array<{ path: string; text: string }> = []
  on('env.get', (_, e) => ({
    value:
      e.name === 'TYPESAFE_API_KEY'
        ? opts.key
        : e.name === 'GEMINI_API_KEY'
          ? opts.geminiKey
          : e.name === 'USERPROFILE'
            ? 'C:/Users/t'
            : undefined,
  }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    const body = JSON.parse(e.init?.body ?? 'null') as unknown
    const rawHeaders = e.init?.headers
    const headers = rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders) ? (rawHeaders as Record<string, string>) : null
    if (body && typeof body === 'object' && 'input' in body) {
      geminiCalls.push({ url: e.url, headers, body })
      if (opts.geminiHangs) return new Promise<never>(() => undefined)
      const status = opts.geminiStatus ?? 200
      const text =
        opts.geminiText ??
        JSON.stringify({
          answers: opts.geminiAnswers ?? {
            d0: { type: 'choice', choice: 'A', confidence: 0.42, probabilities: { A: 0.22, B: 0.78 } },
          },
        })
      return { value: { status, ok: status < 300, headers: {}, text } }
    }
    jevBodies.push(body)
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
  return { suggested, jevBodies, geminiCalls, forks, clock, written }
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
  rank: string
  shadowMode: boolean
  auto: boolean
  shadow: { eligible: boolean; pick: number | null; reasons: string[] }
  gemini?: { p: Array<number | null>; choice: number | null; confidence: number | null; ms: number; failure: string | null }
}

const CHOICE_CMD = { command: 'choice', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

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

test('shadow mode stays Claude order when Gemini disagrees with Jev', async ($, on) => {
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY })
  await finish($)
  expect(w.geminiCalls).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '지금 실행', '나중에'])
  expect(await ui.find({ type: 'Text', text: /섀도 모드 · Claude 순서 \(Jev 순위 숨김\)/ })).toBeDefined()
  await ui.unmount()
})

test('secret-shaped values are removed before the Gemini call and counted, while Jev still receives them', { options: { shadowMode: false } }, async ($, on) => {
  const anthropic = ['sk', 'ant', 'api03', 'B'.repeat(40)].join('-')
  const assigned = 'api_key=' + ['n0t', 'aReal', 'Value'].join('')
  const answer = [
    '[상태 요약]',
    '1. 지금까지 한 일:',
    `   - 받은 키 ${anthropic}`,
    '3. 내가 결정해야 할 것:',
    '   - Q: 키를 어디에 둘까요?',
    `     - 환경변수 => ${assigned} 는 환경 변수로만 읽어라.`,
    '     - 그대로 => 문장만 남겨라.',
    '4. 다음에 이어서 할 때 붙여넣을 프롬프트:',
    '   - 키 정리를 이어서 하라.',
    '5. 산출물/파일/링크:',
    '   - (해당 없음)',
  ].join('\n')
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY })
  await finish($, answer)
  const jev = JSON.stringify(w.jevBodies[0])
  expect(jev.includes(anthropic)).toBe(true)
  expect(jev.includes(assigned)).toBe(true)
  const sent = JSON.stringify(w.geminiCalls[0]?.body)
  expect(sent.includes(anthropic)).toBe(false)
  expect(sent.includes(assigned)).toBe(false)
  expect(sent.includes('[redacted]')).toBe(true)
  expect(sent.includes('"redacted"')).toBe(false)
  const trace = w.written.filter(f => f.path.replace(/\\/g, '/').endsWith('/last-gemini.json')).at(-1)
  expect(trace?.text.includes(anthropic)).toBe(false)
  expect(trace?.text.includes(assigned)).toBe(false)
  expect(trace?.text.includes('"redacted": 2')).toBe(true)
  const text = (await $.command.run(CHOICE_CMD)).text
  expect(text).toContain('가린 비밀 값: 2개')
  expect(text.includes(anthropic)).toBe(false)
  expect(text.includes(assigned)).toBe(false)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'desktop', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '그대로 70%', '환경변수 30%'])
  await ui.unmount()
})

test('without a Gemini key nothing is sent to Google and /choice says so', async ($, on) => {
  const w = world(on, { key: 'k' })
  await finish($)
  expect(w.geminiCalls).toHaveLength(0)
  expect(w.written.some(f => f.path.replace(/\\/g, '/').endsWith('/last-gemini.json'))).toBe(false)
  const text = (await $.command.run(CHOICE_CMD)).text
  expect(text).toContain('아직 Gemini를 부른 적이 없습니다')
  expect(text).toContain('마지막 Jev 호출')
})

test('Gemini ranks in the shadow: Jev still orders the buttons, the pick records Gemini beside it', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY })
  await finish($)
  expect(w.jevBodies).toHaveLength(1)
  expect(w.geminiCalls).toHaveLength(1)
  const call = w.geminiCalls[0]!
  expect(call.url).toBe(GEMINI_URL)
  expect(call.headers?.['x-goog-api-key']).toBe(GEMINI_KEY)
  expect(call.headers?.Authorization).toBeUndefined()
  const body = call.body as { model: string; input: Array<{ type: string; text: string }>; questions: unknown }
  const jev = w.jevBodies[0] as { state: string; questions: unknown }
  expect(body.model).toBe(GEMINI_MODEL)
  expect(body.input).toEqual([{ type: 'text', text: jev.state }])
  expect(body.questions).toEqual(jev.questions)
  expect(JSON.stringify(body).includes(GEMINI_KEY)).toBe(false)

  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  // 70/30 is Jev. Gemini's 78/22 must not move or relabel the buttons.
  expect(await labels(ui)).toEqual(['닫기', '나중에 70%', '지금 실행 30%'])
  await ui.press({ key: 'd0-o1' })
  const [row] = picksOf(w)
  expect(row?.rank).toBe('jev')
  expect(row?.top).toBe(1)
  expect(row?.gemini).toEqual({ p: [0.22, 0.78], choice: 0, confidence: 0.42, ms: row?.gemini?.ms, failure: null })
  expect(typeof row?.gemini?.ms).toBe('number')

  const trace = w.written.find(f => f.path.replace(/\\/g, '/').endsWith('/.claude/game-choice/last-gemini.json'))
  expect(trace?.text.includes('"A": 0.22')).toBe(true)
  expect(trace?.text.includes(GEMINI_KEY)).toBe(false)
  const text = (await $.command.run(CHOICE_CMD)).text
  expect(text).toContain('마지막 Gemini 호출: 결정 순위')
  expect(text).toContain('d0: A (확신도 42%)')
  expect(text).toContain('Gemini 섀도: Q1=A 확신도 42%')
  expect(text.includes(GEMINI_KEY)).toBe(false)
  await ui.unmount()
})

test('a Gemini HTTP error is recorded and leaves Jev order and the shadow verdict alone', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY, geminiStatus: 401 })
  await finish($)
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'desktop', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '나중에 70%', '지금 실행 30%'])
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('Jev 확률순'))).toBe(true)
  expect(texts.some(t => t.includes('HTTP 401'))).toBe(false)
  await ui.press({ key: 'd0-o0' })
  const [row] = picksOf(w)
  expect(row?.rank).toBe('jev')
  expect(row?.top).toBe(1)
  expect(row?.gemini?.failure).toBe('HTTP 401')
  expect(row?.gemini?.choice).toBe(null)
  expect(row?.shadow.reasons).toEqual(["Q1 확률 미달 (70% < 90%)", "Q1 확신도 미달 (50% < 80%)", "Q1 위험 키워드 'eval' (지금 실행)"])
  await ui.unmount()
})

test('a Gemini error body that echoes the key is stored without it', async ($, on) => {
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY, geminiStatus: 400, geminiText: `{"error":{"message":"bad ${GEMINI_KEY}"}}` })
  await finish($)
  const trace = w.written.filter(f => f.path.replace(/\\/g, '/').endsWith('/last-gemini.json')).at(-1)
  expect(trace?.text.includes(GEMINI_KEY)).toBe(false)
  expect(trace?.text.includes('…')).toBe(true)
  expect(trace?.text.includes('HTTP 400') || trace?.text.includes('"status": 400')).toBe(true)
})

test('a Gemini call that never returns times out on its own and Jev still ranks', { options: { shadowMode: false } }, async ($, on) => {
  const w = world(on, { key: 'k', geminiKey: GEMINI_KEY, geminiHangs: true })
  const done = finish($)
  await w.clock.advance(8000)
  await done
  const ui = await $.ui.mount({ plugin: 'game-choice', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['닫기', '나중에 70%', '지금 실행 30%'])
  await ui.press({ key: 'd0-o1' })
  const [row] = picksOf(w)
  expect(row?.rank).toBe('jev')
  expect(row?.gemini?.failure).toContain('시간 초과')
  expect(row?.gemini?.choice).toBe(null)
  const text = (await $.command.run(CHOICE_CMD)).text
  expect(text).toContain('Gemini 섀도: 실패')
  expect(text).toContain('시간 초과')
  await ui.unmount()
})
