# GAME MODE · Battle Log

Tool rows as an 8-bit battle log, so a failure stands out in a long transcript:

```
⚔ BATTLE LOG · TURN 2
▸ 탐색 ×2   READ 2                                  HIT
▸ WRITE     src/auth.js                    +4 −4    CRIT  COMBO ×3
▸ BASH      npm test; cat .env                      TRAP! COMBO ×3 → BREAK
  ✗ game-trap-guard blocked this call: it prints a .env file …
▸ BASH      npm test                                MISS
  ✗ FAIL src/auth.test.ts
  … +3줄 (ctrl+o)
  SUMMON ctrl+b ▸ 소환수에게 맡기기 (백그라운드)
```

| Mark | When |
|---|---|
| `⚔ BATTLE LOG · TURN n` | above the first row of each turn (an engine-drawn row too, like a todo list) |
| `HIT` | ran without an error |
| `CRIT` + `+added −removed` | Edit / Write / NotebookEdit changed a file; the line counts come from the patch the tool kept |
| `MISS` | errored; up to three lines that say what failed are shown (`FAIL`, `not ok`, `error`, `expected`, …), exit codes, `TAP version` and runtime warnings are skipped, and the engine's own error block steps aside |
| `TRAP!` · `BARRIER!` · `LOOP!` | the [trap guard](../game-trap-guard), [barrier](../game-barrier) or [loop breaker](../game-loop-breaker) refused it |
| `COMBO ×n` | three or more clean calls in a row (across turns) |
| `COMBO ×n → BREAK` | the failure or refusal that ended such a run |
| `SUMMON` | the run-in-background pill (`ctrl+b`, or your own binding) |
| `ESC` · `…` | interrupted · still running |

A folded group of reads and searches stays one line (with the turn header and the combo when they belong to it), and **unfolds by itself when one of its calls failed**.

Calls are counted from the rows the session keeps (`session.append`), where every refusal shows whichever plugin made it and in whatever order the plugins load, and from `tool.call`, whichever comes first. Subagents' calls are not counted.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-battle-log@bitgame-mods
```

## Settings and commands

| | |
|---|---|
| `intensity` (`casual`) | `off` leaves rows to the engine · `casual` short verdicts · `hardcore` game phrasing (`CLAUDE의 BASH! … MISS…`) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` (light backgrounds) |
| `/battle-log off` · `on` | hand every row back to the engine, and back; remembered |

## 한국어

도구 실행 줄을 전투 로그로 보여줍니다. 턴의 첫 줄에 `TURN n`, 연속 성공 3번부터 `COMBO`, 그것을 끊은 실패에 `BREAK`, 수정에는 `+추가 −삭제` 줄 수, 가드 차단에는 가드별 판정(TRAP!·BARRIER!·LOOP!), 백그라운드 안내는 `SUMMON`. 실패하면 무엇이 실패했는지 최대 3줄을 바로 펼칩니다.
