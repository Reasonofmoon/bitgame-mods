import { expect, test } from 'claude-code/testing'

import {
  STATE_MAX_CHARS,
  applyDecisionRanks,
  composePrompt,
  decisionRequest,
  decisionState,
  parseChoiceAnswers,
  parseStatusSummary,
  pickSkill,
  rankedOptions,
  riskIn,
  shadowVerdict,
  shortlistSkills,
  shouldClassify,
  skillRequest,
} from '../hooks/core'

const ANSWER = [
  '작업을 마쳤습니다.',
  '',
  '```',
  '[상태 요약]',
  '1. 지금까지 한 일:',
  '   - 판정기 작성',
  '2. 아직 남은 일:',
  '   - eval 실행',
  '3. 내가 결정해야 할 것:',
  '   - Q: eval을 지금 돌릴까요?',
  '     - 지금 실행 => eval을 --fp 30으로 실행하라.',
  '     - 나중에 => eval은 건너뛰고 커밋만 하라.',
  '   - Q: 커밋할까요?',
  '     - 커밋 => feat(qa) 커밋을 만들어라.',
  '     - 보류 => 커밋하지 마라.',
  '   - Q: 옵션이 하나뿐인 질문',
  '     - 혼자 => 버려져야 한다.',
  '4. 다음에 이어서 할 때 붙여넣을 프롬프트:',
  '   - naecon 레포 feat/qa-judge 브랜치에서',
  '     판정기를 이어서 작업하라.',
  '5. 산출물/파일/링크:',
  '   - qaJudge.ts',
  '```',
].join('\n')

test('reads the last status summary: resume prompt joined, decisions with 2+ options', () => {
  const s = parseStatusSummary(`[상태 요약]\n4. 다음:\n   - 옛 요약\n5. x\n\n${ANSWER}`)
  expect(s?.resume).toBe('naecon 레포 feat/qa-judge 브랜치에서 판정기를 이어서 작업하라.')
  expect(s?.decisions.map(d => d.question)).toEqual(['eval을 지금 돌릴까요?', '커밋할까요?'])
  expect(s?.decisions[0]?.options).toEqual([
    { label: '지금 실행', append: 'eval을 --fp 30으로 실행하라.', p: null },
    { label: '나중에', append: 'eval은 건너뛰고 커밋만 하라.', p: null },
  ])
  expect(s?.done).toEqual(['판정기 작성'])
  expect(s?.todo).toEqual(['eval 실행'])
})

test('items 1 and 2: continuation lines join their bullet, (해당 없음) is dropped', () => {
  const s = parseStatusSummary(
    ['[상태 요약]', '1. 한 일:', '   - 첫째', '     이어지는 줄', '   - 둘째', '2. 남은 일:', '   - (해당 없음)', '4. 프롬프트:', '   - 이어서 하라.', '5. x'].join('\n'),
  )
  expect(s?.done).toEqual(['첫째 이어지는 줄', '둘째'])
  expect(s?.todo).toEqual([])
})

test('Jev state carries what was done and what is left, within the cap', () => {
  const s = parseStatusSummary(ANSWER)
  if (!s) throw new Error('no summary')
  expect(decisionState(s)).toBe(
    ['Work to resume: naecon 레포 feat/qa-judge 브랜치에서 판정기를 이어서 작업하라.', 'Done so far:', '- 판정기 작성', 'Still to do:', '- eval 실행'].join('\n'),
  )
  const long = { ...s, done: Array.from({ length: 200 }, (_, i) => `작업 ${i} `.repeat(5)), todo: ['남은 일'] }
  const state = decisionState(long)
  expect(state.length <= STATE_MAX_CHARS).toBe(true)
  expect(state.startsWith('Work to resume: naecon')).toBe(true)
  expect(state.includes('Done so far:')).toBe(true)
})

test('no summary, or an empty item 4, gives nothing to suggest', () => {
  expect(parseStatusSummary('그냥 답변')).toBe(null)
  expect(parseStatusSummary('[상태 요약]\n3. 결정:\n   - (해당 없음)\n4. 프롬프트:\n   - (해당 없음)\n5. x')).toBe(null)
})

test('picks append their sentences in decision order', () => {
  const s = parseStatusSummary(ANSWER)
  if (!s) throw new Error('no summary')
  const picked = { ...s, decisions: s.decisions.map((d, i) => ({ ...d, picked: i === 0 ? 1 : 0 })) }
  expect(composePrompt(picked)).toBe(
    'naecon 레포 feat/qa-judge 브랜치에서 판정기를 이어서 작업하라. eval은 건너뛰고 커밋만 하라. feat(qa) 커밋을 만들어라.',
  )
})

