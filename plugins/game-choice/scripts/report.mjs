// Pure report over picks.json rows. No engine or Node APIs, so the plugin tests can import it.
// The auto-approval bars stay Jev's: Gemini is a comparison, not a vote.

/** Turning real auto-approval on needs all four. */
const BAR = { cards: 30, top1: 0.9, bin90: 0.9, shadow: 0.9 }
/** Below this many shadow-eligible cards the shadow hit rate is not trusted; shadow mode runs another week. */
const MIN_SHADOW_CARDS = 10

const BINS = [
  { name: '0–50%', lo: 0, hi: 0.5 },
  { name: '50–70%', lo: 0.5, hi: 0.7 },
  { name: '70–90%', lo: 0.7, hi: 0.9 },
  { name: '90–100%', lo: 0.9, hi: 1.000001 },
]

const ratio = (hit, n) => (n ? hit / n : null)
const pct = x => (x === null ? '-' : `${(x * 100).toFixed(1)}%`)
const frac = (hit, n) => `${hit}/${n} = ${pct(ratio(hit, n))}`

function fillBins(pairs) {
  const bins = BINS.map(b => ({ ...b, n: 0, picked: 0, pSum: 0 }))
  for (const { p, picked } of pairs) {
    const b = bins.find(x => p >= x.lo && p < x.hi)
    if (!b) continue
    b.n++
    b.pSum += p
    if (picked) b.picked++
  }
  return bins
}

