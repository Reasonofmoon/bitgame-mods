# GAME MODE · Stance

The permission mode as a badge at the right of the prompt footer, in its own color, so a session left in `자동 승인` or `우회` does not go unnoticed:

```
  ⏵⏵ accept edits on (shift+tab to cycle) · ← for agents                 STANCE  자동 승인
```

| Mode | Badge | Color (`nes`) |
|---|---|---|
| default | `기본` | green |
| acceptEdits | `자동 승인` | yellow |
| plan | `계획` | blue |
| auto | `자동 판정` | orange |
| bypassPermissions | `우회` | red |
| dontAsk | `묻지 않음` | grey |

Where the mode comes from: the hook input of each prompt and each tool result (`permission_mode`, exact); the settings' `permissions.defaultMode` at the start; and, between prompts, the footer line. No event reports a shift+tab, and the line handed to a mod names a mode only in the one drawing made as the mode changes, naming the mode it leaves. The badge then moves to the next mode in shift+tab's order (기본 → 자동 승인 → 계획 → [우회] → 자동 판정 → 기본), and the next prompt or tool result confirms it. A change made while Claude works (leaving plan mode) waits for that tool result.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-stance@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` leaves the footer to the engine · `casual` the badge · `hardcore` adds what the mode lets Claude do (`파일 수정은 묻지 않는다`) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## 한국어

프롬프트 아래 오른쪽에 지금 권한 모드를 색 배지로 보여줍니다(기본·자동 승인·계획·자동 판정·우회·묻지 않음). shift+tab으로 바꾸면 따라 바뀌고, 다음 프롬프트나 도구 결과에서 정확한 모드로 다시 맞춥니다.
