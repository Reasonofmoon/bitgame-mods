import type { EngineInterface, Register } from 'claude-code'

// GAME MODE · BARRIER (결계)
//
// Stops tool calls that cannot be undone from inside the session:
//   git   force-push or delete a protected branch (main, master, prod…),
//         reset --hard, clean -f, checkout/restore the whole tree,
//         stash drop/clear, branch -D
//   rm    -r on /, ~, the project root, ./*, or anything outside the
//         project and temp folders
//   ship  npm/pnpm/yarn publish, cargo publish, twine upload,
//         gh release create, docker push, gem push
//   infra terraform destroy, kubectl delete, helm uninstall
//   data  DROP TABLE/DATABASE/SCHEMA, TRUNCATE TABLE
//   disk  mkfs, dd of=/dev/…, a fork bomb
//   files Write/Edit outside the project, ~/.claude and temp folders
//         (symbolic links resolved); the project is read again when the
//         working folder changes (cd, a worktree)
// On Windows, paths compare without regard to case or slash direction, and
// Git Bash drives (/c/…) count as C:\….
//
// mode block (default) refuses before the call runs; warn lets it run and
// tells Claude and you. /barrier pass lets the next refused call run once.

type Mode = 'block' | 'warn' | 'off'

type Finding = { why: string }

type Context = {
  cwd: string
  home: string
  win: boolean
  isAllowed: (path: string) => boolean
  branch: () => Promise<string | null>
}

const PROTECTED = /^(?:main|master|prod|production|release|trunk)$/
const PASS_MS = 10 * 60 * 1000

