import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = { head?: string; links?: Record<string, string> }

function world(on: On, opts: World = {}) {
  mock.store(on)
  mock.clock(on, { now: 1_700_000_000_000 })
  const ran: string[] = []
  const toasts: string[] = []
  const env: Record<string, string> = { HOME: '/home/me', TMPDIR: '/var/folders/xy/T/' }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  // A file system where /proj/new/… does not exist yet and links point where told.
  on('fs.exists', (_, e) => ({ value: !e.path.startsWith('/proj/new') }))
  // `resolve: true` answers the path with every link along it followed.
  const resolve = (path: string) => {
    for (const [from, to] of Object.entries(opts.links ?? {})) {
      if (path === from || path.startsWith(from + '/')) return to + path.slice(from.length)
    }
    return path
  }
  on('fs.stat', (_, e) => ({
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: resolve(e.path) },
  }))
  on('fs.read', (_, e) => {
    if (e.path === '/proj/.git/HEAD' && opts.head !== undefined) return { value: opts.head }
    throw new Error('ENOENT')
  })
  on('tool.call', (_, e) => {
    ran.push(String(e.tool) === 'Bash' ? String((e as { command?: string }).command) : String(e.tool))
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return { ran, toasts }
}

function refusal(r: { deny?: string; isError?: true; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}

async function start($: Engine) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

async function bash($: Engine, command: string) {
  return refusal(await $.tool.call({ tool: 'Bash', command }))
}

function barrier(args: string, byPerson = true) {
  return {
    command: 'barrier',
    args,
    origin: byPerson ? { kind: 'composer' as const } : { kind: 'sdk' as const },
    presentation: { isFullscreen: false, columns: 120 },
  }
}

test('force-pushing over main is refused; feature branches are not', async ($, on) => {
  const { ran } = world(on, { head: 'ref: refs/heads/feature/login\n' })
  await start($)
  expect(await bash($, 'git push --force origin main')).toContain('force-pushes over the protected branch main')
  expect(await bash($, 'git push origin +HEAD:master')).toContain('protected branch master')
  expect(await bash($, 'git push origin --delete main')).toContain('deletes the protected branch main')
  expect(await bash($, 'git push --force-with-lease origin feature/login')).toBeUndefined()
  expect(await bash($, 'git push -f')).toBeUndefined()
  expect(await bash($, 'git push origin main')).toBeUndefined()
  expect(ran).toEqual(['git push --force-with-lease origin feature/login', 'git push -f', 'git push origin main'])
})

test('git push -f on main is refused by reading the current branch', async ($, on) => {
  world(on, { head: 'ref: refs/heads/main\n' })
  await start($)
  expect(await bash($, 'git push -f')).toContain('protected branch main')
  expect(await bash($, 'git push origin HEAD --force')).toContain('protected branch main')
  expect(await bash($, 'git push --force origin @')).toContain('protected branch main')
})

test('HEAD on a feature branch may be force-pushed', async ($, on) => {
  const { ran } = world(on, { head: 'ref: refs/heads/feature/x\n' })
  await start($)
  expect(await bash($, 'git push origin HEAD --force-with-lease')).toBeUndefined()
  expect(ran).toEqual(['git push origin HEAD --force-with-lease'])
})

test('history-destroying git commands are refused', async ($, on) => {
  const { ran } = world(on)
  await start($)
  expect(await bash($, 'git reset --hard origin/main')).toContain('git reset --hard')
  expect(await bash($, 'git clean -fdx')).toContain('git clean -f')
  expect(await bash($, 'git checkout -- .')).toContain('git checkout .')
  expect(await bash($, 'git restore .')).toContain('git restore .')
  expect(await bash($, 'git stash clear')).toContain('git stash clear')
  expect(await bash($, 'git -C /proj branch -D old')).toContain('git branch -D')
  for (const ok of ['git reset --soft HEAD~1', 'git checkout -b feat', 'git restore --staged .', 'git checkout -- src/a.ts', 'git stash pop']) {
    expect(await bash($, ok)).toBeUndefined()
  }
  expect(ran).toHaveLength(5)
})

test('rm -r stays inside the project and temp folders', async ($, on) => {
  const { ran } = world(on)
  await start($)
  for (const bad of ['rm -rf /', 'rm -rf ~/', 'sudo rm -rf /etc/nginx', 'rm -rf ./*', 'rm -r ../other', 'rm -rf /proj', 'rm -rf "$HOME"']) {
    expect(await bash($, bad)).toContain('game-barrier blocked this call')
  }
  for (const ok of ['rm -rf node_modules dist', 'rm -rf /proj/build', 'rm -rf /tmp/cache', 'rm -r /var/folders/xy/T/run-1', 'rm notes.txt', 'rm -rf "$BUILD_DIR"']) {
    expect(await bash($, ok)).toBeUndefined()
  }
  expect(ran).toHaveLength(6)
})

test('publishing, infrastructure and data drops are refused', async ($, on) => {
  world(on)
  await start($)
  expect(await bash($, 'npm publish --access public')).toContain('npm publish')
  expect(await bash($, 'cd pkg && pnpm publish')).toContain('npm publish')
  expect(await bash($, 'terraform destroy -auto-approve')).toContain('terraform destroy')
  expect(await bash($, 'psql "$DATABASE_URL" -c "DROP TABLE users;"')).toContain('drops data')
  expect(await bash($, 'npm publish --dry-run')).toBeUndefined()
  expect(await bash($, 'grep -rn "DROP TABLE" migrations/')).toBeUndefined()
})

test('edits outside the project are refused, links included', async ($, on) => {
  const { ran } = world(on, { links: { '/proj/vendor-link': '/opt/vendor' } })
  await start($)
  const outside = refusal(await $.tool.call({ tool: 'Write', file_path: '/etc/hosts', content: 'x' }))
  expect(outside).toContain('edits a file outside the project (/etc/hosts)')
  const viaLink = refusal(await $.tool.call({ tool: 'Edit', file_path: '/proj/vendor-link/lib.js', old_string: 'a', new_string: 'b' }))
  expect(viaLink).toContain('through a link (/proj/vendor-link/lib.js → /opt/vendor/lib.js)')

  await $.tool.call({ tool: 'Write', file_path: '/proj/new/dir/a.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/home/me/.claude/plans/plan.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/var/folders/xy/T/scratch.txt', content: 'x' })
  expect(ran).toEqual(['Write', 'Write', 'Write'])
})

test('the allow option adds folders', { options: { allow: '~/notes, /srv/shared' } }, async ($, on) => {
  const { ran } = world(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/home/me/notes/today.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/srv/shared/x.txt', content: 'x' })
  expect(refusal(await $.tool.call({ tool: 'Write', file_path: '/srv/other/x.txt', content: 'x' }))).toContain('outside the project')
  expect(ran).toEqual(['Write', 'Write'])
})

test('warn mode runs the call and tells Claude', { options: { mode: 'warn' } }, async ($, on) => {
  const { ran, toasts } = world(on)
  await start($)
  const result = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(ran).toEqual(['git reset --hard'])
  expect(result.context?.join('\n') ?? '').toContain('game-barrier (warn mode)')
  expect(toasts[0]).toContain('warn mode')
})

test('/barrier pass is yours to type and lasts one call', async ($, on) => {
  const { ran } = world(on)
  await start($)
  expect((await $.command.run(barrier('pass', false))).text).toContain('Only you can')
  await $.command.run(barrier('pass'))
  expect(await bash($, 'git reset --hard')).toBeUndefined()
  expect(await bash($, 'git reset --hard')).toContain('game-barrier blocked this call')
  expect(ran).toEqual(['git reset --hard'])
})

// A Windows session: native paths from the engine, Git Bash spellings in commands.
function winWorld(on: On, opts: { head?: string; root?: string } = {}) {
  mock.store(on)
  mock.clock(on, { now: 1_700_000_000_000 })
  const ran: string[] = []
  const logs: string[] = []
  const root = opts.root ?? 'C:\\Users\\me\\proj'
  const env: Record<string, string> = {
    OS: 'Windows_NT',
    USERPROFILE: 'C:\\Users\\me',
    TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('env.get', (_, e) => ({ value: env[e.name] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.read', (_, e) => {
    // The test runs on Linux, where the engine reads `c:/…` as relative: match the end.
    if (e.path.endsWith('c:/users/me/proj/.git/HEAD') && opts.head !== undefined) return { value: opts.head }
    throw new Error('ENOENT')
  })
  on('tool.call', (_, e) => {
    ran.push(String(e.tool) === 'Bash' ? String((e as { command?: string }).command) : `${String(e.tool)} ${String((e as { file_path?: string }).file_path)}`)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return { ran, logs }
}

test('on Windows, the project in any spelling may be edited; other folders and drives may not', async ($, on) => {
  const { ran } = winWorld(on)
  await $.session.start({ cwd: 'C:\\Users\\me\\proj', surface: 'terminal', isInteractive: true })
  const edit = async (file_path: string) => refusal(await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }))
  expect(await edit('C:\\Users\\me\\proj\\src\\a.ts')).toBeUndefined()
  expect(await edit('c:/users/ME/proj/src/b.ts')).toBeUndefined()
  expect(await edit('src\\c.ts')).toBeUndefined()
  expect(await edit('C:\\Users\\me\\.claude\\settings.json')).toBeUndefined()
  expect(await edit('C:\\Users\\me\\AppData\\Local\\Temp\\scratch.txt')).toBeUndefined()
  expect(await edit('C:\\Windows\\System32\\drivers\\etc\\hosts')).toContain('edits a file outside the project')
  expect(await edit('D:\\work\\notes.txt')).toContain('outside the project')
  expect(await edit('..\\elsewhere\\x.txt')).toContain('outside the project')
  expect(ran).toEqual([
    'Edit C:\\Users\\me\\proj\\src\\a.ts',
    'Edit c:/users/ME/proj/src/b.ts',
    'Edit src\\c.ts',
    'Edit C:\\Users\\me\\.claude\\settings.json',
    'Edit C:\\Users\\me\\AppData\\Local\\Temp\\scratch.txt',
  ])
})

test('on Windows, rm -r inside the project runs; drives, the project root and other folders are refused', async ($, on) => {
  const { ran } = winWorld(on, { head: 'ref: refs/heads/main\n' })
  await $.session.start({ cwd: 'C:\\Users\\me\\proj', surface: 'terminal', isInteractive: true })
  expect(await bash($, 'rm -rf build')).toBeUndefined()
  expect(await bash($, 'rm -rf /c/Users/me/proj/dist')).toBeUndefined()
  expect(await bash($, 'rm -rf /tmp/cache')).toBeUndefined()
  expect(await bash($, 'rm -rf C:\\')).toContain('deletes everything under C:\\')
  expect(await bash($, 'rm -rf /c/')).toContain('deletes everything under /c/')
  expect(await bash($, 'rm -rf "C:\\Users\\me\\proj"')).toContain('deletes the project root')
  expect(await bash($, 'rm -rf /d/data')).toContain('deletes outside the project')
  // The current branch is read from the project's .git/HEAD in its Windows spelling.
  expect(await bash($, 'git push -f')).toContain('protected branch main')
  expect(ran).toEqual(['rm -rf build', 'rm -rf /c/Users/me/proj/dist', 'rm -rf /tmp/cache'])
})

test('a project folder it cannot read turns the outside-project check off instead of refusing every edit', async ($, on) => {
  const { ran, logs } = winWorld(on, { root: 'proj' })
  await $.session.start({ cwd: 'proj', surface: 'terminal', isInteractive: true })
  expect(refusal(await $.tool.call({ tool: 'Edit', file_path: 'src\\a.ts', old_string: 'a', new_string: 'b' }))).toBeUndefined()
  expect(await bash($, 'git reset --hard')).toContain('discards uncommitted changes')
  expect(ran).toEqual(['Edit src\\a.ts'])
  expect(logs.some(l => l.includes('could not read the project folder'))).toBe(true)
})
