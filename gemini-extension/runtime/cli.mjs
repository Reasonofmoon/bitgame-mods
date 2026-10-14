#!/usr/bin/env node
// GAME MODE Command CLI Helper for Gemini CLI Custom Commands (/game:*)

import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  DUAL_SCREEN_FILE,
  SAVES_FILE,
  TMUX_BIN,
  bestOptionIndex,
  composeChoicePrompt,
  copyToClipboard,
  fillTmuxMainPrompt,
  formatChoiceLines,
  formatDualScreenBoard,
  formatHudBox,
  formatMinimapBox,
  formatQuestBox,
  isTmuxPaneAlive,
  loadChoice,
  loadState,
  mutateQuests,
  playSound,
  saveChoice,
  saveState,
  syncTmuxSidePane,
} from './core.mjs'

const [sub, ...rest] = process.argv.slice(2)
const arg = rest.join(' ').trim()
const state = loadState()

function loadSaves() {
  try {
    if (fs.existsSync(SAVES_FILE)) return JSON.parse(fs.readFileSync(SAVES_FILE, 'utf8'))
  } catch {
    // ignore
  }
  return []
}

function writeSaves(list) {
  fs.writeFileSync(SAVES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8')
}

function applyPickTokens(tokens = [], { focusMain = false } = {}) {
  const data = loadChoice()
  if (!data?.summary) return null
  const summary = data.summary
  const nextSelected = { ...(data.selected || {}) }
  const cleanTokens = tokens.filter(t => t && !t.startsWith('--'))

  summary.decisions.forEach((d, i) => {
    const qPrefix = String(i + 1)
    const token = cleanTokens.find(t => t.startsWith(qPrefix))
    let optIdx = nextSelected[i] ?? bestOptionIndex(d)
    if (token && token.length >= 2) {
      const letterIdx = token.charCodeAt(1) - 97
      if (letterIdx >= 0 && letterIdx < d.options.length) {
        optIdx = letterIdx
      } else if (i === 0 && d.options.length < 3 && summary.decisions[1]) {
        // Fallback when 1c is pressed on a 2-option Q1 -> map to 2a
        nextSelected[1] = 0
      }
    }
    nextSelected[i] = optIdx
  })

  const { text: composed, selected } = composeChoicePrompt(summary, nextSelected)
  const updated = {
    ...data,
    selected,
    composedPrompt: composed,
    updatedAt: Date.now(),
  }
  saveChoice(updated)
  syncTmuxSidePane(state, { cwd: process.cwd() })
  const fillRes = fillTmuxMainPrompt(composed, state, { delayMs: 0, focusMain })
  return { composed, selected, fillRes }
}

if (sub === 'hud') {
  const inv = state.inventory?.length
    ? `🎒 INVENTORY (${state.inventory.length}): ${state.inventory.slice(-5).map(p => p.split('/').pop()).join(', ')}`
    : '🎒 INVENTORY: (비어 있음)'
  const ach = state.achievements?.length
    ? `🏆 ACHIEVEMENTS: ${state.achievements.join(' · ')}`
    : '🏆 ACHIEVEMENTS: 첫 세이브(/game:save) 또는 10콤보 달성 시 해금'
  const stats = `📊 STATS: 총 ${state.turns}턴 · 도구 호출 ${state.toolCalls}회 · 가드 차단 ${state.trapsBlocked}회`
  const choiceLines = formatChoiceLines(loadChoice(), { autoFill: state.autoFill !== false })
  console.log(formatHudBox(state, { extraLines: [stats, inv, ach, '─'.repeat(68), ...choiceLines] }))
  process.exit(0)
}

if (sub === 'pass') {
  const modeArg = arg.toLowerCase()
  if (modeArg === 'block' || modeArg === 'warn' || modeArg === 'off') {
    state.guardMode = modeArg
    saveState(state)
    console.log(`🛡️ GAME MODE Guard mode changed to: ${modeArg.toUpperCase()}`)
    process.exit(0)
  }
  if (modeArg === 'reset') {
    state.streaks = {}
    saveState(state)
    console.log('🔄 GAME MODE Loop Breaker streaks cleared.')
    process.exit(0)
  }
  state.passUntil = Date.now() + 10 * 60 * 1000
  saveState(state)
  console.log('🔓 GAME MODE PASS ACTIVATED: 다음 10분 내 가드(Trap/Barrier/Loop)가 차단하는 호출 1회를 통과시킵니다.')
  process.exit(0)
}

if (sub === 'earcons') {
  const mode = arg.toLowerCase()
  if (mode === 'on' || mode === 'off') {
    state.earcons = mode === 'on'
    saveState(state)
    syncTmuxSidePane(state, { cwd: process.cwd() })
    if (state.earcons) playSound('done', true)
    console.log(`🔊 GAME MODE Earcons (효과음): ${state.earcons ? 'ON' : 'OFF'}`)
    process.exit(0)
  }
  if (mode === 'test') {
    playSound('save', true)
    console.log('🔊 Playing 8-bit save cue (save.wav)...')
    process.exit(0)
  }
  state.earcons = !state.earcons
  saveState(state)
  syncTmuxSidePane(state, { cwd: process.cwd() })
  if (state.earcons) playSound('hit', true)
  console.log(`🔊 GAME MODE Earcons toggled: ${state.earcons ? 'ON' : 'OFF'}`)
  process.exit(0)
}

if (sub === 'autofill') {
  const mode = arg.toLowerCase()
  if (mode === 'on' || mode === 'off') {
    state.autoFill = mode === 'on'
  } else {
    state.autoFill = state.autoFill === false
  }
  saveState(state)
  syncTmuxSidePane(state, { cwd: process.cwd() })
  console.log(`⌨️ GAME MODE 프롬프트 자동완성(Auto-Fill): ${state.autoFill ? 'ON' : 'OFF'}`)
  process.exit(0)
}

if (sub === 'fill-now') {
  const data = loadChoice()
  if (!data?.summary) process.exit(0)
  const { text: composed } = composeChoicePrompt(data.summary, data.selected || {})
  if (composed) {
    fillTmuxMainPrompt(composed, state, { delayMs: 0 })
  }
  process.exit(0)
}

if (sub === 'save') {
  const saves = loadSaves()
  const idx = String(saves.length + 1).padStart(2, '0')
  const code = Math.random().toString(36).slice(2, 6).toUpperCase()
  const user = (os.userInfo().username || 'MOON').slice(0, 4).toUpperCase()
  const password = `SP${idx}-${code}-${user}`

  const lastChoice = loadChoice()
  const summary = lastChoice?.summary || {
    resume: arg || '이전 세션 작업을 이어서 진행해 주세요.',
    done: [],
    todo: [],
    files: state.inventory.slice(-5),
  }

  const entry = {
    password,
    savedAt: new Date().toISOString(),
    cwd: process.cwd(),
    note: arg || null,
    level: state.level,
    combo: state.combo,
    summary,
  }
  saves.push(entry)
  writeSaves(saves)

  state.lastSavedPassword = password
  if (!state.achievements.includes('First Save Point')) {
    state.achievements.push('First Save Point')
  }
  saveState(state)
  const copied = copyToClipboard(summary.resume)
  playSound('save', state.earcons)

  console.log([
    '╭─ ◆ ★ SAVE POINT CREATED ★ ───────────────────────────────────────────╮',
    `│ 🔑 PASSWORD : ${password} ${copied ? '(재개 프롬프트 클립보드 복사됨!)' : ''}`,
    `│ 📁 PROJECT  : ${process.cwd()}`,
    `│ 📝 RESUME   : ${summary.resume}`,
    `│ 🎒 ITEMS    : ${(state.inventory.slice(-5).map(p => p.split('/').pop()).join(', ')) || '(없음)'}`,
    `│ ▸ 복원 방법 : 새 세션에서 /game:load ${password}`,
    '╰──────────────────────────────────────────────────────────────────────╯',
  ].join('\n'))
  process.exit(0)
}

if (sub === 'load') {
  const saves = loadSaves()
  if (saves.length === 0) {
    console.log('저장된 세이브 포인트가 없습니다. 먼저 `/game:save`를 실행하세요.')
    process.exit(0)
  }
  const target = arg
    ? saves.find(s => s.password.toUpperCase() === arg.toUpperCase())
    : saves.at(-1)
  if (!target) {
    console.log(`패스워드 '${arg}'에 해당하는 세이브 포인트를 찾지 못했습니다. 최근 패스워드: ${saves.at(-1).password}`)
    process.exit(0)
  }
  playSound('done', state.earcons)
  console.log([
    `[GAME MODE · SAVE POINT LOADED: ${target.password}]`,
    target.summary?.done?.length ? `지금까지 한 일: ${target.summary.done.join(' / ')}` : '',
    target.summary?.todo?.length ? `아직 남은 일: ${target.summary.todo.join(' / ')}` : '',
    `이어서 실행할 작업 지시: ${target.summary?.resume || target.note || '이전 작업을 이어서 진행해 주세요.'}`,
  ].filter(Boolean).join('\n'))
  process.exit(0)
}

if (sub === 'pick') {
  const tokens = arg ? arg.toLowerCase().split(/[\s,]+/).filter(Boolean) : []
  const res = applyPickTokens(tokens)
  if (!res) {
    console.log('아직 저장된 `[상태 요약]` 선택 카드가 없습니다. 먼저 작업 턴을 1회 진행해 주세요.')
    process.exit(0)
  }
  playSound('hit', state.earcons)
  console.log(res.composed)
  process.exit(0)
}

if (sub === 'quest') {
  const [firstWord, ...tailWords] = rest
  const act = (firstWord || '').toLowerCase()
  if (act === 'clear' || act === 'add' || act === 'done') {
    const res = mutateQuests(state, act, tailWords.join(' '))
    saveState(state)
    syncTmuxSidePane(state, { cwd: process.cwd() })
    if (act === 'clear') {
      console.log(res.message)
      process.exit(0)
    }
  } else {
    syncTmuxSidePane(state, { cwd: process.cwd() })
  }
  console.log(formatQuestBox(state))
  process.exit(0)
}

if (sub === 'minimap') {
  const mode = arg.toLowerCase()
  if (mode === 'reset' || mode === 'clear') {
    state.minimapVisits = {}
    saveState(state)
  }
  syncTmuxSidePane(state, { cwd: process.cwd() })
  console.log(formatMinimapBox(state, { cwd: process.cwd() }))
  process.exit(0)
}

if (sub === 'dual') {
  const mode = arg.toLowerCase()
  if (mode === 'off' || mode === 'close') {
    state.dualScreen = false
    if (state.tmuxPaneId && isTmuxPaneAlive(state.tmuxPaneId)) {
      try {
        execFileSync(TMUX_BIN, ['kill-pane', '-t', state.tmuxPaneId], { stdio: 'ignore' })
      } catch {
        // ignore
      }
    }
    state.tmuxPaneId = null
    saveState(state)
    console.log('🖥️ GAME MODE Dual-Screen (tmux side-pane): OFF')
    process.exit(0)
  }

  state.dualScreen = true
  saveState(state)
  const forceOpen = mode === 'open' || mode === 'on' || Boolean(process.env.TMUX)
  const res = syncTmuxSidePane(state, { cwd: process.cwd(), forceOpen })
  const statusLine = res.paneId
    ? `🖥️ GAME MODE Dual-Screen: ON (tmux pane ${res.paneId})`
    : `🖥️ GAME MODE Dual-Screen: ON (buffer: ${DUAL_SCREEN_FILE})`
  console.log(statusLine + '\n' + res.board)
  process.exit(0)
}

if (sub === 'pane-watch') {
  let lastContent = ''
  const render = (force = false) => {
    try {
      const content = fs.existsSync(DUAL_SCREEN_FILE)
        ? fs.readFileSync(DUAL_SCREEN_FILE, 'utf8')
        : formatDualScreenBoard(loadState(), { cwd: process.cwd() })
      if (force || content !== lastContent) {
        lastContent = content
        process.stdout.write('\x1b[2J\x1b[H' + content)
      }
    } catch {
      // ignore transient read errors
    }
  }
  process.stdout.write('\x1b[?25l')
  const cleanup = () => {
    process.stdout.write('\x1b[?25h\n')
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', buf => {
      const key = buf.toString('utf8')
      if (key === '\u0003' || key === 'q') cleanup()
      const keyMap = {
        '1': '1a',
        a: '1a',
        '2': '1b',
        b: '1b',
        '3': '1c',
        c: '1c',
        '4': '2b',
      }
      if (keyMap[key]) {
        applyPickTokens([keyMap[key]], { focusMain: true })
        render(true)
      } else if (key === '\t' || key === '\r' || key === '\n') {
        applyPickTokens([], { focusMain: true })
        render(true)
      }
    })
  }

  render(true)
  setInterval(() => render(false), 300)
} else {
  console.log('Usage: cli.mjs [hud|quest|minimap|dual|pass|earcons|autofill|save|load|pick] [args]')
}


