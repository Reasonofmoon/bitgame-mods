# GAME MODE · Casting

The spinner says what the turn is doing and what it has cost so far:

```
✻ CASTING · BASH npm test… · 행동 3 · G +₩120 (12s · ↓ 300 tokens)
```

- **what runs now**: the call running (`BASH npm test`, `EDIT auth.ts`, `SUMMON Find callers`), else the spinner's own state (`생각하는 중`, `답을 쓰는 중`)
- **행동 n**: calls the main loop made this turn
- **G +x**: the session's cost now minus at the turn's start, as the engine reports it (₩ by default)

Only the words are rewritten, so the engine's own time and tokens stay after them. A state the engine names itself (compacting, a retry) keeps its words.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-casting@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (adds `CASTING ×n` when several calls run at once) |
| `currency` (`krw`) · `krwPerUsd` (`1400`) | how `G` is shown |

## Known limits

- The engine reports cost after each response, so `G +x` moves in steps.

## 한국어

작업 중 스피너를 `CASTING · 지금 실행 중인 행동 · 행동 n · G +이번 턴 비용`으로 바꿉니다. 경과 시간과 토큰은 엔진 표시 그대로 뒤에 남습니다.
