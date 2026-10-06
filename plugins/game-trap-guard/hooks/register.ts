import type { Register } from 'claude-code'

// GAME MODE · TRAP GUARD
//
// Stops a tool call that would put a secret where it does not belong:
//   - a literal key or token in a command, a URL, or a source file
//     (an .env-type file is the right place for one and is left alone)
//   - a command that prints a secret file or secret variables into the
//     conversation (cat .env, grep KEY .env, echo $API_KEY, a bare printenv)
//   - Read or Grep on a secret file (.env, id_rsa, *.pem, ~/.aws/credentials)
//
// mode block (default): the call is refused before it runs and Claude is
//   told why and what to do instead.
// mode warn: the call runs; Claude gets a note and you get a toast.
// /trap-guard pass lets the next refused call through once (typed by you).

type Mode = 'block' | 'warn' | 'off'

type Finding = { why: string }

const LITERALS: { kind: string; pattern: RegExp }[] = [
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

const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'strings', 'xxd', 'od', 'base64', 'grep', 'egrep', 'rg', 'ag', 'awk', 'sed', 'jq', 'type', 'Get-Content'])

const SECRET_VAR = /\$\{?[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]*\}?/i

const PASS_MS = 10 * 60 * 1000

export const register: Register = (on, options) => {
  let mode: Mode = modeOf(options.mode)
  let passUntil = 0

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('mode')
    if (stored === 'block' || stored === 'warn' || stored === 'off') mode = stored
    await $.command.register({
      name: 'trap-guard',
      description: 'GAME MODE trap guard: status, block, warn, off, or pass the next refused call once',
      argumentHint: '[block|warn|off|pass]',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (mode === 'off') return next(e)
    const finding = inspect(String(e.tool), e as unknown as Record<string, unknown>)
    if (finding === undefined) return next(e)

    const label = String(e.tool).toUpperCase()
    if (mode === 'block') {
      const now = await $.clock.now()
      if (now < passUntil) {
        passUntil = 0
        $.ui.log(`passed once by /trap-guard pass — ${label} (${finding.why})`)
        return next(e)
      }
      $.ui.toast(`TRAP! ${label} 차단 — ${finding.why} · /trap-guard pass`)
      $.ui.log(`TRAP! blocked ${label} (${finding.why})`)
      return { deny: denyText(finding) }
    }

    const ran = await next(e)
    $.ui.toast(`TRAP? ${label} — ${finding.why} (warn mode: ran)`)
    if (ran.deny !== undefined || ran.isError === true) return ran
    return { ...ran, context: [...(ran.context ?? []), warnText(finding)] }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'game-trap-guard: the guard failed while checking this call, so it was stopped. Ask the user to check /trap-guard.' },
  )

  on('command.run', { command: 'trap-guard' }, async ($, e) => {
    const sub = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const byPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'

    if (sub === 'block' || sub === 'warn' || sub === 'off') {
      if (sub !== 'block' && !byPerson) return { text: 'Only you can loosen the trap guard: type the command yourself.' }
      mode = sub
      await $.store.set('mode', mode)
      return { text: `trap guard: ${mode}` }
    }
    if (sub === 'pass') {
      if (!byPerson) return { text: 'Only you can pass a refused call: type /trap-guard pass yourself.' }
      passUntil = (await $.clock.now()) + PASS_MS
      return { text: 'The next call the trap guard would refuse runs once (within 10 minutes).' }
    }
    if (sub !== '') return { text: `Unknown option "${sub}". Use block, warn, off or pass.` }
    return {
      text: [
        `trap guard: ${mode}`,
        '/trap-guard block   refuse calls that leak secrets (default)',
        '/trap-guard warn    let them run; tell Claude and show a toast',
        '/trap-guard off     stop checking',
        '/trap-guard pass    let the next refused call run once',
      ].join('\n'),
    }
  })
}

