// Secret shapes copied into this plugin. A hooks module may import only its own files,
// so these are copies, not imports. check.sh compares palette.ts across plugins and does
// not compare these patterns (trap-guard and spell-check are not byte-identical).
// Sources are strings so each scan builds a new RegExp. A shared /g literal keeps lastIndex,
// and a later scan then starts past the previous match.
//
// game-trap-guard LITERALS (hooks/register.ts):
const TRAP_GUARD: readonly string[] = [
  String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}`,
  String.raw`\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}`,
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
  String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})`,
  String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{35}`,
  String.raw`\b(?:sk|rk)_live_[0-9A-Za-z]{20,}`,
  String.raw`-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----`,
  String.raw`\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
]
// game-spell-check SECRETS (hooks/register.tsx). The assignment pattern is case-insensitive.
const SPELL_CHECK: readonly { source: string; flags: string }[] = [
  { source: String.raw`\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}`, flags: 'g' },
  { source: String.raw`\bAKIA[0-9A-Z]{16}\b`, flags: 'g' },
  { source: String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, flags: 'g' },
  { source: String.raw`\bxox[abpr]-[A-Za-z0-9-]{10,}`, flags: 'g' },
  { source: String.raw`\bAIza[0-9A-Za-z_-]{35}\b`, flags: 'g' },
  { source: String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`, flags: 'g' },
  { source: String.raw`\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}`, flags: 'gi' },
]

/** What stands in for a removed value. It matches none of the patterns above. */
export const REDACTED = '[redacted]'

const PATTERNS: readonly { source: string; flags: string }[] = [
  ...TRAP_GUARD.map(source => ({ source, flags: 'g' })),
  ...SPELL_CHECK,
]

type Span = { start: number; end: number }

function spansIn(text: string): Span[] {
  const found: Span[] = []
  for (const pattern of PATTERNS) {
    // A new expression every scan. matchAll on a shared /g literal resumes at lastIndex.
    const re = new RegExp(pattern.source, pattern.flags)
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      found.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []
  for (const s of found) {
    const last = merged.at(-1)
    if (!last || s.start >= last.end) merged.push({ start: s.start, end: s.end })
    else last.end = Math.max(last.end, s.end)
  }
  return merged
}

/**
 * Replaces each secret-shaped value with `REDACTED`. Overlapping matches (the same
 * characters caught by both plugins) count as one value. The returned text never
 * contains the matched characters.
 */
export function redactSecrets(text: string): { text: string; count: number } {
  const spans = spansIn(text)
  if (spans.length === 0) return { text, count: 0 }
  let out = ''
  let cursor = 0
  for (const s of spans) {
    out += text.slice(cursor, s.start) + REDACTED
    cursor = s.end
  }
  return { text: out + text.slice(cursor), count: spans.length }
}