test('Jev request: one choice question per decision; ranks applied back by option key', () => {
  const s = parseStatusSummary(ANSWER)
  if (!s) throw new Error('no summary')
  const req = decisionRequest(s)
  expect(Object.keys(req.questions)).toEqual(['d0', 'd1'])
  expect(req.questions.d0?.criteria).toEqual({ A: '지금 실행 — eval을 --fp 30으로 실행하라.', B: '나중에 — eval은 건너뛰고 커밋만 하라.' })

  const answers = parseChoiceAnswers({
    model: 'jev-1.13.0',
    answers: {
      d0: { type: 'choice', choice: 'B', confidence: 0.4, probabilities: { A: 0.3, B: 0.7 } },
      d1: { type: 'score', score: 2 },
    },
  })
  expect(answers && Object.keys(answers)).toEqual(['d0'])
  const ranked = applyDecisionRanks(s, answers ?? {})
  expect(rankedOptions(ranked.decisions[0]!).map(o => [o.label, o.p, o.index])).toEqual([
    ['나중에', 0.7, 1],
    ['지금 실행', 0.3, 0],
  ])
  // Unranked decisions keep Claude's order.
  expect(rankedOptions(ranked.decisions[1]!).map(o => o.label)).toEqual(['커밋', '보류'])
})

test('malformed Jev bodies are rejected', () => {
  expect(parseChoiceAnswers(null)).toBe(null)
  expect(parseChoiceAnswers({ answers: [] })).toBe(null)
  expect(parseChoiceAnswers({ answers: { d0: { type: 'choice', choice: 1 } } })).toEqual({})
})

test('skills: shortlist by shared words, request carries none, threshold gates the pick', () => {
  const skills = [
    { name: 'hwpx', description: '한글 HWPX 문서 만들기' },
    { name: 'deploy', description: 'Vercel 배포' },
    { name: 'pdf', description: 'PDF 읽기와 만들기' },
  ]
  expect(shortlistSkills('hwpx 문서로 내보내기', skills, 1).map(s => s.name)).toEqual(['hwpx'])
  expect(shortlistSkills('anything', skills).length).toBe(3)

  const req = skillRequest('hwpx 문서로 내보내 줘', skills)
  expect(Object.keys(req.questions.skill?.criteria ?? {})).toEqual(['hwpx', 'deploy', 'pdf', 'none'])

  const answers = { skill: { choice: 'hwpx', confidence: 0.8, probabilities: { hwpx: 0.82, none: 0.1 } } }
  expect(pickSkill(answers, skills, 'd', 0.5)).toEqual({ name: 'hwpx', description: '한글 HWPX 문서 만들기', p: 0.82, draft: 'd' })
  expect(pickSkill(answers, skills, 'd', 0.9)).toBe(null)
  expect(pickSkill({ skill: { choice: 'none', confidence: 1, probabilities: { none: 1 } } }, skills, 'd', 0.5)).toBe(null)
})

test('risk keywords catch irreversible or costly acts, in Korean or English', () => {
  expect(riskIn('feat(qa) 커밋을 만들어라.')).toBe('커밋')
  expect(riskIn('git push origin main')).toBe('push')
  expect(riskIn('Vercel에 배포')).toBe('배포')
  expect(riskIn('eval을 --fp 30으로 실행하라.')).toBe('eval')
  expect(riskIn('settings.json을 고쳐라')).toBe('settings')
  expect(riskIn('2절에 예시를 하나 더 써라.')).toBe(null)
})

test('shadow verdict: every decision must clear both bars, and no option may be risky', () => {
  const card = (p: number[], confidence: number, labels = ['예시 추가', '표로 정리']) => ({
    resume: 'r',
    done: [],
    todo: [],
    decisions: [
      {
        question: 'q',
        picked: null,
        confidence,
        options: labels.map((label, i) => ({ label, append: `${label} 하라.`, p: p[i] ?? null })),
      },
    ],
  })
  expect(shadowVerdict(card([0.05, 0.95], 0.9), true)).toEqual({ eligible: true, picks: [1], reasons: [] })
  expect(shadowVerdict(card([0.85, 0.15], 0.9), true).reasons).toEqual(['Q1 확률 미달 (85% < 90%)'])
  expect(shadowVerdict(card([0.95, 0.05], 0.7), true).reasons).toEqual(['Q1 확신도 미달 (70% < 80%)'])
  // Risk is checked in every option, not just Jev's pick: the card is the unit the person reviews.
  expect(shadowVerdict(card([0.99, 0.01], 0.99, ['그대로 둔다', '바로 배포']), true)).toEqual({
    eligible: false,
    picks: [null],
    reasons: ["Q1 위험 키워드 '배포' (바로 배포)"],
  })
  expect(shadowVerdict(card([0.99, 0.01], 0.99), false, 'HTTP 401').reasons).toEqual(['Jev 순위 없음 (HTTP 401)'])
})

test('only drafts worth classifying go to Jev', () => {
  expect(shouldClassify('짧음')).toBe(false)
  expect(shouldClassify('/hwpx 이 파일을 변환해 줘')).toBe(false)
  expect(shouldClassify('이 시험지를 한글 파일로 변환해 줘')).toBe(true)
})