function modeOf(value: unknown): Mode {
  return value === 'warn' || value === 'off' ? value : 'block'
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

/** What is wrong with this call, or undefined when nothing is. */
export function inspect(tool: string, input: Record<string, unknown>): Finding | undefined {
  switch (tool) {
    case 'Bash': {
      const command = str(input, 'command') ?? ''
      const literal = literalIn(command)
      if (literal) return { why: `writes ${article(literal.kind)} into a command (${mask(literal.value)})` }
      return exposureIn(command)
    }
    case 'Read':
    case 'NotebookRead': {
      const path = str(input, 'file_path') ?? str(input, 'notebook_path') ?? ''
      const kind = secretFile(path)
      return kind ? { why: `reads a ${kind} into the conversation (${baseName(path)})` } : undefined
    }
    case 'Grep': {
      const path = str(input, 'path') ?? ''
      const kind = secretFile(path)
      return kind ? { why: `prints lines of a ${kind} into the conversation (${baseName(path)})` } : undefined
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const path = str(input, 'file_path') ?? str(input, 'notebook_path') ?? ''
      if (secretFile(path) === '.env file') return undefined
      const edits = Array.isArray(input.edits) ? (input.edits as unknown[]) : []
      const text = [
        str(input, 'content'),
        str(input, 'new_string'),
        str(input, 'new_source'),
        ...edits.map(one => (one && typeof one === 'object' ? str(one as Record<string, unknown>, 'new_string') : undefined)),
      ]
        .filter((t): t is string => t !== undefined)
        .join('\n')
      const literal = literalIn(text)
      return literal ? { why: `writes ${article(literal.kind)} into ${baseName(path)} (${mask(literal.value)})` } : undefined
    }
    case 'WebFetch': {
      const literal = literalIn(str(input, 'url') ?? '')
      return literal ? { why: `puts ${article(literal.kind)} in a URL (${mask(literal.value)})` } : undefined
    }
    default:
      return undefined
  }
}

function literalIn(text: string): { kind: string; value: string } | undefined {
  for (const rule of LITERALS) {
    const match = rule.pattern.exec(text)
    if (match) return { kind: rule.kind, value: match[0] }
  }
  return undefined
}

function exposureIn(command: string): Finding | undefined {
  const whole = command.trim()
  if (/^(?:printenv|env|export\s+-p|set)$/.test(whole)) return { why: 'prints every environment variable, secrets included' }

  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    const words = segment.trim().split(/\s+/).filter(w => w.length > 0)
    const [head, ...rest] = words[0] === 'sudo' ? words.slice(1) : words
    if (head === undefined) continue
    if ((head === 'echo' || head === 'printf') && SECRET_VAR.test(segment)) {
      return { why: 'prints a secret variable into the conversation' }
    }
    if (head === 'printenv' && rest.some(w => /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(w))) {
      return { why: 'prints a secret variable into the conversation' }
    }
    if (READERS.has(head)) {
      // `sed -i` edits the file in place and prints nothing.
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

export function secretFile(path: string): string | undefined {
  const clean = path.replace(/\\/g, '/')
  const base = baseName(clean)
  if (/^\.env(?:\..+)?$/.test(base) && !/\.(?:example|sample|template|dist|defaults?|schema)$/i.test(base)) return '.env file'
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(base)) return 'SSH private key'
  if (/\.(?:pem|p12|pfx)$/i.test(base)) return 'key file'
  if (/(?:^|\/)\.aws\/credentials$/.test(clean)) return 'AWS credentials file'
  if (/(?:^|\/)\.(?:netrc|pypirc)$/.test(clean)) return 'credentials file'
  if (/(?:^|\/)\.docker\/config\.json$/.test(clean)) return 'Docker credentials file'
  return undefined
}

function article(kind: string): string {
  return (/^[AEIOU]/i.test(kind) ? 'an ' : 'a ') + kind
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Enough to recognise the value, never the value itself. */
export function mask(value: string): string {
  return `${value.slice(0, 6)}…, ${value.length}자`
}

function denyText(finding: Finding): string {
  return (
    `game-trap-guard blocked this call: it ${finding.why}. ` +
    'Keep secrets out of commands, files and the conversation: read them from an environment variable ' +
    '(for example $ANTHROPIC_API_KEY) or a secret store, refer to them by name, and keep literal values only in an .env file. ' +
    'If this is a false positive, ask the user to type /trap-guard pass and then retry.'
  )
}

function warnText(finding: Finding): string {
  return (
    `game-trap-guard (warn mode): this call ${finding.why}. ` +
    'Do not repeat the secret in your reply, and tell the user it may now be in the transcript.'
  )
}
