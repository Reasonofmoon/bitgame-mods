// Unit & Hook Contract Tests for gemini-extension (GAME MODE for Gemini CLI)
// Uses node:test and constructs fake secret tokens dynamically at runtime per AGENTS.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DUAL_SCREEN_FILE,
  cellOfMinimap,
  countHedges,
  formatDualScreenBoard,
  formatHudBox,
  formatMinimapLines,
  formatQuestLines,
  inspectBarrier,
  inspectPromptSpellCheck,
  inspectTrapGuard,
  loopKeyOf,
  mutateQuests,
  parseStatusSummary,
  recordMinimapVisit,
  relativeMinimapPath,
  secretFile,
  signatureOf,
  summaryOfMinimap,
  syncQuestsFromSummary,
  syncQuestsFromTool,
  syncTmuxSidePane,
} from '../runtime/core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.resolve(__dirname, '../runtime/hook-runner.mjs')

function runHook(event, payload) {
  const stdout = execFileSync('node', [RUNNER, event], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, BITGAME_NO_TMUX: '1' },
  })
  return JSON.parse(stdout.trim())
}

// ---------------------------------------------------------------------------
// 1. Trap Guard unit tests
// ---------------------------------------------------------------------------

test('Trap Guard refuses reading and printing secret files (.env, SSH keys)', () => {
  assert.equal(secretFile('/project/.env'), '.env file')
  assert.equal(secretFile('/project/.env.local'), '.env file')
  assert.equal(secretFile('/project/.env.example'), undefined)
  assert.equal(secretFile('/Users/test/.ssh/id_ed25519'), 'SSH private key')

  const catEnv = inspectTrapGuard('run_shell_command', { command: 'cat .env' })
  assert.ok(catEnv)
  assert.equal(catEnv.guard, 'trap-guard')
  assert.match(catEnv.why, /prints a \.env file/)

  const readKey = inspectTrapGuard('read_file', { file_path: '/Users/dev/.ssh/id_rsa' })
  assert.ok(readKey)
  assert.match(readKey.why, /SSH private key/)

  const printAll = inspectTrapGuard('run_shell_command', { command: 'printenv' })
  assert.ok(printAll)
  assert.match(printAll.why, /prints every environment variable/)
})

test('Trap Guard refuses literal API keys constructed at runtime', () => {
  const fakeAnthropic = 'sk-ant-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3'
  const fakeGithub = 'ghp_' + 'x'.repeat(38)

  const cmdHit = inspectTrapGuard('run_shell_command', { command: `curl -H "x-api-key: ${fakeAnthropic}" https://example.com` })
  assert.ok(cmdHit)
  assert.match(cmdHit.why, /Anthropic API key/)

  const writeHit = inspectTrapGuard('write_file', { file_path: 'src/config.ts', content: `const token = "${fakeGithub}"` })
  assert.ok(writeHit)
  assert.match(writeHit.why, /GitHub token/)

  // Writing to .env is allowed
  const writeEnvAllowed = inspectTrapGuard('write_file', { file_path: '.env', content: `GITHUB_TOKEN=${fakeGithub}` })
  assert.equal(writeEnvAllowed, undefined)
})

// ---------------------------------------------------------------------------
// 2. Barrier unit tests
// ---------------------------------------------------------------------------