const WHOLE: { pattern: RegExp; why: string; unless?: RegExp }[] = [
  { pattern: /(?:^|[\s;&|(])(?:npm|pnpm|yarn)\s+publish\b/, why: 'publishes a package (npm publish), which cannot be taken back', unless: /--dry-run\b/ },
  { pattern: /\bcargo\s+publish\b/, why: 'publishes a crate (cargo publish), which cannot be taken back', unless: /--dry-run\b/ },
  { pattern: /\btwine\s+upload\b/, why: 'uploads a release to PyPI (twine upload), which cannot be taken back' },
  { pattern: /\bgh\s+release\s+create\b/, why: 'creates a public release (gh release create)' },
  { pattern: /\bdocker\s+push\b/, why: 'pushes an image to a registry (docker push)' },
  { pattern: /\bgem\s+push\b/, why: 'publishes a gem (gem push), which cannot be taken back' },
  { pattern: /\bterraform\s+destroy\b|\bterraform\s+apply\b[^\n]*\s-destroy\b/, why: 'destroys infrastructure (terraform destroy)' },
  { pattern: /\bkubectl\s+delete\b/, why: 'deletes cluster resources (kubectl delete)' },
  { pattern: /\bhelm\s+(?:uninstall|delete)\b/, why: 'uninstalls a release from a cluster (helm uninstall)' },
  {
    // Only through a database client: grep "DROP TABLE" migrations/ is fine.
    pattern: /\b(?:psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|clickhouse(?:-client)?|mongosh?|cockroach\s+sql|supabase\s+db|prisma\s+db\s+execute)\b[^\n]*\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i,
    why: 'drops data through a database client (DROP/TRUNCATE)',
  },
  { pattern: /\bmkfs(?:\.\w+)?\b|\bdd\b[^\n]*\bof=\/dev\//, why: 'overwrites a disk (mkfs / dd of=/dev/…)' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: 'starts a fork bomb' },
]

export const register: Register = (on, options) => {
  let mode: Mode = modeOf(options.mode)
  let passUntil = 0
  let roots: string[] = []
  let projectRoot = ''
  let cwd = ''
  let home = ''
  let win = false

  const apply = (f: Folders) => {
    projectRoot = f.projectRoot
    cwd = f.cwd
    home = f.home
    win = f.win
    roots = f.roots
  }

  on('session.start', async ($, e, next) => {
    apply(await readFolders($, String(options.allow ?? ''), await $.session.cwd()))

    const stored = await $.store.get('mode')
    if (stored === 'block' || stored === 'warn' || stored === 'off') mode = stored
    await $.command.register({
      name: 'barrier',
      description: 'GAME MODE barrier: status, block, warn, off, or pass the next refused call once',
      argumentHint: '[block|warn|off|pass]',
    })
    return next(e)
  })

  // A new working folder (cd, a worktree) may be another project: read the folders again.
  on('classic.CwdChanged', async ($, e, next) => {
    apply(await readFolders($, String(options.allow ?? ''), e.new_cwd || (await $.session.cwd())))
    return next(e)
  }).catch(($, e, next) => next(e))

  const isAllowed = (path: string) =>
    roots.length === 0 || roots.some(root => path === root || path.startsWith(root.endsWith('/') ? root : root + '/'))

  on('tool.call', async ($, e, next) => {
    if (mode === 'off') return next(e)
    const ctx: Context = {
      cwd: cwd || '/',
      home,
      win,
      isAllowed,
      branch: () => currentBranch($, projectRoot),
    }
    const finding = await inspect($, String(e.tool), e as unknown as Record<string, unknown>, ctx, projectRoot)
    if (finding === undefined) return next(e)

    const label = String(e.tool).toUpperCase()
    if (mode === 'block') {
      const now = await $.clock.now()
      if (now < passUntil) {
        passUntil = 0
        $.ui.log(`passed once by /barrier pass — ${label} (${finding.why})`)
        return next(e)
      }
      $.ui.toast(`BARRIER! ${label} 차단 — ${finding.why} · /barrier pass`)
      $.ui.log(`BARRIER! blocked ${label} (${finding.why})`)
      return { deny: denyText(finding) }
    }

    const ran = await next(e)
    $.ui.toast(`BARRIER? ${label} — ${finding.why} (warn mode: ran)`)
    if (ran.deny !== undefined || ran.isError === true) return ran
    return { ...ran, context: [...(ran.context ?? []), `game-barrier (warn mode): this call ${finding.why}. Tell the user what was changed and how to undo it, if it can be.`] }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'game-barrier: the guard failed while checking this call, so it was stopped. Ask the user to check /barrier.' },
  )

  on('command.run', { command: 'barrier' }, async ($, e) => {
    const sub = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const byPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'

    if (sub === 'block' || sub === 'warn' || sub === 'off') {
      if (sub !== 'block' && !byPerson) return { text: 'Only you can loosen the barrier: type the command yourself.' }
      mode = sub
      await $.store.set('mode', mode)
      return { text: `barrier: ${mode}` }
    }
    if (sub === 'pass') {
      if (!byPerson) return { text: 'Only you can pass a refused call: type /barrier pass yourself.' }
      passUntil = (await $.clock.now()) + PASS_MS
      return { text: 'The next call the barrier would refuse runs once (within 10 minutes).' }
    }
    if (sub !== '') return { text: `Unknown option "${sub}". Use block, warn, off or pass.` }
    return {
      text: [
        `barrier: ${mode}`,
        `inside: ${roots.join(', ') || '(set at session start)'}`,
        '/barrier block   refuse irreversible calls (default)',
        '/barrier warn    let them run; tell Claude and show a toast',
        '/barrier off     stop checking',
        '/barrier pass    let the next refused call run once',
      ].join('\n'),
    }
  })
}

type Folders = { projectRoot: string; cwd: string; home: string; win: boolean; roots: string[] }

/** The project root, working folder, home and every folder counted as inside, read now. */
async function readFolders($: EngineInterface, allow: string, rawCwd: string): Promise<Folders> {
  const rawRoot = await $.session.root()
  const win = isWindowsPath(rawRoot) || isWindowsPath(rawCwd) || (await $.env.get('OS')) === 'Windows_NT'
  const projectRoot = normalize(rawRoot, win)
  const cwd = normalize(rawCwd, win)
  let rawHome = (await $.env.get('HOME')) ?? ''
  if (rawHome === '' && win) rawHome = (await $.env.get('USERPROFILE')) ?? ''
  const home = rawHome === '' ? '' : normalize(rawHome, win)
  const temps = [(await $.env.get('TMPDIR')) ?? '']
  if (win) temps.push((await $.env.get('TEMP')) ?? '', (await $.env.get('TMP')) ?? '')
  const listed = [
    projectRoot,
    cwd,
    home ? `${home}/.claude` : '',
    ...temps,
    '/tmp',
    '/private/tmp',
    '/var/folders',
    '/private/var/folders',
    ...allow
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => (p.startsWith('~') ? home + p.slice(1) : p)),
  ]
  let roots = [...new Set(listed.filter(p => p !== '' && isAbsolute(p, win)).map(p => normalize(p, win)))]
  for (const root of [...roots]) {
    const real = await realOf($, root, win)
    if (real && !roots.includes(real)) roots.push(real)
  }
  // Without the project folder among them, every edit would count as outside the project:
  // check nothing rather than refuse everything.
  if (!roots.includes(projectRoot) && !roots.includes(cwd)) {
    roots = []
    $.ui.log('could not read the project folder, so edits outside the project are not checked this session')
  }
  return { projectRoot, cwd, home, win, roots }
}

function modeOf(value: unknown): Mode {
  return value === 'warn' || value === 'off' ? value : 'block'
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

async function inspect($: EngineInterface, tool: string, input: Record<string, unknown>, ctx: Context, projectRoot: string): Promise<Finding | undefined> {
  if (tool === 'Bash') return inspectCommand(str(input, 'command') ?? '', ctx, projectRoot)
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const raw = str(input, 'file_path') ?? str(input, 'notebook_path')
    if (raw === undefined) return undefined
    const path = normalize(isAbsolute(raw, ctx.win) ? raw : `${ctx.cwd}/${raw}`, ctx.win)
    if (!ctx.isAllowed(path)) return { why: `edits a file outside the project (${path})` }
    const real = await realOf($, path, ctx.win)
    if (real !== undefined && !ctx.isAllowed(real)) return { why: `edits a file outside the project through a link (${path} → ${real})` }
  }
  return undefined
}

export async function inspectCommand(command: string, ctx: Context, projectRoot: string): Promise<Finding | undefined> {
  for (const rule of WHOLE) {
    if (rule.pattern.test(command) && !(rule.unless?.test(command) ?? false)) return { why: rule.why }
  }

  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    const words = tokens(segment)
    while (words[0] !== undefined && (words[0] === 'sudo' || words[0] === 'command' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) words.shift()
    const [head, ...rest] = words
    if (head === 'git') {
      const found = await inspectGit(rest, ctx)
      if (found) return found
    }
    if (head === 'rm' && rest.some(w => /^-[a-zA-Z]*[rR]/.test(w) || w === '--recursive')) {
      for (const target of rest.filter(w => !w.startsWith('-'))) {
        const found = inspectRemoval(target, ctx, projectRoot)
        if (found) return found
      }
    }
    if ((head === 'chmod' || head === 'chown') && rest.some(w => /^-[a-zA-Z]*R/.test(w))) {
      if (rest.some(w => w === '/' || w === '~' || w === '~/' || w === '$HOME')) return { why: `changes ${head === 'chmod' ? 'permissions' : 'owners'} of everything under / or ~` }
    }
  }
  return undefined
}

async function inspectGit(args: string[], ctx: Context): Promise<Finding | undefined> {
  // Skip git's own options (-C dir, -c key=value, --no-pager) to the subcommand.
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  const rest = args.slice(i + 1)
  const flags = rest.filter(w => w.startsWith('-'))
  const plain = rest.filter(w => !w.startsWith('-'))

  switch (sub) {
    case 'push': {
      const isForce =
        flags.some(f => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(f)) ||
        plain.some(w => w.startsWith('+'))
      const isDelete = flags.includes('--delete') || flags.includes('-d') || plain.slice(1).some(w => w.startsWith(':'))
      if (!isForce && !isDelete) return undefined
      const verb = isDelete ? 'deletes' : 'force-pushes over'
      const named = plain.slice(1).map(ref => (ref.replace(/^\+/, '').split(':').pop() ?? '').replace(/^refs\/heads\//, ''))
      // HEAD and @ stand for the current branch.
      const needsBranch = named.some(t => t === 'HEAD' || t === '@')
      const current = needsBranch ? await ctx.branch() : null
      const targets = named.map(t => (t === 'HEAD' || t === '@' ? (current ?? t) : t))
      const hit = targets.find(t => PROTECTED.test(t))
      if (hit) return { why: `${verb} the protected branch ${hit} (git push)` }
      if (needsBranch && current === null) return { why: 'force-pushes HEAD, and the current branch could not be read' }
      if (targets.length === 0 && !isDelete) {
        const branch = await ctx.branch()
        if (branch === null) return { why: 'force-pushes without naming a branch, and the current branch could not be read' }
        if (PROTECTED.test(branch)) return { why: `force-pushes over the protected branch ${branch} (git push -f on ${branch})` }
      }
      return undefined
    }
    case 'reset':
      return flags.includes('--hard') ? { why: 'discards uncommitted changes (git reset --hard)' } : undefined
    case 'clean':
      return flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f)) ? { why: 'deletes untracked files (git clean -f)' } : undefined
    case 'checkout':
      return plain.includes('.') ? { why: 'discards changes in the whole working tree (git checkout .)' } : undefined
    case 'restore':
      return plain.includes('.') && !(flags.includes('--staged') && !flags.includes('--worktree'))
        ? { why: 'discards changes in the whole working tree (git restore .)' }
        : undefined
    case 'stash':
      return plain[0] === 'drop' || plain[0] === 'clear' ? { why: `drops stashed work (git stash ${plain[0]})` } : undefined
    case 'branch':
      return flags.includes('-D') || (flags.includes('--delete') && flags.includes('--force'))
        ? { why: 'force-deletes a branch that may not be merged (git branch -D)' }
        : undefined
    default:
      return undefined
  }
}

function inspectRemoval(raw: string, ctx: Context, projectRoot: string): Finding | undefined {
  const target = raw.replace(/^['"]|['"]$/g, '')
  if (/^(?:\/|\/\*|~|~\/|~\/\*|\$HOME|\$\{HOME\}|\$HOME\/\*?|\.|\.\/|\.\/\*|\*|\.\.|\.\.\/|\.\.\/\*)$/.test(target)) {
    return { why: `deletes everything under ${target} (rm -r)` }
  }
  // Windows: a drive (C:\, /c/), the profile folder, or the current folder spelled with a backslash.
  if (ctx.win && /^(?:[A-Za-z]:[\\/]?\*?|\/(?:cygdrive\/)?[A-Za-z]\/?\*?|~\\\*?|\.\\\*?|\.\.\\\*?|\$\{?USERPROFILE\}?[\\/]?\*?)$/.test(target)) {
    return { why: `deletes everything under ${target} (rm -r)` }
  }
  if (target.includes('$') || target.includes('`')) return undefined
  const expanded = /^~[\\/]/.test(target) ? ctx.home + target.slice(1) : target
  const path = normalize(isAbsolute(expanded, ctx.win) ? expanded : `${ctx.cwd}/${expanded}`, ctx.win)
  if (projectRoot !== '' && path === projectRoot) return { why: `deletes the project root (${path})` }
  if (!ctx.isAllowed(path)) return { why: `deletes outside the project (${path})` }
  return undefined
}

async function currentBranch($: EngineInterface, root: string): Promise<string | null> {
  try {
    const head = String(await $.fs.read(`${root}/.git/HEAD`)).trim()
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** The path with every symbolic link resolved, through its nearest existing ancestor. */
async function realOf($: EngineInterface, path: string, win: boolean): Promise<string | undefined> {
  try {
    let cur = path
    const rest: string[] = []
    for (let step = 0; step < 64 && cur !== ''; step++) {
      if (await $.fs.exists(cur)) {
        const stat = await $.fs.stat(cur, { resolve: true })
        if (stat.realPath === undefined) return undefined
        return normalize([stat.realPath, ...rest].join('/'), win)
      }
      if (isRoot(cur)) return undefined
      const cut = cur.lastIndexOf('/')
      rest.unshift(cur.slice(cut + 1))
      const parent = cut <= 0 ? '/' : cur.slice(0, cut)
      // `c:` alone is the current folder on drive C, not its root.
      cur = /^[a-z]:$/.test(parent) ? `${parent}/` : parent
    }
  } catch {
    // Unreadable: judged by the spelling alone.
  }
  return undefined
}

function isRoot(path: string): boolean {
  return path === '/' || /^[a-z]:\/$/.test(path) || /^\/\/[^/]+\/[^/]+$/.test(path)
}

/** A Windows spelling: a drive (`C:\`, `c:/`) or a network share (`\\server\share`). */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

function isAbsolute(path: string, win: boolean): boolean {
  return path.startsWith('/') || (win && isWindowsPath(path))
}

/**
 * One comparable spelling of a path: `.`, `..` and repeated slashes collapsed. With `win` (a
 * Windows session), backslashes become slashes, a Git Bash drive (`/c/…`) becomes `c:/…`, and
 * the path is lower-cased, as Windows file names ignore case.
 */
export function normalize(path: string, win = false): string {
  let p = path
  let prefix = ''
  if (win) {
    p = p.replace(/\\/g, '/').toLowerCase()
    const bash = /^\/(?:cygdrive\/)?([a-z])(?=\/|$)/.exec(p)
    if (bash) p = `${bash[1]}:${p.slice(bash[0].length)}`
    const drive = /^([a-z]):/.exec(p)
    if (drive) {
      prefix = `${drive[1]}:/`
      p = p.slice(2)
    } else if (p.startsWith('//')) {
      prefix = '//'
      p = p.slice(2)
    }
  }
  const absolute = prefix !== '' || p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  if (prefix !== '') return prefix + out.join('/')
  return (absolute ? '/' : '') + out.join('/') || (absolute ? '/' : '.')
}

function tokens(segment: string): string[] {
  return (segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(t => t.replace(/^(['"])(.*)\1$/, '$2'))
}

function denyText(finding: Finding): string {
  return (
    `game-barrier blocked this call: it ${finding.why}. ` +
    'This cannot be undone from here. Find a reversible way (commit or stash first, work on a branch, stay inside the project), ' +
    'or explain why it is needed and ask the user to run it themselves or to type /barrier pass.'
  )
}
