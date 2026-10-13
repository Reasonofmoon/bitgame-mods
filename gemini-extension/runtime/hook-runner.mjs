#!/usr/bin/env node
// GAME MODE Lifecycle Hook Runner for Gemini CLI
// Strictly adheres to Gemini CLI's JSON stdin -> JSON stdout contract.

import fs from 'node:fs'
import {
  CHOICE_FILE,
  countHedges,
  formatHudBox,
  inspectBarrier,
  inspectPromptSpellCheck,
  inspectTrapGuard,
  loadState,
  loopKeyOf,
  normalizeTool,
  parseStatusSummary,
  playSound,
  rankWithJev,
  saveState,
  signatureOf,
} from './core.mjs'

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function sendJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

async function main() {
  const event = process.argv[2] || ''
  const input = readStdinJson()
  const state = loadState()
  const cwd = input.cwd || process.cwd()
  const transcriptPath = input.transcript_path || input.transcriptPath || null

  // 1. SessionStart
  if (event === 'SessionStart') {
    state.streaks = {}
    state.lastTurnStartMs = Date.now()
    saveState(state)

    const saveHint = state.lastSavedPassword
      ? `💾 SAVE POINT: /game:load ${state.lastSavedPassword}  ·  /game:hud  ·  /game:pick`
      : `▸ Commands: /game:hud · /game:save · /game:pick · /game:pass · /game:earcons`

    const banner = formatHudBox(state, {
      cwd,
      transcriptPath,
      extraLines: [saveHint],
    })
    sendJson({ systemMessage: banner })
    return
  }

  // 2. BeforeAgent (Spell Check + Prompt Secret Guard)
  if (event === 'BeforeAgent') {
    state.streaks = {}
    state.lastTurnStartMs = Date.now()
    saveState(state)

    const promptText = input.prompt || ''
    const check = inspectPromptSpellCheck(promptText)

    if (check.secret) {
      playSound('block', state.earcons)
      sendJson({
        decision: 'deny',
        reason: `game-spell-check blocked this prompt: it contains a literal ${check.secret.kind}. Remove the secret from your prompt and use an environment variable instead.`,
        systemMessage: `💥 SPELL CHECK TRAP! 프롬프트에서 ${check.secret.kind} 평문이 감지되어 전송을 차단했습니다.`,
      })
      return
    }

    if (check.vague.length > 0 && !check.hasDoneCondition) {
      const words = check.vague.map(w => `'${w}'`).join(', ')
      const note = [
        '[GAME MODE · Spell Check]',
        `사용자의 요청에 모호한 표현(${words})이 있고 완료 조건이 적혀 있지 않습니다.`,
        '작업을 시작하기 전에 무엇이 되면 끝인지(완료 조건)를 한 줄로 먼저 밝히고, 그 기준으로 진행한 뒤 끝에서 그 조건을 확인하세요.',
      ].join('\n')

      sendJson({
        systemMessage: `⚠️ SPELL CHECK: 모호어(${words}) 감지 — 에이전트에게 완료 조건(Done Condition)을 먼저 선언하도록 요청했습니다.`,
        hookSpecificOutput: {
          additionalContext: note,
        },
      })
      return
    }

    sendJson({})
    return
  }

  // 3. BeforeTool (Trap Guard + Barrier + Loop Breaker)
  if (event === 'BeforeTool') {
    if (state.guardMode === 'off') {
      sendJson({})
      return
    }

    const toolName = input.tool_name || input.toolCall?.name || ''
    const toolInput = input.tool_input || input.toolCall?.args || {}

    // Check Trap Guard & Barrier
    const finding =
      inspectTrapGuard(toolName, toolInput) ||
      inspectBarrier(toolName, toolInput, cwd)

    if (finding) {
      if (Date.now() < state.passUntil) {
        state.passUntil = 0
        saveState(state)
        sendJson({
          systemMessage: `🔓 [PASS USED] /game:pass 일회성 통과권으로 ${finding.badge} (${finding.why}) 검사를 1회 통과했습니다.`,
        })
        return
      }

      if (state.guardMode === 'block') {
        state.trapsBlocked = (state.trapsBlocked || 0) + 1
        state.combo = 0
        saveState(state)
        playSound('block', state.earcons)

        const denyReason =
          `game-${finding.guard} blocked this call: it ${finding.why}. ` +
          `Find a safe, reversible way or ask the user to run /game:pass to allow it once.`

        sendJson({
          decision: 'deny',
          reason: denyReason,
          systemMessage: `🛑 ${finding.badge} [${toolName}] 차단 — ${finding.why} (일회 허용: /game:pass)`,
        })
        return
      }
    }

    // Check Loop Breaker (4th identical run after 3 failures)
    const key = loopKeyOf(toolName, toolInput)
    if (key && state.streaks?.[key.id]?.count >= 3 && state.guardMode === 'block') {
      if (Date.now() < state.passUntil) {
        state.passUntil = 0
        saveState(state)
      } else {
        const held = state.streaks[key.id]
        state.trapsBlocked = (state.trapsBlocked || 0) + 1
        saveState(state)
        playSound('block', state.earcons)
        sendJson({
          decision: 'deny',
          reason: `game-loop-breaker blocked this call: \`${held.label}\` already failed the same way ${held.count} times in a row. Change the code or arguments before retrying, or ask the user to run /game:pass.`,
          systemMessage: `🔄 LOOP! [${held.label}] 봉인 — 동일 실패 ${held.count}회 연속 반복 차단 (/game:pass 로 해제 가능)`,
        })
        return
      }
    }

    sendJson({})
    return
  }

  // 4. AfterTool (Battle Log Combo + Loop Breaker Streak + Item Get)
  if (event === 'AfterTool') {
    const toolName = input.tool_name || input.toolCall?.name || ''
    const toolInput = input.tool_input || input.toolCall?.args || {}
    const resp = input.tool_response || {}
    const isError = Boolean(
      input.error ||
      resp.error ||
      resp.isError ||
      (typeof resp.llmContent === 'string' && /^Error:|exit status [1-9]/i.test(resp.llmContent))
    )

    const norm = normalizeTool(toolName, toolInput)
    const key = loopKeyOf(toolName, toolInput)

    if (!isError) {
      state.toolCalls = (state.toolCalls || 0) + 1
      state.combo = (state.combo || 0) + 1
      if (state.combo > (state.maxCombo || 0)) state.maxCombo = state.combo
      state.exp = (state.exp || 0) + 1
      const newLevel = Math.floor(state.exp / 10) + 1
      const leveledUp = newLevel > state.level
      state.level = newLevel

      // Ease loop streaks on Write/Read
      if (norm.kind === 'Write' && state.streaks) {
        for (const k of Object.keys(state.streaks)) {
          if (state.streaks[k].count >= 3) state.streaks[k].count = 2
        }
        if (norm.path && !state.inventory.includes(norm.path)) {
          state.inventory = [...state.inventory.slice(-19), norm.path]
        }
      }
      if (key && state.streaks?.[key.id]) {
        delete state.streaks[key.id]
      }

      // Achievements check
      const unlocked = []
      if (state.combo === 10 && !state.achievements.includes('10-Combo Master')) {
        state.achievements.push('10-Combo Master')
        unlocked.push('★ ACHIEVEMENT UNLOCKED: 10-Combo Master!')
      }
      saveState(state)

      if (leveledUp) {
        playSound('done', state.earcons)
        sendJson({
          systemMessage: `⚔ BATTLE LOG ▸ ${toolName} CRIT COMBO ×${state.combo} · 🎉 LEVEL UP! → LV ${String(state.level).padStart(2, '0')}${unlocked.length ? ' · ' + unlocked.join(' ') : ''}`,
        })
        return
      }

      if (state.combo > 0 && state.combo % 5 === 0) {
        playSound('hit', state.earcons)
        sendJson({
          systemMessage: `⚔ BATTLE LOG ▸ ${toolName} COMBO ×${state.combo}${unlocked.length ? ' · ' + unlocked.join(' ') : ''}`,
        })
        return
      }

      sendJson({})
      return
    }

    // Tool failed -> BREAK combo & increment loop streak
    const prevCombo = state.combo || 0
    state.combo = 0
    playSound('miss', state.earcons)

    if (key) {
      const errText = String(input.error || resp.error || resp.llmContent || 'error')
      const sig = signatureOf(errText)
      const prev = state.streaks?.[key.id]
      const count = prev && prev.signature === sig ? prev.count + 1 : 1
      state.streaks = state.streaks || {}
      state.streaks[key.id] = { signature: sig, count, label: key.label }
      saveState(state)

      if (count >= 2) {
        const warnMsg =
          count >= 3
            ? `[GAME MODE · Loop Breaker] LOOP 3/3: \`${key.label}\` failed identically 3 times. The 4th identical call will be BLOCKED unless you change the code or arguments first.`
            : `[GAME MODE · Loop Breaker] LOOP 2/3: \`${key.label}\` failed the same way twice. Change something before running it again.`
        sendJson({
          systemMessage: `💥 COMBO BREAK (×${prevCombo} → 0) · ⚠️ LOOP ${Math.min(count, 3)}/3 on [${key.label}]`,
          hookSpecificOutput: {
            additionalContext: warnMsg,
          },
        })
        return
      }
    }

    saveState(state)
    sendJson({})
    return
  }

  // 5. AfterAgent (HUD + Clear Time + Hedge Mark + Jev Choice Card)
  if (event === 'AfterAgent') {
    state.turns = (state.turns || 0) + 1
    const elapsedSec = Math.max(1, Math.round((Date.now() - (state.lastTurnStartMs || Date.now())) / 1000))
    const history = Array.isArray(state.turnDurationsMs) ? state.turnDurationsMs : []
    const medianSec =
      history.length > 0
        ? Math.round([...history].sort((a, b) => a - b)[Math.floor(history.length / 2)] / 1000)
        : elapsedSec
    const diffSec = elapsedSec - medianSec
    const diffLabel = diffSec <= 0 ? `${diffSec}s` : `+${diffSec}s`
    state.turnDurationsMs = [...history.slice(-19), elapsedSec * 1000]
    saveState(state)

    const responseText = input.prompt_response || ''
    const hedges = countHedges(responseText)
    const extraLines = [
      `⏱️ CLEAR ${elapsedSec}s (평소 대비 ${diffLabel})${hedges > 0 ? `  ·  ❓ HEDGE 추정 ${hedges}곳 (가설 주의)` : '  ·  ✓ 사실 기반 응답'}`,
    ]

    const parsed = parseStatusSummary(responseText)
    if (parsed) {
      const { summary, ranked, note } = await rankWithJev(parsed)
      try {
        fs.writeFileSync(
          CHOICE_FILE,
          JSON.stringify({ updatedAt: Date.now(), ranked, note, summary }, null, 2) + '\n',
          'utf8',
        )
      } catch {
        // ignore
      }

      if (summary.decisions.length > 0) {
        extraLines.push(`◆ CHOICE CARD (${ranked ? 'Jev AI 랭킹 적용' : '기본 순서'}) — /game:pick <코드> 로 즉시 실행`)
        summary.decisions.forEach((d, idx) => {
          const opts = d.options
            .map((o, j) => {
              const code = `${idx + 1}${String.fromCharCode(97 + j)}`
              const star = j === 0 ? '★' : ''
              return `[${code}] ${star}${o.label}`
            })
            .join('   ')
          extraLines.push(`  Q${idx + 1}. ${d.question}  →  ${opts}`)
        })
      } else {
        extraLines.push(`◆ NEXT PROMPT READY — /game:pick 입력 시 4번 재개 프롬프트로 바로 진행합니다.`)
      }
    }

    playSound('done', state.earcons)
    const hud = formatHudBox(state, { cwd, transcriptPath, extraLines })
    sendJson({ systemMessage: hud })
    return
  }

  sendJson({})
}

main().catch(() => {
  sendJson({})
})
