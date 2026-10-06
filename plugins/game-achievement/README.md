# GAME MODE · Achievement

Milestones of good habits, each raised once as a toast and kept across sessions:

| Achievement | When |
|---|---|
| `첫 세이브` | the first `/save` |
| `안전 운전` | 10 commits made in turns where no GAME MODE guard refused anything |
| `역전승` | a command that failed passes after a file changed |
| `10 콤보` | 10 successful calls in a row |
| `제때 휴식` | a `/compact` you ran while context left was 30% or less, before it fell under 10% |

```
★ ACHIEVEMENT 역전승 — 실패한 명령을 고친 뒤 같은 명령 통과
```

`/achievements` lists them with progress (`안전 운전 4/10`, `10 콤보 최고 7`).

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-achievement@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` records nothing · `casual` · `hardcore` (progress toasts) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## 한국어

좋은 습관을 업적으로 남깁니다: 첫 세이브, 가드 거절 없는 커밋 10번, 실패를 고쳐 통과(역전승), 10 콤보, HP 10% 전에 휴식. `/achievements`로 진행 상황을 봅니다.
