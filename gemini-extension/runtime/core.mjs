// GAME MODE Core Engine for Gemini CLI
// Ports the exact logic from bitgame-mods plugins (trap-guard, barrier, loop-breaker,
// spell-check, hedge-mark, hud, save-point, earcons, and game-choice/Jev) into a fast,
// zero-dependency ES module shared by hook-runner.mjs and cli.mjs.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const EXT_ROOT = path.resolve(__dirname, '..')
export const REPO_ROOT = path.resolve(EXT_ROOT, '..')
export const SOUNDS_DIR = path.join(REPO_ROOT, 'plugins', 'game-earcons', 'sounds')
export const STATE_DIR = path.join(os.homedir(), '.gemini', 'bitgame')
export const STATE_FILE = path.join(STATE_DIR, 'state.json')
export const CHOICE_FILE = path.join(STATE_DIR, 'last-choice.json')
export const SAVES_FILE = path.join(STATE_DIR, 'saves.json')
export const DUAL_SCREEN_FILE = path.join(STATE_DIR, 'dual-screen.txt')
export const TMUX_BIN = fs.existsSync('/opt/homebrew/bin/tmux') ? '/opt/homebrew/bin/tmux' : 'tmux'

const PASS_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// 1. Persistent State & Audio (game-earcons)
// ---------------------------------------------------------------------------

export function loadState() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    if (fs.existsSync(STATE_FILE)) {
      return { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
    }
  } catch {
    // fallback to default
  }
  return defaultState()
}

export function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
  } catch {
    // ignore write failures
  }
}

function defaultState() {
  return {
    level: 1,
    exp: 0,
    combo: 0,
    maxCombo: 0,
    turns: 0,
    toolCalls: 0,
    trapsBlocked: 0,
    earcons: false,
    autoFill: true,
    guardMode: 'block', // 'block' | 'warn' | 'off'
    passUntil: 0,
    streaks: {},
    inventory: [],
    achievements: [],
    turnDurationsMs: [],
    lastTurnStartMs: Date.now(),
    lastSavedPassword: null,
    quests: [],
    questsCarried: false,
    minimapVisits: {},
    dualScreen: true,
    tmuxPaneId: null,
  }
}

export function playSound(cue, enabled = true) {
  if (!enabled) return
  const wav = path.join(SOUNDS_DIR, `${cue}.wav`)
  if (!fs.existsSync(wav)) return
  try {
    if (process.platform === 'darwin') {
      const child = spawn('afplay', [wav], { detached: true, stdio: 'ignore' })
      child.unref()
    }
  } catch {
    // non-fatal
  }
}

