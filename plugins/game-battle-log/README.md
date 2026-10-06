# GAME MODE · Battle Log

Tool rows as an 8-bit battle log, so a failure stands out in a long transcript:

```
▸ 탐색 ×5   READ 3 · GREP 2                         HIT
▸ EDIT      src/auth.ts                             CRIT
▸ BASH      npm test                                MISS
  ✗ Exit code 1
  ✗ FAIL src/auth.test.ts
  ✗   2 failed
  … +3줄 (ctrl+o)
▸ BASH      cat .env                                BLOCK
  ✗ game-trap-guard blocked this call: it prints a .env file …
```

| Verdict | When |
|---|---|
| `HIT` | ran without an error |
| `CRIT` | Edit / Write / NotebookEdit changed a file |
| `MISS` | errored; its first three lines are shown and the engine's own error block steps aside |
| `BLOCK` | a GAME MODE guard ([trap guard](../game-trap-guard), [barrier](../game-barrier), [loop breaker](../game-loop-breaker)) refused it |
| `ESC` · `…` | interrupted · still running |

A folded group of reads and searches stays one line, and **unfolds by itself when one of its calls failed**.

Only one-line tools are redrawn (Bash, Read, Edit, Write, NotebookEdit, Grep, Glob, LS, WebFetch, WebSearch, BashOutput, KillShell). Rows that draw their own content (TodoWrite, Agent, ExitPlanMode, AskUserQuestion, MCP tools) and successful results (diffs, output) keep the engine's drawing.

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

도구 실행 줄을 전투 로그처럼 HIT/CRIT/MISS/BLOCK 판정으로 보여줍니다. 실패하면 오류 첫 3줄을 바로 펼치고, 접힌 탐색 묶음에 실패가 있으면 자동으로 펼칩니다.
