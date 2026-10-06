# GAME MODE · Minimap

`/minimap` draws the project's files as a map, one cell per file, a row per folder:

```
MINIMAP  파일 42 · 편집 3 · 읽음 9 · 미탐색 30
src/         ▓▓█░░4░░▓
test/        ▓█░
(root)       ░░▓░
█ 편집  ▓ 읽음  ░ 미탐색  3 = 세 번 읽음
가장 많이 다시 읽은 파일: src/auth.ts (4회)
```

A file read three times or more shows its count: a sign Claude keeps coming back to it. The files come from git (tracked and untracked, ignored left out, 800 at most) when the map opens, and again after each turn while it is open. Reads and edits count from every loop, subagents included.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-minimap@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (lists the five most re-read files) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## Known limits

- Outside a git repository the map shows only the files Claude touched.
- A file read with `cat` through Bash is not counted as read.

## 한국어

프로젝트 파일을 폴더별 칸으로 보여줍니다(편집·읽음·미탐색, 세 번 이상 읽은 파일은 횟수). 가장 많이 다시 읽은 파일도 알려줍니다.
