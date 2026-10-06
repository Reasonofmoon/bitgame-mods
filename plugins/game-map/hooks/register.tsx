import type { EngineInterface, Register } from 'claude-code'

import { intensityOf } from './palette'

// GAME MODE · MAP
//
// A status line under the prompt with where you are and how long you have played:
//   MAP feat/login · 플레이 0:42
//   MAP main ⚠ 보호 · 플레이 1:05     (a protected branch: work there goes straight to main)
// Read from git when the session starts, after each turn and once a minute.

const EVERY_MS = 60_000

type Setup = { isHardcore: boolean; protectedBranches: readonly RegExp[] }

export const register: Register = (on, options) => {
  const intensity = intensityOf(options.intensity)
  const setup: Setup = {
    isHardcore: intensity === 'hardcore',
    protectedBranches: patternsOf(typeof options.protectedBranches === 'string' ? options.protectedBranches : 'main,master,production,release/*'),
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (intensity === 'off') return result
    await $.command.register({ name: 'map', description: 'GAME MODE map: the branch, the play time and the changed files' })
    await refresh($, setup)
    $.clock.every(EVERY_MS, () => {
      void refresh($, setup).catch(() => undefined)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (intensity !== 'off' && e.agentId === undefined) await refresh($, setup).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'map' }, async ($) => {
    const place = await placeOf($)
    const usage = await $.session.usage()
    const played = playTime((await $.clock.now()) - usage.startedAt)
    if (place.branch === null) return { text: `MAP · 저장소 밖 · 플레이 ${played}` }
    const isProtected = matches(place.branch, setup.protectedBranches)
    return {
      text: [
        `MAP ${place.branch}${isProtected ? ' ⚠ 보호 브랜치' : ''}`,
        `플레이 ${played}`,
        `변경 파일 ${place.changed}`,
        ...(isProtected ? ['보호 브랜치에서 일하는 중: 새 브랜치에서 작업하려면 git switch -c <이름>'] : []),
      ].join('\n'),
    }
  })
}

type Place = { branch: string | null; changed: number }

/** The branch (`@abc1234` when detached) and how many files differ from it; branch null outside a repository. */
async function placeOf($: EngineInterface): Promise<Place> {
  const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
  if (head.exitCode !== 0) return { branch: null, changed: 0 }
  let branch = head.stdout.trim()
  if (branch === 'HEAD') {
    const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 3000 })
    branch = `@${sha.stdout.trim()}`
  }
  const status = await $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 5000 })
  const changed = status.exitCode === 0 ? status.stdout.split('\n').filter(l => l.trim() !== '').length : 0
  return { branch, changed }
}

async function refresh($: EngineInterface, setup: Setup): Promise<void> {
  const usage = await $.session.usage()
  const played = playTime((await $.clock.now()) - usage.startedAt)
  let place: Place = { branch: null, changed: 0 }
  try {
    place = await placeOf($)
  } catch {
    // No git, or no process runner on this surface: the play time alone.
  }
  $.ui.status(mapLine(place, played, setup))
}

export function mapLine(place: Place, played: string, setup: Setup): string {
  if (place.branch === null) return `MAP 저장소 밖 · 플레이 ${played}`
  const mark = matches(place.branch, setup.protectedBranches) ? ' ⚠ 보호' : ''
  const extra = setup.isHardcore ? ` · 변경 ${place.changed}` : ''
  return `MAP ${place.branch}${mark} · 플레이 ${played}${extra}`
}

/** `h:mm` */
export function playTime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** `main,release/*` → patterns; `*` matches within one path part. */
export function patternsOf(list: string): RegExp[] {
  return list
    .split(',')
    .map(p => p.trim())
    .filter(p => p !== '')
    .map(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`))
}

function matches(branch: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(p => p.test(branch))
}