/** The text `analyze-picks.mjs` prints. `rows` is the picks.json array. */
export function summarizePicks(rows) {
  // Picks the auto-approver made itself would grade Jev with Jev's own answers: left out.
  const human = rows.filter(r => r.auto !== true)

  // A card's decisions share cardAt; rows written before cardAt existed count as one card each.
  const optionsKey = r => r.options.map(o => `${o.label}=${o.p}`).join('|')
  const cardOf = r => (typeof r.cardAt === 'number' ? `card:${r.cardAt}` : `old:${r.question}\u0000${optionsKey(r)}`)
  // A decision can be clicked more than once; its last pick is the person's answer.
  const last = new Map()
  for (const r of human) last.set(`${cardOf(r)}\u0000${r.question}`, r)
  const latest = [...last.values()]
  // Jev's bars use only the decisions Jev actually scored.
  const decisions = latest.filter(r => r.rank === 'jev' && r.options.every(o => typeof o.p === 'number'))
  const cards = new Set(decisions.map(cardOf))

  // Rows written before `top` was recorded: Jev's first choice is the highest p (first option on ties).
  const topOf = r => (typeof r.top === 'number' ? r.top : r.options.reduce((best, o, i, a) => (o.p > a[best].p ? i : best), 0))

  const top1Hits = decisions.filter(r => topOf(r) === r.picked).length
  const bins = fillBins(decisions.flatMap(r => r.options.map((o, i) => ({ p: o.p, picked: i === r.picked }))))
  const bin90 = bins.at(-1)

  // Gemini is counted on its own rows, including picks Jev did not rank.
  // A missing choice, a failure string, or a short probability list is a failed decision.
  const geminiReady = r => {
    const g = r.gemini
    return Boolean(
      g && !g.failure && typeof g.choice === 'number' && Array.isArray(g.p) && g.p.length === r.options.length && g.p.every(p => typeof p === 'number'),
    )
  }
  const withGemini = latest.filter(r => r.gemini)
  const geminiRows = withGemini.filter(geminiReady)
  const geminiHits = geminiRows.filter(r => r.gemini.choice === r.picked).length
  const geminiFailed = withGemini.length - geminiRows.length
  // Agreement needs both engines. It stays on the Jev-scored rows Gemini also scored.
  const both = decisions.filter(geminiReady)
  const engineAgree = both.filter(r => topOf(r) === r.gemini.choice).length
  const geminiBins = fillBins(geminiRows.flatMap(r => r.gemini.p.map((p, i) => ({ p, picked: i === r.picked }))))

  const withShadow = decisions.filter(r => r.shadow)
  const shadowTargets = withShadow.filter(r => r.shadow.eligible && typeof r.shadow.pick === 'number')
  const shadowHits = shadowTargets.filter(r => r.shadow.pick === r.picked).length
  const shadowCards = new Set(shadowTargets.map(cardOf))
  const reasons = new Map()
  for (const r of withShadow.filter(x => !x.shadow.eligible)) {
    for (const why of r.shadow.reasons) {
      const kind = why.includes('확률 미달') ? '확률 미달' : why.includes('확신도 미달') ? '확신도 미달' : why.includes('위험 키워드') ? '위험 키워드' : why
      reasons.set(kind, (reasons.get(kind) ?? 0) + 1)
    }
  }

  // Anchoring check: does agreement with Jev change when its odds were on screen?
  // Rows from before shadow mode carry no flag; those picks were made with the odds on screen.
  const shown = decisions.filter(r => r.shadowMode !== true)
  const hidden = decisions.filter(r => r.shadowMode === true)
  const agree = rs => rs.filter(r => topOf(r) === r.picked).length

  const lines = [
    `기록 ${rows.length}건 (자동 선택 ${rows.length - human.length}건 제외) → 결정 ${decisions.length}개, 카드 ${cards.size}개`,
    '',
    `Jev 1순위 일치율: ${frac(top1Hits, decisions.length)}`,
    `  퍼센트를 보고 고른 결정: ${frac(agree(shown), shown.length)} · 숨기고 고른 결정(섀도 모드): ${frac(agree(hidden), hidden.length)}`,
    `Gemini 1순위 일치율: ${frac(geminiHits, geminiRows.length)} (성공한 결정 ${geminiRows.length}개, 실패 ${geminiFailed}개)`,
    `Jev·Gemini 1순위 일치: ${frac(engineAgree, both.length)}`,
    '확률 구간별 적중률 (옵션 단위: Jev가 매긴 확률 vs 실제로 골린 비율)',
    ...bins.map(b => `  ${b.name.padEnd(8)} ${b.n ? `${frac(b.picked, b.n)} (Jev 평균 ${pct(b.pSum / b.n)})` : '-'}`),
    'Gemini 확률 구간별 적중률 (옵션 단위: Gemini가 매긴 확률 vs 실제로 골린 비율)',
    ...geminiBins.map(b => `  ${b.name.padEnd(8)} ${b.n ? `${frac(b.picked, b.n)} (Gemini 평균 ${pct(b.pSum / b.n)})` : '-'}`),
    '',
    `섀도 판정이 있는 결정: ${withShadow.length}개`,
    `섀도 대상: 결정 ${shadowTargets.length}개, 카드 ${shadowCards.size}개`,
    `섀도 적중률 (자동이었다면 고른 옵션 = 실제 선택): ${frac(shadowHits, shadowTargets.length)}`,
  ]
  if (reasons.size) lines.push(`섀도 제외 이유: ${[...reasons].map(([k, n]) => `${k} ${n}`).join(', ')}`)
  lines.push('')
  lines.push('자동 승인 자격')

  const check = (label, value, bar, fmt) => {
    const ok = value !== null && value >= bar
    lines.push(`  [${ok ? '통과' : '미달'}] ${label}: ${fmt(value)} (기준 ${fmt(bar)})`)
    return ok
  }
  const pass = [
    check('결정 카드 수', cards.size, BAR.cards, v => `${v}개`),
    check('Jev 1순위 일치율', ratio(top1Hits, decisions.length), BAR.top1, pct),
    check('90–100% 구간 실제 적중', ratio(bin90.picked, bin90.n), BAR.bin90, pct),
    check('섀도 적중률', ratio(shadowHits, shadowTargets.length), BAR.shadow, pct),
  ].every(Boolean)
  lines.push(pass ? '→ 네 조건 모두 통과: 자동 승인을 켤 수 있습니다.' : '→ 아직 켜지 않습니다.')
  // Decided 2026-10-09: too few shadow targets means more shadow time, not lower bars.
  if (shadowCards.size < MIN_SHADOW_CARDS) {
    lines.push(`→ 섀도 대상 카드 ${shadowCards.size}개 < ${MIN_SHADOW_CARDS}개: 기준은 그대로 두고 섀도 모드를 일주일 더 유지합니다.`)
  }
  if (cards.size < 20) lines.push(`주의: 카드 ${cards.size}개로는 비율이 크게 흔들립니다.`)
  return lines.join('\n')
}
