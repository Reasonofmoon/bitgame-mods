// Unit & Hook Contract Tests for gemini-extension (GAME MODE for Gemini CLI)
// Uses node:test and constructs fake secret tokens dynamically at runtime per AGENTS.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  countHedges,
  formatHudBox,
  inspectBarrier,
  inspectPromptSpellCheck,
  inspectTrapGuard,
  loopKeyOf,
  parseStatusSummary,
  secretFile,
  signatureOf,
} from '../runtime/core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.resolve(__dirname, '../runtime/hook-runner.mjs')

function runHook(event, payload) {
  const stdout = execFileSync('node', [RUNNER, event], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
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