export function getApiKey(name = 'TYPESAFE_API_KEY') {
  if (process.env[name]) return process.env[name]
  try {
    const secretsPath = path.join(os.homedir(), '.config', 'zsh', 'secrets')
    if (fs.existsSync(secretsPath)) {
      const content = fs.readFileSync(secretsPath, 'utf8')
      const re = new RegExp(`export\\s+${name}=["']?([^"'\\s]+)["']?`)
      const m = re.exec(content)
      if (m?.[1]) return m[1]
    }
  } catch {
    // ignore
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. Trap Guard (game-trap-guard)
// ---------------------------------------------------------------------------

const LITERALS = [
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'OpenAI API key', pattern: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { kind: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: 'Stripe live key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
  { kind: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { kind: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
]

const READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'strings', 'xxd', 'od',
  'base64', 'grep', 'egrep', 'rg', 'ag', 'awk', 'sed', 'jq', 'type', 'Get-Content',
])

const SECRET_VAR = /\$\{?[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]*\}?/i

export function normalizeTool(toolName, toolInput = {}) {
  const name = String(toolName || '')
  if (['run_shell_command', 'run_command', 'Bash', 'bash'].includes(name)) {
    return {
      kind: 'Bash',
      command: String(toolInput.command ?? toolInput.CommandLine ?? ''),
    }
  }
  if (['read_file', 'view_file', 'Read', 'NotebookRead'].includes(name)) {
    return {
      kind: 'Read',
      path: String(toolInput.file_path ?? toolInput.path ?? toolInput.AbsolutePath ?? ''),
    }
  }
  if (['grep_search', 'Grep'].includes(name)) {
    return {
      kind: 'Grep',
      path: String(toolInput.path ?? toolInput.SearchPath ?? ''),
    }
  }
  if (['write_file', 'replace', 'write_to_file', 'replace_file_content', 'Write', 'Edit', 'MultiEdit'].includes(name)) {
    return {
      kind: 'Write',
      path: String(toolInput.file_path ?? toolInput.path ?? toolInput.TargetFile ?? ''),
      content: [
        toolInput.content,
        toolInput.new_string,
        toolInput.CodeContent,
        toolInput.ReplacementContent,
      ]
        .filter(x => typeof x === 'string')
        .join('\n'),
    }
  }
  if (['web_fetch', 'read_url_content', 'WebFetch'].includes(name)) {
    return {
      kind: 'WebFetch',
      url: String(toolInput.url ?? toolInput.Url ?? ''),
    }
  }
  return { kind: name, raw: toolInput }
}

function mask(value) {
  return `${value.slice(0, 6)}…, ${value.length}자`
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop() || String(p)
}

function article(kind) {
  return (/^[AEIOU]/i.test(kind) ? 'an ' : 'a ') + kind
}

export function secretFile(p) {
  const clean = String(p).replace(/\\/g, '/')
  const base = baseName(clean)
  if (/^\.env(?:\..+)?$/.test(base) && !/\.(?:example|sample|template|dist|defaults?|schema)$/i.test(base)) return '.env file'
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(base)) return 'SSH private key'
  if (/\.(?:pem|p12|pfx)$/i.test(base)) return 'key file'
  if (/(?:^|\/)\.aws\/credentials$/.test(clean)) return 'AWS credentials file'
  if (/(?:^|\/)\.(?:netrc|pypirc)$/.test(clean)) return 'credentials file'
  if (/(?:^|\/)\.docker\/config\.json$/.test(clean)) return 'Docker credentials file'
  return undefined
}

function literalIn(text) {
  for (const rule of LITERALS) {
    const m = rule.pattern.exec(text)
    if (m) return { kind: rule.kind, value: m[0] }
  }
  return undefined
}

function exposureIn(command) {
  const whole = command.trim()
  if (/^(?:printenv|env|export\s+-p|set)$/.test(whole)) {
    return { why: 'prints every environment variable, secrets included' }
  }
  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean)
    const [head, ...rest] = words[0] === 'sudo' ? words.slice(1) : words
    if (!head) continue
    if ((head === 'echo' || head === 'printf') && SECRET_VAR.test(segment)) {
      return { why: 'prints a secret variable into the conversation' }
    }
    if (head === 'printenv' && rest.some(w => /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(w))) {
      return { why: 'prints a secret variable into the conversation' }
    }
    if (READERS.has(head)) {
      if (head === 'sed' && rest.some(w => /^-[a-zA-Z]*i/.test(w) || w === '--in-place')) continue
      for (const word of rest) {
        if (word.startsWith('-')) continue
        const kind = secretFile(word.replace(/^['"]|['"]$/g, ''))
        if (kind) return { why: `prints a ${kind} into the conversation (${baseName(word)})` }
      }
    }
  }
  return undefined
}

export function inspectTrapGuard(toolName, toolInput) {
  const norm = normalizeTool(toolName, toolInput)
  switch (norm.kind) {
    case 'Bash': {
      const lit = literalIn(norm.command)
      if (lit) return { guard: 'trap-guard', badge: 'TRAP!', why: `writes ${article(lit.kind)} into a command (${mask(lit.value)})` }
      const exp = exposureIn(norm.command)
      return exp ? { guard: 'trap-guard', badge: 'TRAP!', why: exp.why } : undefined
    }
    case 'Read':
    case 'Grep': {
      const kind = secretFile(norm.path)
      return kind
        ? { guard: 'trap-guard', badge: 'TRAP!', why: `reads a ${kind} into the conversation (${baseName(norm.path)})` }
        : undefined
    }
    case 'Write': {
      if (secretFile(norm.path) === '.env file') return undefined
      const lit = literalIn(norm.content)
      return lit
        ? { guard: 'trap-guard', badge: 'TRAP!', why: `writes ${article(lit.kind)} into ${baseName(norm.path)} (${mask(lit.value)})` }
        : undefined
    }
    case 'WebFetch': {
      const lit = literalIn(norm.url)
      return lit
        ? { guard: 'trap-guard', badge: 'TRAP!', why: `puts ${article(lit.kind)} in a URL (${mask(lit.value)})` }
        : undefined
    }
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// 3. Barrier (game-barrier)
// ---------------------------------------------------------------------------

const PROTECTED_BRANCH = /^(?:main|master|prod|production|release|trunk)$/

const WHOLE_BARRIERS = [
  { pattern: /(?:^|[\s;&|(])(?:npm|pnpm|yarn)\s+publish\b/, why: 'publishes a package (npm publish), which cannot be taken back', unless: /--dry-run\b/ },
  { pattern: /\bcargo\s+publish\b/, why: 'publishes a crate (cargo publish), which cannot be taken back', unless: /--dry-run\b/ },
  { pattern: /\btwine\s+upload\b/, why: 'uploads a release to PyPI (twine upload), which cannot be taken back' },
  { pattern: /\bgh\s+release\s+create\b/, why: 'creates a public release (gh release create)' },
  { pattern: /\bdocker\s+push\b/, why: 'pushes an image to a registry (docker push)' },
  { pattern: /\bterraform\s+destroy\b|\bterraform\s+apply\b[^\n]*\s-destroy\b/, why: 'destroys infrastructure (terraform destroy)' },
  { pattern: /\bkubectl\s+delete\b/, why: 'deletes cluster resources (kubectl delete)' },
  { pattern: /\b(?:psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|supabase\s+db|prisma\s+db\s+execute)\b[^\n]*\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i, why: 'drops data through a database client (DROP/TRUNCATE)' },
  { pattern: /\bmkfs(?:\.\w+)?\b|\bdd\b[^\n]*\bof=\/dev\//, why: 'overwrites a disk (mkfs / dd of=/dev/…)' },
]

export function getGitBranch(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function inspectBarrier(toolName, toolInput, cwd = process.cwd()) {
  const norm = normalizeTool(toolName, toolInput)
  if (norm.kind !== 'Bash') return undefined
  const command = norm.command

  for (const rule of WHOLE_BARRIERS) {
    if (rule.pattern.test(command) && !(rule.unless?.test(command) ?? false)) {
      return { guard: 'barrier', badge: 'BARRIER!', why: rule.why }
    }
  }

  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    const words = (segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(t => t.replace(/^(['"])(.*)\1$/, '$2'))
    while (words[0] && (words[0] === 'sudo' || words[0] === 'command' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) {
      words.shift()
    }
    const [head, ...rest] = words
    if (head === 'git') {
      let i = 0
      while (i < rest.length && rest[i].startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1
      const sub = rest[i]
      const args = rest.slice(i + 1)
      const flags = args.filter(w => w.startsWith('-'))
      const plain = args.filter(w => !w.startsWith('-'))

      if (sub === 'reset' && flags.includes('--hard')) {
        return { guard: 'barrier', badge: 'BARRIER!', why: 'discards uncommitted changes (git reset --hard)' }
      }
      if (sub === 'clean' && flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f))) {
        return { guard: 'barrier', badge: 'BARRIER!', why: 'deletes untracked files (git clean -f)' }
      }
      if (sub === 'checkout' && plain.includes('.')) {
        return { guard: 'barrier', badge: 'BARRIER!', why: 'discards changes in the whole working tree (git checkout .)' }
      }
      if (sub === 'branch' && (flags.includes('-D') || (flags.includes('--delete') && flags.includes('--force')))) {
        return { guard: 'barrier', badge: 'BARRIER!', why: 'force-deletes a branch that may not be merged (git branch -D)' }
      }
      if (sub === 'push') {
        const isForce = flags.some(f => f === '--force' || f.startsWith('--force-with-lease') || /^-[a-zA-Z]*f/.test(f)) || plain.some(w => w.startsWith('+'))
        const isDelete = flags.includes('--delete') || flags.includes('-d')
        if (isForce || isDelete) {
          const branch = getGitBranch(cwd) || 'main'
          const targets = plain.slice(1).map(r => r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''))
          const hit = targets.find(t => PROTECTED_BRANCH.test(t)) || (targets.length === 0 && PROTECTED_BRANCH.test(branch) ? branch : null)
          if (hit) {
            return { guard: 'barrier', badge: 'BARRIER!', why: `${isDelete ? 'deletes' : 'force-pushes over'} the protected branch ${hit} (git push)` }
          }
        }
      }
    }
    if (head === 'rm' && rest.some(w => /^-[a-zA-Z]*[rR]/.test(w) || w === '--recursive')) {
      for (const raw of rest.filter(w => !w.startsWith('-'))) {
        const target = raw.replace(/^['"]|['"]$/g, '')
        if (/^(?:\/|\/\*|~|~\/|~\/\*|\$HOME|\$\{HOME\}|\.|\.\/|\.\/\*|\*|\.\.|\.\.\/)$/.test(target)) {
          return { guard: 'barrier', badge: 'BARRIER!', why: `deletes everything under ${target} (rm -r)` }
        }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 4. Loop Breaker (game-loop-breaker)
// ---------------------------------------------------------------------------

export function loopKeyOf(toolName, toolInput) {
  const norm = normalizeTool(toolName, toolInput)
  if (norm.kind === 'Bash') {
    const cmd = norm.command.replace(/\s+/g, ' ').trim()
    if (!cmd) return undefined
    return { id: `Bash:${cmd}`, label: cmd.length > 48 ? cmd.slice(0, 47) + '…' : cmd, kind: 'command' }
  }
  if (norm.kind === 'Write' && norm.path) {
    return { id: `Write:${norm.path}`, label: `WRITE ${baseName(norm.path)}`, kind: 'file' }
  }
  return undefined
}

export function signatureOf(text) {
  return String(text || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z?\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min)\b/g, '<dur>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/(?:\/private)?\/(?:tmp|var\/folders)\/\S+/g, '<tmp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

// ---------------------------------------------------------------------------
// 5. Spell Check & Hedge Mark (game-spell-check, game-hedge-mark)
// ---------------------------------------------------------------------------

const VAGUE_WORDS = [
  '적당히', '알아서', '대충', '깔끔하게', '대강', '적절히', '예쁘게', '그럴듯하게',
  '웬만하면', '잘 좀', '좋게 좀', 'properly', 'nicely', 'somehow', 'appropriately',
  'as needed', 'clean it up', 'make it better',
]
const VAGUE_RE = new RegExp(VAGUE_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
const DONE_LINE = /(?:^|[.!?]\s*|\n\s*)(?:완료\s*조건|끝\s*조건|done\s*when|definition\s+of\s+done|acceptance)\s*[:：]\s*(.+)$/im
const DONE_SENTENCE = /[^.!?\n]*(?:통과하면|되면\s*끝|하면\s*끝|까지만|나오면\s*끝|done when|until [^.!?\n]+ pass(?:es)?)[^.!?\n]*/i

export function inspectPromptSpellCheck(promptText) {
  const text = String(promptText || '')
  const lit = literalIn(text)
  if (lit) {
    return { secret: lit, vague: [], hasDoneCondition: false }
  }
  const vague = [...new Set([...text.matchAll(VAGUE_RE)].map(m => m[0]))]
  const hasDoneCondition = DONE_LINE.test(text) || DONE_SENTENCE.test(text)
  return { secret: null, vague, hasDoneCondition }
}

const HEDGE_KO = /아마(?:도)?|추정|추측|짐작|(?:라고|으로|로|고)\s?(?:본다|봅니다|봐요)|것\s?같(?:습니다|다|아요|네요|은데)|듯(?:합니다|하다|해요|싶)|수도\s?있|일\s?수\s?(?:도\s?)?있|가능성(?:이|도)\s?(?:있|높|크)|확실하지\s?않|확실치\s?않/
const HEDGE_EN = /\b(?:probably|likely|perhaps|maybe|might|presumably|seems?|appears? to|i think|i believe|i guess|i suspect|not sure|could be)\b/i

export function countHedges(markdown) {
  let count = 0
  let inCode = false
  for (const line of String(markdown || '').split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode || !line.trim()) continue
    const clean = line.replace(/`[^`]*`/g, '')
    for (const s of clean.split(/(?<=[.!?。])\s+/)) {
      if (HEDGE_KO.test(s) || HEDGE_EN.test(s)) count++
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// 6. Status Summary & Jev Choice Engine (game-choice)
// ---------------------------------------------------------------------------

const SUMMARY_TAG = '[상태 요약]'
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'

function stripBullet(line) {
  return line.replace(/^\s*[-*]\s+/, '').trim()
}

function section(block, n) {
  const lines = block.split(/\r?\n/).filter(l => !/^\s*```/.test(l))
  const start = lines.findIndex(l => new RegExp(`^\\s*${n}\\.\\s`).test(l))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^\s*\d\.\s/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

function bullets(lines) {
  const out = []
  for (const raw of lines) {
    if (!raw.trim()) continue
    const isBullet = /^\s*[-*]\s+/.test(raw)
    const text = stripBullet(raw)
    if (isBullet || out.length === 0) out.push(text)
    else out[out.length - 1] = `${out[out.length - 1]} ${text}`
  }
  return out.filter(t => t && t !== '(해당 없음)')
}

export function parseStatusSummary(answer) {
  const text = String(answer || '')
  const at = text.lastIndexOf(SUMMARY_TAG)
  if (at < 0) return null
  const block = text.slice(at + SUMMARY_TAG.length)

  const afterLine1 = (n) => {
    const lines = block.split(/\r?\n/).filter(l => !/^\s*```/.test(l))
    const idx = lines.findIndex(l => new RegExp(`^\\s*${n}\\.\\s`).test(l))
    if (idx < 0) return []
    const inline = lines[idx].replace(new RegExp(`^\\s*${n}\\.\\s*[^:：]*[:：]\\s*`), '').trim()
    const sub = section(block, n)
    return inline ? [inline, ...sub] : sub
  }

  const resume = afterLine1(4).map(stripBullet).filter(Boolean).join(' ').trim()
  if (!resume || resume === '(해당 없음)') return null

  const decisions = []
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
    done: bullets(afterLine1(1)),
    todo: bullets(afterLine1(2)),
    files: bullets(afterLine1(5)),
  }
}

export async function rankWithJev(summary) {
  const key = getApiKey('TYPESAFE_API_KEY')
  if (!key || !summary || summary.decisions.length === 0) {
    return { summary, ranked: false, note: key ? '결정 항목 없음' : 'TYPESAFE_API_KEY 없음' }
  }
  const questions = {}
  summary.decisions.forEach((d, i) => {
    const criteria = {}
    d.options.forEach((o, j) => {
      criteria[String.fromCharCode(65 + j)] = `${o.label} — ${o.append}`
    })
    questions[`d${i}`] = {
      type: 'choice',
      instructions: `Which option is the better next step for this work? ${d.question}`,
      criteria,
    }
  })
  const stateText = [
    `Work to resume: ${summary.resume}`,
    summary.done.length ? `Done so far:\n${summary.done.map(x => `- ${x}`).join('\n')}` : '',
    summary.todo.length ? `Still to do:\n${summary.todo.map(x => `- ${x}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: stateText, questions }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { summary, ranked: false, note: `HTTP ${res.status}` }
    const body = await res.json()
    if (!body?.answers) return { summary, ranked: false, note: '응답 형식 불일치' }

    const updated = {
      ...summary,
      decisions: summary.decisions.map((d, i) => {
        const a = body.answers[`d${i}`]
        if (!a || !a.probabilities) return d
        return {
          ...d,
          confidence: typeof a.confidence === 'number' ? a.confidence : null,
          options: d.options.map((o, j) => ({
            ...o,
            p: typeof a.probabilities[String.fromCharCode(65 + j)] === 'number'
              ? a.probabilities[String.fromCharCode(65 + j)]
              : null,
          })),
        }
      }),
    }
    return { summary: updated, ranked: true, note: 'Jev 순위 반영됨' }
  } catch (err) {
    return { summary, ranked: false, note: err instanceof Error ? err.message.slice(0, 80) : 'network error' }
  }
}

// ---------------------------------------------------------------------------
// 7. 8-Bit ANSI HUD Renderer (game-hud)
// ---------------------------------------------------------------------------

export function bar(percent, cells = 5) {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(full) + '░'.repeat(cells - full)
}

export function estimateContextHp(transcriptPath) {
  try {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const bytes = fs.statSync(transcriptPath).size
      // Estimate remaining context out of ~2MB transcript budget
      const usedPct = Math.min(95, Math.round((bytes / (2 * 1024 * 1024)) * 100))
      return Math.max(5, 100 - usedPct)
    }
  } catch {
    // ignore
  }
  return 96
}

export function formatHudBox(state, { cwd = process.cwd(), transcriptPath = null, extraLines = [] } = {}) {
  const hp = estimateContextHp(transcriptPath)
  const expPct = (state.exp % 10) * 10
  const branch = getGitBranch(cwd) || 'detached'
  const isProtected = PROTECTED_BRANCH.test(branch)
  const branchBadge = isProtected ? `${branch} ⚠보호` : branch
  const hpAlert = hp <= 25 ? ' 🚨HP LOW!(/compact)' : ''
  const passActive = state.passUntil > Date.now() ? ' · 🔓PASS ON' : ''

  const line1 = `🎮 LV ${String(state.level).padStart(2, '0')}  EXP ${bar(expPct, 3)}  HP ${bar(hp, 4)} ${hp}%${hpAlert}  COMBO ×${state.combo} (MAX ×${state.maxCombo})`
  const line2 = `🗺️ MAP ${branchBadge}  ·  🛡️ GUARD ${state.guardMode.toUpperCase()}${passActive}  ·  🔊 SFX ${state.earcons ? 'ON' : 'OFF'}`

  const all = [line1, line2, ...extraLines]
  return [
    '╭─ GAME MODE · 8-BIT HUD ──────────────────────────────────────────────╮',
    ...all.map(l => `│ ${l}`),
    '╰──────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 8. Quest Log Engine (game-quest)
// ---------------------------------------------------------------------------

export function todosOfQuests(todos) {
  if (!Array.isArray(todos)) return []
  return todos.flatMap((t, i) => {
    if (t === null || typeof t !== 'object') return []
    const text = typeof t.content === 'string' ? t.content : typeof t.description === 'string' ? t.description : typeof t.text === 'string' ? t.text : ''
    if (!text) return []
    const status =
      t.status === 'completed' || t.status === 'done'
        ? 'completed'
        : t.status === 'in_progress' || t.status === 'active'
          ? 'in_progress'
          : 'pending'
    const doing = typeof t.activeForm === 'string' ? t.activeForm : typeof t.doing === 'string' ? t.doing : ''
    return [{ id: t.id ? String(t.id) : `todo-${i}`, text, doing, status }]
  })
}

export function syncQuestsFromSummary(state, summary) {
  if (!summary) return false
  const doneList = Array.isArray(summary.done) ? summary.done.filter(Boolean) : []
  const todoList = Array.isArray(summary.todo) ? summary.todo.filter(Boolean) : []
  if (doneList.length === 0 && todoList.length === 0) return false

  const quests = [
    ...doneList.map((text, i) => ({
      id: `done-${i + 1}`,
      text: String(text).trim(),
      doing: '',
      status: 'completed',
    })),
    ...todoList.map((text, i) => ({
      id: `todo-${i + 1}`,
      text: String(text).trim(),
      doing: '',
      status: i === 0 ? 'in_progress' : 'pending',
    })),
  ]
  state.quests = quests
  state.questsCarried = false
  return true
}

export function syncQuestsFromTool(state, toolName, toolInput = {}) {
  const name = String(toolName || '')
  if (['TodoWrite', 'write_todos'].includes(name) && Array.isArray(toolInput.todos)) {
    state.quests = todosOfQuests(toolInput.todos)
    state.questsCarried = false
    return true
  }
  if (name === 'TaskCreate' && typeof toolInput.subject === 'string') {
    const existing = Array.isArray(state.quests) ? state.quests : []
    const hasActive = existing.some(q => q.status === 'in_progress')
    state.quests = [
      ...existing,
      {
        id: `task-${existing.length + 1}`,
        text: toolInput.subject,
        doing: typeof toolInput.activeForm === 'string' ? toolInput.activeForm : '',
        status: hasActive ? 'pending' : 'in_progress',
      },
    ]
    state.questsCarried = false
    return true
  }
  return false
}

export function mutateQuests(state, action = '', argText = '') {
  const quests = Array.isArray(state.quests) ? [...state.quests] : []
  const act = String(action || '').toLowerCase()

  if (act === 'clear') {
    state.quests = []
    state.questsCarried = false
    return { message: 'quest log cleared', quests: state.quests }
  }

  if (act === 'add' && argText.trim()) {
    const hasActive = quests.some(q => q.status === 'in_progress')
    quests.push({
      id: `q-${Date.now()}-${quests.length + 1}`,
      text: argText.trim(),
      doing: '',
      status: hasActive ? 'pending' : 'in_progress',
    })
    state.quests = quests
    state.questsCarried = false
    return { message: `quest added: ${argText.trim()}`, quests: state.quests }
  }

  if (act === 'done') {
    const idxNum = Number.parseInt(argText.trim(), 10)
    let targetIdx = -1
    if (Number.isInteger(idxNum) && idxNum >= 1 && idxNum <= quests.length) {
      targetIdx = idxNum - 1
    } else {
      targetIdx = quests.findIndex(q => q.status === 'in_progress')
      if (targetIdx < 0) targetIdx = quests.findIndex(q => q.status === 'pending')
    }

    if (targetIdx >= 0) {
      quests[targetIdx] = { ...quests[targetIdx], status: 'completed' }
      if (!quests.some(q => q.status === 'in_progress')) {
        const nextPending = quests.findIndex(q => q.status === 'pending')
        if (nextPending >= 0) {
          quests[nextPending] = { ...quests[nextPending], status: 'in_progress' }
        }
      }
      state.quests = quests
      state.questsCarried = false
      return { message: `quest completed: ${quests[targetIdx].text}`, quests: state.quests }
    }
  }

  return { message: null, quests }
}

export function formatQuestLines(state) {
  const quests = Array.isArray(state?.quests) ? state.quests : []
  const total = quests.length
  const done = quests.filter(q => q.status === 'completed').length

  if (total === 0) {
    return [
      'QUEST LOG · 퀘스트 없음',
      '할 일 목록이나 [상태 요약]이 생성되면 여기 퀘스트로 나타납니다.',
    ]
  }

  const pct = Math.round((done / total) * 100)
  const carried = state?.questsCarried ? ' · 지난 세션에서 이어짐' : ''
  const header = `QUEST LOG · ${done}/${total} 클리어 ${bar(pct, 8)}${carried}`

  const rows = quests.map((q, i) => {
    const isBoss = i === total - 1 && total > 1
    const mark = q.status === 'completed' ? '✓' : q.status === 'in_progress' ? '▶' : '·'
    const doing = q.status === 'in_progress' && q.doing ? ` · ${q.doing}` : ''
    const bossTag = isBoss ? '  BOSS' : ''
    return `${mark} ${q.text}${doing}${bossTag}`
  })

  if (done === total) {
    rows.push('★ ALL CLEAR! ★')
  }
  return [header, ...rows]
}

export function formatQuestBox(state) {
  const lines = formatQuestLines(state)
  return [
    '╭─ GAME MODE · QUEST LOG (/quest) ─────────────────────────────────────╮',
    ...lines.map(l => `│ ${l}`),
    '╰──────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 9. Minimap Engine (game-minimap)
// ---------------------------------------------------------------------------

const MAX_MINIMAP_FILES = 800

export function relativeMinimapPath(rawPath, root = process.cwd()) {
  if (!rawPath || typeof rawPath !== 'string') return undefined
  const p = rawPath.replace(/\\/g, '/').trim()
  if (!p) return undefined
  const r = String(root || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
  if (!/^(?:[A-Za-z]:)?\//.test(p)) {
    const rel = p.replace(/^\.\//, '')
    return rel && rel !== '.' && !rel.startsWith('..') ? rel : undefined
  }
  const isWin = /^[A-Za-z]:\//.test(r)
  const inside = isWin ? p.toLowerCase().startsWith(r.toLowerCase() + '/') : p.startsWith(r + '/')
  return inside ? p.slice(r.length + 1) : undefined
}

export function recordMinimapVisit(state, toolName, toolInput = {}, cwd = process.cwd()) {
  const norm = normalizeTool(toolName, toolInput)
  if (norm.kind !== 'Read' && norm.kind !== 'Grep' && norm.kind !== 'Write') return false
  const rel = relativeMinimapPath(norm.path, cwd)
  if (!rel) return false

  state.minimapVisits = state.minimapVisits || {}
  const was = state.minimapVisits[rel] || { reads: 0, isEdited: false }
  state.minimapVisits[rel] =
    norm.kind === 'Write'
      ? { ...was, isEdited: true }
      : { ...was, reads: (was.reads || 0) + 1 }
  return true
}

export function surveyProjectFiles(cwd = process.cwd(), maxFiles = MAX_MINIMAP_FILES) {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 },
    )
    return out
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, maxFiles)
  } catch {
    return []
  }
}

export function summaryOfMinimap(list = [], visits = {}) {
  const paths = [...new Set([...list, ...Object.keys(visits || {})])].filter(Boolean).sort()
  let edited = 0
  let read = 0
  for (const p of paths) {
    const x = visits?.[p]
    if (x?.isEdited) edited++
    else if ((x?.reads ?? 0) > 0) read++
  }
  const top = Object.entries(visits || {})
    .filter(([, x]) => (x?.reads ?? 0) >= 2)
    .sort((a, b) => b[1].reads - a[1].reads || a[0].localeCompare(b[0]))
    .map(([filePath, x]) => ({ path: filePath, reads: x.reads }))
  return {
    paths,
    total: paths.length,
    edited,
    read,
    unexplored: paths.length - edited - read,
    top,
  }
}

export function groupsOfMinimap(paths = []) {
  const groups = new Map()
  for (const p of paths) {
    const slash = p.indexOf('/')
    const folder = slash === -1 ? '(root)' : p.slice(0, slash + 1)
    groups.set(folder, [...(groups.get(folder) ?? []), p])
  }
  return [...groups].sort((a, b) =>
    a[0] === '(root)' ? 1 : b[0] === '(root)' ? -1 : a[0].localeCompare(b[0]),
  )
}

export function cellOfMinimap(visit) {
  const kind = visit?.isEdited ? 'edited' : (visit?.reads ?? 0) > 0 ? 'read' : 'none'
  const reads = visit?.reads ?? 0
  if (reads >= 3) return { glyph: reads >= 10 ? '+' : String(reads), kind }
  return { glyph: kind === 'edited' ? '█' : kind === 'read' ? '▓' : '░', kind }
}

export function formatMinimapLines(state, { cwd = process.cwd(), fileList = null, cellsPerRow = 28 } = {}) {
  const list = Array.isArray(fileList) ? fileList : surveyProjectFiles(cwd)
  const visits = state?.minimapVisits || {}
  const s = summaryOfMinimap(list, visits)
  const labelWidth = 18
  const lines = [
    `MINIMAP · 파일 ${s.total} · 편집 ${s.edited} · 읽음 ${s.read} · 미탐색 ${s.unexplored}`,
  ]

  for (const [folder, paths] of groupsOfMinimap(s.paths)) {
    for (let at = 0; at < paths.length; at += cellsPerRow) {
      const label = (at === 0 ? folder.slice(0, labelWidth - 1) : '').padEnd(labelWidth)
      const cells = paths
        .slice(at, at + cellsPerRow)
        .map(p => cellOfMinimap(visits[p]).glyph)
        .join('')
      lines.push(`${label}${cells}`)
    }
  }

  lines.push('█ 편집  ▓ 읽음  ░ 미탐색  3 = 세 번 읽음')
  if (s.top.length > 0) {
    lines.push(`가장 많이 다시 읽은 파일: ${s.top[0].path} (${s.top[0].reads}회)`)
  }
  return lines
}

export function formatMinimapBox(state, options = {}) {
  const lines = formatMinimapLines(state, options)
  return [
    '╭─ GAME MODE · MINIMAP (/minimap) ─────────────────────────────────────╮',
    ...lines.map(l => `│ ${l}`),
    '╰──────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

export function loadChoice() {
  try {
    if (fs.existsSync(CHOICE_FILE)) return JSON.parse(fs.readFileSync(CHOICE_FILE, 'utf8'))
  } catch {
    // ignore
  }
  return null
}

export function saveChoice(data) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(CHOICE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch {
    // ignore
  }
}

export function bestOptionIndex(decision) {
  if (!Array.isArray(decision?.options) || decision.options.length === 0) return 0
  let bestIdx = 0
  let bestP = -1
  decision.options.forEach((o, idx) => {
    if (typeof o?.p === 'number' && o.p > bestP) {
      bestP = o.p
      bestIdx = idx
    }
  })
  return bestIdx
}

export function composeChoicePrompt(summary, selectedMap = {}) {
  if (!summary?.resume) return { text: '', selected: {} }
  const selected = {}
  const pickedSentences = []
  const decisions = Array.isArray(summary.decisions) ? summary.decisions : []

  decisions.forEach((d, idx) => {
    const rawPick = selectedMap?.[idx] ?? selectedMap?.[String(idx)]
    const fallbackIdx = bestOptionIndex(d)
    const optIdx =
      Number.isInteger(rawPick) && rawPick >= 0 && rawPick < d.options.length
        ? rawPick
        : fallbackIdx
    selected[idx] = optIdx
    const chosen = d.options[optIdx]
    if (chosen?.append) pickedSentences.push(chosen.append)
  })

  return {
    text: [summary.resume, ...pickedSentences].join(' ').trim(),
    selected,
  }
}

export function formatChoiceLines(choiceData, { autoFill = true } = {}) {
  const summary = choiceData?.summary
  if (!summary?.resume) {
    return [
      'CHOICE CARD · 대기 중 ([상태 요약] 생성 시 다음 프롬프트가 자동완성됩니다)',
    ]
  }

  const { text: composed, selected } = composeChoicePrompt(summary, choiceData?.selected || {})
  const rankTag = choiceData?.ranked ? 'Jev AI 추천순' : '기본 추천순'
  const fillTag = autoFill ? '입력창 자동완성 ON' : '클립보드 모드'
  const lines = [`CHOICE CARD · ${rankTag} · ${fillTag}`]

  if (Array.isArray(summary.decisions) && summary.decisions.length > 0) {
    summary.decisions.forEach((d, idx) => {
      const bestIdx = bestOptionIndex(d)
      const pickedIdx = selected[idx] ?? bestIdx
      const opts = d.options
        .map((o, j) => {
          const code = `${idx + 1}${String.fromCharCode(97 + j)}`
          const check = j === pickedIdx ? '✓' : ''
          const star = j === bestIdx ? '★' : ''
          const pct = typeof o.p === 'number' ? `(${Math.round(o.p * 100)}%)` : ''
          return `[${code}] ${check}${star}${o.label}${pct}`
        })
        .join('  ')
      lines.push(`Q${idx + 1}. ${d.question}`)
      lines.push(`  ▸ ${opts}`)
    })
  }

  const preview = composed.length > 56 ? composed.slice(0, 55) + '…' : composed
  lines.push(`📝 자동완성: ${preview}`)
  lines.push('⌨️ 단축키: F1(1a) · F2(1b) · F3(1c/2a) 즉시교체 | 우측패널 1/2/Enter')
  return lines
}

// ---------------------------------------------------------------------------
// 10. Dual-Screen (tmux Side-Pane) Renderer (/quest + /minimap + Choice + HUD)
// ---------------------------------------------------------------------------

export function formatDualScreenBoard(state, { cwd = process.cwd(), transcriptPath = null, fileList = null, choiceData = undefined } = {}) {
  const hp = estimateContextHp(transcriptPath)
  const expPct = ((state.exp || 0) % 10) * 10
  const branch = getGitBranch(cwd) || 'detached'
  const isProtected = PROTECTED_BRANCH.test(branch)
  const branchBadge = isProtected ? `${branch} ⚠보호` : branch
  const passActive = state.passUntil > Date.now() ? ' · 🔓PASS ON' : ''

  const hudLines = [
    `🎮 LV ${String(state.level || 1).padStart(2, '0')}  EXP ${bar(expPct, 3)}  HP ${bar(hp, 4)} ${hp}%  COMBO ×${state.combo || 0} (MAX ×${state.maxCombo || 0})`,
    `🗺️ MAP ${branchBadge}  ·  🛡️ GUARD ${(state.guardMode || 'block').toUpperCase()}${passActive}  ·  🔊 SFX ${state.earcons ? 'ON' : 'OFF'}`,
  ]
  const questLines = formatQuestLines(state)
  const minimapLines = formatMinimapLines(state, { cwd, fileList })
  const activeChoice = choiceData === undefined ? loadChoice() : choiceData
  const choiceLines = formatChoiceLines(activeChoice, { autoFill: state.autoFill !== false })

  return [
    '╭─ GAME MODE · DUAL SCREEN (TMUX SIDE PANE) ───────────────────────────╮',
    ...hudLines.map(l => `│ ${l}`),
    '├─ 📜 QUEST LOG (/quest) ──────────────────────────────────────────────┤',
    ...questLines.map(l => `│ ${l}`),
    '├─ 🗺️ MINIMAP (/minimap) ──────────────────────────────────────────────┤',
    ...minimapLines.map(l => `│ ${l}`),
    '├─ ◆ CHOICE CARD (프롬프트 자동완성) ──────────────────────────────────┤',
    ...choiceLines.map(l => `│ ${l}`),
    '├──────────────────────────────────────────────────────────────────────┤',
    '│ ▸ Commands: /quest · /minimap · /game:dual [on|off|open] · /game:hud │',
    '╰──────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

export function isTmuxPaneAlive(paneId) {
  if (!paneId) return false
  try {
    const out = execFileSync(TMUX_BIN, ['list-panes', '-a', '-F', '#{pane_id}'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 1500,
    })
    return out.split('\n').map(s => s.trim()).includes(String(paneId).trim())
  } catch {
    return false
  }
}

export function findMainTmuxPane(state) {
  if (process.env.BITGAME_NO_TMUX === '1') return null
  try {
    const out = execFileSync(
      TMUX_BIN,
      ['list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}'],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 1500 },
    )
    const rows = out
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const [session, paneId, cmd, active] = line.split('\t')
        return { session, paneId, cmd, active: active === '1' }
      })
      .filter(r => r.paneId && r.paneId !== state?.tmuxPaneId)

    const bitgamePane = rows.find(r => r.session === 'bitgame' && r.active) || rows.find(r => r.session === 'bitgame')
    if (bitgamePane) return bitgamePane.paneId
    const activePane = rows.find(r => r.active)
    return (activePane || rows[0])?.paneId || null
  } catch {
    return null
  }
}

export function copyToClipboard(text) {
  if (!text || process.env.BITGAME_NO_TMUX === '1') return false
  try {
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 1500 })
      return true
    }
  } catch {
    // ignore
  }
  return false
}

export function fillTmuxMainPrompt(text, state, { delayMs = 0, focusMain = false } = {}) {
  const clean = String(text || '').replace(/\r?\n+/g, ' ').trim()
  if (!clean) return { filled: false, copied: false, paneId: null }
  const copied = copyToClipboard(clean)
  if (process.env.BITGAME_NO_TMUX === '1') {
    return { filled: false, copied, paneId: null }
  }

  if (delayMs > 0) {
    try {
      const cliScript = path.join(__dirname, 'cli.mjs')
      const child = spawn(
        process.execPath,
        ['-e', `setTimeout(() => { require('node:child_process').execFileSync(process.execPath, [${JSON.stringify(cliScript)}, 'fill-now'], { stdio: 'ignore' }) }, ${Number(delayMs) || 450})`],
        { detached: true, stdio: 'ignore' },
      )
      child.unref()
      return { filled: true, copied, paneId: 'delayed' }
    } catch {
      return { filled: false, copied, paneId: null }
    }
  }

  const mainPane = findMainTmuxPane(state)
  if (!mainPane) return { filled: false, copied, paneId: null }
  try {
    execFileSync(TMUX_BIN, ['send-keys', '-t', mainPane, 'C-e', 'C-u'], { stdio: 'ignore', timeout: 1500 })
    execFileSync(TMUX_BIN, ['send-keys', '-t', mainPane, '-l', '--', clean], { stdio: 'ignore', timeout: 1500 })
    if (focusMain) {
      execFileSync(TMUX_BIN, ['select-pane', '-t', mainPane], { stdio: 'ignore', timeout: 1500 })
    }
    return { filled: true, copied, paneId: mainPane }
  } catch {
    return { filled: false, copied, paneId: null }
  }
}

export function bindTmuxChoiceKeys() {
  if (process.env.BITGAME_NO_TMUX === '1') return
  try {
    const cliScript = path.join(__dirname, 'cli.mjs')
    const nodeBin = process.execPath.replace(/"/g, '\\"')
    const scriptEsc = cliScript.replace(/"/g, '\\"')
    const bindings = [
      ['F1', '1a'],
      ['F2', '1b'],
      ['F3', '1c'],
      ['F4', '2b'],
      ['M-1', '1a'],
      ['M-2', '1b'],
      ['M-3', '1c'],
      ['M-4', '2b'],
    ]
    for (const [key, code] of bindings) {
      execFileSync(
        TMUX_BIN,
        ['bind-key', '-n', key, 'run-shell', '-b', `"${nodeBin}" "${scriptEsc}" pick ${code} --fill >/dev/null 2>&1`],
        { stdio: 'ignore', timeout: 1500 },
      )
    }
  } catch {
    // ignore if tmux server is not running
  }
}

export function syncTmuxSidePane(state, { cwd = process.cwd(), transcriptPath = null, fileList = null, forceOpen = false } = {}) {
  const board = formatDualScreenBoard(state, { cwd, transcriptPath, fileList })
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(DUAL_SCREEN_FILE, board + '\n', 'utf8')
  } catch {
    // ignore file write failure
  }

  if (state.dualScreen === false && !forceOpen) {
    return { written: true, opened: false, paneId: state.tmuxPaneId || null, board }
  }

  const paneAlive = state.tmuxPaneId && isTmuxPaneAlive(state.tmuxPaneId)
  const inTmux = Boolean(process.env.TMUX) || paneAlive
  if (process.env.BITGAME_NO_TMUX === '1' || (!inTmux && !forceOpen)) {
    return { written: true, opened: false, paneId: state.tmuxPaneId || null, board }
  }

  try {
    bindTmuxChoiceKeys()
    if (paneAlive) {
      return { written: true, opened: false, paneId: state.tmuxPaneId, board }
    }

    const cliScript = path.join(__dirname, 'cli.mjs')
    const nodeBin = process.execPath.replace(/"/g, '\\"')
    const paneCmd = `"${nodeBin}" "${cliScript.replace(/"/g, '\\"')}" pane-watch`
    const paneId = execFileSync(
      TMUX_BIN,
      ['split-window', '-h', '-d', '-l', '52', '-P', '-F', '#{pane_id}', paneCmd],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 2500 },
    ).trim()

    if (paneId) {
      state.tmuxPaneId = paneId
      saveState(state)
      return { written: true, opened: true, paneId, board }
    }
  } catch {
    // non-fatal if tmux session is unavailable
  }

  return { written: true, opened: false, paneId: null, board }
}


