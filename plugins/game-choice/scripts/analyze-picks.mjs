// analyze-picks.mjs
// Reads ~/.claude/game-choice/picks.json (written by the game-choice mod) and reports:
// how often the person picked Jev's first choice, how Jev's odds match the picks per bin,
// how often the shadow auto-approver would have picked what the person picked, and whether
// the bar for turning real auto-approval on is met.
// Usage: node analyze-picks.mjs [path/to/picks.json]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = process.argv[2] ?? join(homedir(), '.claude', 'game-choice', 'picks.json')
const rows = JSON.parse(readFileSync(file, 'utf8'))

/** Turning real auto-approval on needs all four. */
const BAR = { cards: 30, top1: 0.9, bin90: 0.9, shadow: 0.9 }
/** Below this many shadow-eligible cards the shadow hit rate is not trusted; shadow mode runs another week. */
const MIN_SHADOW_CARDS = 10

// Picks the auto-approver made itself would grade Jev with Jev's own answers: left out.
const human = rows.filter(r => r.auto !== true)

// A card's decisions share cardAt; rows written before cardAt existed count as one card each.
const optionsKey = r => r.options.map(o => `${o.label}=${o.p}`).join('|')
const cardOf = r => (typeof r.cardAt === 'number' ? `card:${r.cardAt}` : `old:${r.question}\u0000${optionsKey(r)}`)
// A decision can be clicked more than once; its last pick is the person's answer.
const last = new Map()
for (const r of human) last.set(`${cardOf(r)}\u0000${r.question}`, r)
const decisions = [...last.values()].filter(r => r.rank === 'jev' && r.options.every(o => typeof o.p === 'number'))
const cards = new Set(decisions.map(cardOf))

// Rows written before `top` was recorded: Jev's first choice is the highest p (first option on ties).
const topOf = r => (typeof r.top === 'number' ? r.top : r.options.reduce((best, o, i, a) => (o.p > a[best].p ? i : best), 0))
const ratio = (hit, n) => (n ? hit / n : null)
const pct = x => (x === null ? '-' : `${(x * 100).toFixed(1)}%`)
const frac = (hit, n) => `${hit}/${n} = ${pct(ratio(hit, n))}`

// 1. Jev's first choice vs the pick.
const top1Hits = decisions.filter(r => topOf(r) === r.picked).length

// 2. Calibration: every option Jev scored is one prediction; it "happened" when that option was picked.
const BINS = [
  { name: '0–50%', lo: 0, hi: 0.5 },
  { name: '50–70%', lo: 0.5, hi: 0.7 },
  { name: '70–90%', lo: 0.7, hi: 0.9 },
  { name: '90–100%', lo: 0.9, hi: 1.000001 },
]
const bins = BINS.map(b => ({ ...b, n: 0, picked: 0, pSum: 0 }))
for (const r of decisions) {
  r.options.forEach((o, i) => {
    const b = bins.find(x => o.p >= x.lo && o.p < x.hi)
    b.n++
    b.pSum += o.p
    if (i === r.picked) b.picked++
  })
}
const bin90 = bins.at(-1)

// 3. Shadow: decisions whose card the auto-approver would have taken, and whether it would have picked the same.
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

console.log(`기록 ${rows.length}건 (자동 선택 ${rows.length - human.length}건 제외) → 결정 ${decisions.length}개, 카드 ${cards.size}개`)
console.log('')
console.log(`Jev 1순위 일치율: ${frac(top1Hits, decisions.length)}`)
console.log(`  퍼센트를 보고 고른 결정: ${frac(agree(shown), shown.length)} · 숨기고 고른 결정(섀도 모드): ${frac(agree(hidden), hidden.length)}`)
console.log('확률 구간별 적중률 (옵션 단위: Jev가 매긴 확률 vs 실제로 골린 비율)')
for (const b of bins) console.log(`  ${b.name.padEnd(8)} ${b.n ? `${frac(b.picked, b.n)} (Jev 평균 ${pct(b.pSum / b.n)})` : '-'}`)
console.log('')
console.log(`섀도 판정이 있는 결정: ${withShadow.length}개`)
console.log(`섀도 대상: 결정 ${shadowTargets.length}개, 카드 ${shadowCards.size}개`)
console.log(`섀도 적중률 (자동이었다면 고른 옵션 = 실제 선택): ${frac(shadowHits, shadowTargets.length)}`)
if (reasons.size) console.log(`섀도 제외 이유: ${[...reasons].map(([k, n]) => `${k} ${n}`).join(', ')}`)
console.log('')

const check = (label, value, bar, fmt) => {
  const ok = value !== null && value >= bar
  console.log(`  [${ok ? '통과' : '미달'}] ${label}: ${fmt(value)} (기준 ${fmt(bar)})`)
  return ok
}
console.log('자동 승인 자격')
const pass = [
  check('결정 카드 수', cards.size, BAR.cards, v => `${v}개`),
  check('Jev 1순위 일치율', ratio(top1Hits, decisions.length), BAR.top1, pct),
  check('90–100% 구간 실제 적중', ratio(bin90.picked, bin90.n), BAR.bin90, pct),
  check('섀도 적중률', ratio(shadowHits, shadowTargets.length), BAR.shadow, pct),
].every(Boolean)
console.log(pass ? '→ 네 조건 모두 통과: 자동 승인을 켤 수 있습니다.' : '→ 아직 켜지 않습니다.')
// Decided 2026-10-09: too few shadow targets means more shadow time, not lower bars.
if (shadowCards.size < MIN_SHADOW_CARDS) {
  console.log(`→ 섀도 대상 카드 ${shadowCards.size}개 < ${MIN_SHADOW_CARDS}개: 기준은 그대로 두고 섀도 모드를 일주일 더 유지합니다.`)
}
if (cards.size < 20) console.log(`주의: 카드 ${cards.size}개로는 비율이 크게 흔들립니다.`)
