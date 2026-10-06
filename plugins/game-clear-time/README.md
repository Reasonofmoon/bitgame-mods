# GAME MODE · Clear Time

The line that closes a turn says how it went, against how turns usually go in this project:

```
✦ CLEAR 0:42 · 행동 7 · 이번 턴 ₩312 · 평소보다 −0:13
```

- **행동 n**: the main loop's tool calls in the turn
- **이번 턴**: the session's cost after the turn minus before it
- **평소보다 ±m:ss**: against the median of the project's last 20 finished turns (kept across sessions; shown from three turns on record). Faster in green, slower in orange. Interrupted turns are shown but not kept as usual turns.

`/clear-time` prints the project's usual turn, the fastest and the slowest.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-clear-time@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (adds the median it compares against) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |
| `currency` (`krw`) · `krwPerUsd` (`1400`) | how the cost is shown |

## 한국어

턴이 끝나는 줄을 `CLEAR 걸린 시간 · 행동 수 · 이번 턴 비용 · 평소보다 ±시간`으로 바꿉니다. 평소는 이 프로젝트의 최근 20턴 중앙값입니다.
