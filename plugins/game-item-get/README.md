# GAME MODE · Item Get

A file Claude creates is an item it picked up. Its row in the transcript says so, above the engine's own result, and a toast says it too:

```
▸ WRITE docs/auth-notes.md                    +23 −0 CRIT
✦ ITEM GET! docs/auth-notes.md · 새 파일 23줄
  ⎿  Wrote 23 lines to docs/auth-notes.md
```

`/inventory` lists what this session made and changed:

```
◆ INVENTORY  새 아이템 1 · 강화 1
★ NEW docs/auth-notes.md   +23
✎ UP  src/auth.js          +4 −4 ×2
```

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-item-get@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (a toast for each changed file too) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## 한국어

Claude가 새 파일을 만들면 그 줄에 `ITEM GET!`을 표시하고, `/inventory`로 이번 세션에서 만들고 고친 파일을 아이템처럼 보여줍니다(추가·삭제 줄 수 포함).