test('Barrier refuses destructive git, rm, publish, and database commands', () => {
  const resetHard = inspectBarrier('run_shell_command', { command: 'git reset --hard HEAD~1' })
  assert.ok(resetHard)
  assert.equal(resetHard.guard, 'barrier')
  assert.match(resetHard.why, /git reset --hard/)

  const forceMain = inspectBarrier('run_shell_command', { command: 'git push --force origin main' })
  assert.ok(forceMain)
  assert.match(forceMain.why, /protected branch main/)

  const rmRoot = inspectBarrier('run_shell_command', { command: 'rm -rf ~/' })
  assert.ok(rmRoot)
  assert.match(rmRoot.why, /deletes everything under ~\//)

  const npmPub = inspectBarrier('run_shell_command', { command: 'npm publish' })
  assert.ok(npmPub)
  assert.match(npmPub.why, /npm publish/)

  const npmDryRun = inspectBarrier('run_shell_command', { command: 'npm publish --dry-run' })
  assert.equal(npmDryRun, undefined)

  const dropTable = inspectBarrier('run_shell_command', { command: 'psql -c "DROP TABLE users;"' })
  assert.ok(dropTable)
  assert.match(dropTable.why, /DROP\/TRUNCATE/)
})

// ---------------------------------------------------------------------------
// 3. Loop Breaker & Signature tests
// ---------------------------------------------------------------------------

test('Loop Breaker normalizes timestamps, durations, and temp paths in error signatures', () => {
  const s1 = signatureOf('2026-10-14T08:30:00Z Failed in 142ms at /tmp/test-123/a.js (0x7fff1234)')
  const s2 = signatureOf('2026-10-14T08:31:19Z Failed in 89ms at /tmp/test-999/b.js (0x7fff9999)')
  assert.equal(s1, s2)

  const key = loopKeyOf('run_shell_command', { command: 'npm   test' })
  assert.deepEqual(key, { id: 'Bash:npm test', label: 'npm test', kind: 'command' })
})

// ---------------------------------------------------------------------------
// 4. Spell Check & Hedge Mark tests
// ---------------------------------------------------------------------------

test('Spell Check detects vague words and done conditions', () => {
  const vagueOnly = inspectPromptSpellCheck('로그인 버그 적당히 고쳐줘')
  assert.deepEqual(vagueOnly.vague, ['적당히'])
  assert.equal(vagueOnly.hasDoneCondition, false)

  const withDone = inspectPromptSpellCheck('로그인 버그 적당히 고쳐줘. 완료 조건: npm test 통과')
  assert.equal(withDone.hasDoneCondition, true)

  const fakeOpenAi = 'sk-proj-' + 'Z'.repeat(36)
  const withSecret = inspectPromptSpellCheck(`키가 ${fakeOpenAi} 인데 확인해줘`)
  assert.ok(withSecret.secret)
  assert.equal(withSecret.secret.kind, 'OpenAI API key')
})

test('Hedge Mark counts guessing sentences while ignoring code blocks', () => {
  const md = [
    '테스트 3개 중 2개가 실패합니다.',
    '아마도 토큰 만료 시간이 원인일 것입니다.',
    '```ts',
    '// probably inside code block should be ignored',
    '```',
    'I think the race condition happens on startup.',
  ].join('\n')
  assert.equal(countHedges(md), 2)
})

// ---------------------------------------------------------------------------
// 5. Status Summary & Choice Parser tests
// ---------------------------------------------------------------------------

test('parseStatusSummary extracts resume prompt, decisions, done, and todo items', () => {
  const sample = [
    '작업 완료했습니다.',
    '```',
    '[상태 요약]',
    '1. 지금까지 한 일:',
    '   - 코어 가드 이식',
    '2. 아직 남은 일:',
    '   - 단위 테스트 추가',
    '3. 내가 결정해야 할 것:',
    '   - Q: 어떤 모드로 실행할까요?',
    '     - 기본 모드 => 블록 모드로 실행한다.',
    '     - 경고 모드 => 경고 모드로 실행한다.',
    '4. 다음에 이어서 할 때 붙여넣을 프롬프트:',
    '   - 가드 이식을 마쳤으니 다음 단계를 진행해줘.',
    '5. 산출물/파일/링크:',
    '   - gemini-extension/runtime/core.mjs',
    '```',
  ].join('\n')

  const parsed = parseStatusSummary(sample)
  assert.ok(parsed)
  assert.equal(parsed.resume, '가드 이식을 마쳤으니 다음 단계를 진행해줘.')
  assert.equal(parsed.decisions.length, 1)
  assert.equal(parsed.decisions[0].question, '어떤 모드로 실행할까요?')
  assert.equal(parsed.decisions[0].options.length, 2)
  assert.equal(parsed.decisions[0].options[0].label, '기본 모드')
  assert.equal(parsed.decisions[0].options[0].append, '블록 모드로 실행한다.')
})

// ---------------------------------------------------------------------------
// 6. Hook Runner JSON Contract integration tests
// ---------------------------------------------------------------------------

test('Hook Runner returns valid JSON for BeforeAgent and BeforeTool', () => {
  const spellRes = runHook('BeforeAgent', { prompt: '코드 깔끔하게 정리해줘' })
  assert.ok(spellRes.systemMessage.includes('SPELL CHECK'))
  assert.ok(spellRes.hookSpecificOutput?.additionalContext.includes('완료 조건'))

  const guardRes = runHook('BeforeTool', {
    tool_name: 'run_shell_command',
    tool_input: { command: 'cat .env' },
  })
  assert.equal(guardRes.decision, 'deny')
  assert.match(guardRes.reason, /^game-trap-guard blocked this call:/)

  const hud = formatHudBox({ level: 2, exp: 15, combo: 4, maxCombo: 7, guardMode: 'block', earcons: true, passUntil: 0 })
  assert.match(hud, /LV 02/)
  assert.match(hud, /COMBO ×4/)
})

// ---------------------------------------------------------------------------
// 7. Quest Log (/quest) unit tests
// ---------------------------------------------------------------------------

test('Quest Log tracks tasks from status summary, tools, and CLI mutations with BOSS and ALL CLEAR', () => {
  const state = { quests: [], questsCarried: false }

  syncQuestsFromSummary(state, {
    done: ['저장소 구조 파악'],
    todo: ['토큰 만료 단위 수정', 'README 갱신', '전체 테스트 통과'],
  })

  assert.equal(state.quests.length, 4)
  assert.equal(state.quests[0].status, 'completed')
  assert.equal(state.quests[1].status, 'in_progress')
  assert.equal(state.quests[3].status, 'pending')

  const lines = formatQuestLines(state)
  assert.match(lines[0], /QUEST LOG · 1\/4 클리어/)
  assert.equal(lines[1], '✓ 저장소 구조 파악')
  assert.equal(lines[2], '▶ 토큰 만료 단위 수정')
  assert.equal(lines[4], '· 전체 테스트 통과  BOSS')

  // Complete remaining quests via mutateQuests
  mutateQuests(state, 'done', '')
  mutateQuests(state, 'done', '')
  mutateQuests(state, 'done', '')
  const clearLines = formatQuestLines(state)
  assert.match(clearLines[0], /4\/4 클리어/)
  assert.equal(clearLines.at(-1), '★ ALL CLEAR! ★')

  // Tool-based TodoWrite sync
  syncQuestsFromTool(state, 'TodoWrite', {
    todos: [
      { content: '첫 번째 할 일', status: 'completed' },
      { content: '보스 스테이지', status: 'in_progress' },
    ],
  })
  assert.equal(state.quests.length, 2)
  assert.match(formatQuestLines(state).join('\n'), /▶ 보스 스테이지  BOSS/)
})

// ---------------------------------------------------------------------------
// 8. Minimap (/minimap) & Dual-Screen (tmux side-pane) tests
// ---------------------------------------------------------------------------

test('Minimap records file reads/edits, computes cells (█ ▓ ░ 3+), and identifies re-read hotspots', () => {
  const root = '/workspace/project'
  assert.equal(relativeMinimapPath('/workspace/project/src/auth.ts', root), 'src/auth.ts')
  assert.equal(relativeMinimapPath('./test/auth.test.ts', root), 'test/auth.test.ts')
  assert.equal(relativeMinimapPath('/other/repo/file.ts', root), undefined)

  const state = { minimapVisits: {} }
  recordMinimapVisit(state, 'read_file', { file_path: '/workspace/project/src/auth.ts' }, root)
  recordMinimapVisit(state, 'read_file', { file_path: '/workspace/project/src/auth.ts' }, root)
  recordMinimapVisit(state, 'read_file', { file_path: '/workspace/project/src/auth.ts' }, root)
  recordMinimapVisit(state, 'read_file', { file_path: '/workspace/project/src/auth.ts' }, root)
  recordMinimapVisit(state, 'write_file', { file_path: '/workspace/project/src/index.ts', content: 'x' }, root)
  recordMinimapVisit(state, 'view_file', { AbsolutePath: '/workspace/project/README.md' }, root)

  assert.equal(cellOfMinimap(state.minimapVisits['src/auth.ts']).glyph, '4')
  assert.equal(cellOfMinimap(state.minimapVisits['src/index.ts']).glyph, '█')
  assert.equal(cellOfMinimap(state.minimapVisits['README.md']).glyph, '▓')
  assert.equal(cellOfMinimap(undefined).glyph, '░')

  const fileList = ['src/auth.ts', 'src/index.ts', 'src/utils.ts', 'README.md', 'package.json']
  const summary = summaryOfMinimap(fileList, state.minimapVisits)
  assert.equal(summary.total, 5)
  assert.equal(summary.edited, 1)
  assert.equal(summary.read, 2)
  assert.equal(summary.unexplored, 2)
  assert.equal(summary.top[0].path, 'src/auth.ts')
  assert.equal(summary.top[0].reads, 4)

  const mapLines = formatMinimapLines(state, { cwd: root, fileList })
  assert.match(mapLines[0], /MINIMAP · 파일 5 · 편집 1 · 읽음 2 · 미탐색 2/)
  assert.match(mapLines.join('\n'), /가장 많이 다시 읽은 파일: src\/auth\.ts \(4회\)/)
})

test('Dual-Screen board combines HUD, Quest Log, and Minimap for the tmux side pane', () => {
  const state = {
    level: 3,
    exp: 24,
    combo: 6,
    maxCombo: 11,
    guardMode: 'block',
    earcons: true,
    passUntil: 0,
    dualScreen: true,
    quests: [
      { id: '1', text: '듀얼 스크린 설계', doing: '', status: 'completed' },
      { id: '2', text: 'tmux 패인 연동', doing: '', status: 'in_progress' },
    ],
    minimapVisits: {
      'gemini-extension/runtime/core.mjs': { reads: 3, isEdited: true },
    },
  }
  const fileList = ['gemini-extension/runtime/core.mjs', 'README.md']
  const prevNoTmux = process.env.BITGAME_NO_TMUX
  process.env.BITGAME_NO_TMUX = '1'
  try {
    const res = syncTmuxSidePane(state, { fileList })
    assert.equal(res.written, true)
    assert.match(res.board, /DUAL SCREEN \(TMUX SIDE PANE\)/)
    assert.match(res.board, /QUEST LOG · 1\/2 클리어/)
    assert.match(res.board, /▶ tmux 패인 연동  BOSS/)
    assert.match(res.board, /MINIMAP · 파일 2 · 편집 1 · 읽음 0 · 미탐색 1/)
    assert.match(res.board, /가장 많이 다시 읽은 파일: gemini-extension\/runtime\/core\.mjs \(3회\)/)
    assert.ok(DUAL_SCREEN_FILE.endsWith('dual-screen.txt'))
  } finally {
    if (prevNoTmux === undefined) delete process.env.BITGAME_NO_TMUX
    else process.env.BITGAME_NO_TMUX = prevNoTmux
  }
})

// ---------------------------------------------------------------------------
// 9. Antigravity (agy) Hook Contract tests (PreToolUse, PostToolUse, Stop)
// ---------------------------------------------------------------------------

test('Hook Runner supports Antigravity (agy) PreToolUse, PostToolUse, and Stop contracts', () => {
  const allowRes = runHook('PreToolUse', {
    conversationId: 'test-conv',
    toolCall: { name: 'run_command', args: { CommandLine: 'git status' } },
  })
  assert.equal(allowRes.decision, 'ask')

  const denyRes = runHook('PreToolUse', {
    conversationId: 'test-conv',
    toolCall: { name: 'run_command', args: { CommandLine: 'git reset --hard HEAD~1' } },
  })
  assert.equal(denyRes.decision, 'deny')
  assert.match(denyRes.reason, /BARRIER!/)

  const postRes = runHook('PostToolUse', {
    conversationId: 'test-conv',
    toolCall: { name: 'view_file', args: { AbsolutePath: path.resolve(__dirname, '../../README.md') } },
  })
  assert.deepEqual(postRes, {})

  const stopRes = runHook('Stop', {
    conversationId: 'test-conv',
    terminationReason: 'NO_TOOL_CALL',
  })
  assert.deepEqual(stopRes, { decision: '' })
})


