# GAME MODE · Quest

`/quest` opens the task list as a quest log:

```
QUEST LOG  2/4 클리어 █████░░░░░
✓ 저장소 구조 파악
▶ 토큰 만료 단위 수정
· README 갱신
· 전체 테스트 통과                     BOSS
```

The list is the one Claude keeps: `TodoWrite`, or `TaskCreate` and `TaskUpdate`. `✓` done, `▶` in progress, `·` to do; the last quest is the `BOSS`, and `ALL CLEAR!` shows when every quest is done.

It is kept for the project: `/compact` keeps it, and the next session in the same folder starts from it (`지난 세션에서 이어짐`) until Claude makes a new list. `/quest clear` empties it.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-quest@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (adds what the quest in progress is doing) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## 한국어

Claude의 할 일 목록을 퀘스트 로그로 보여줍니다(✓ 완료, ▶ 진행, · 남음, 마지막은 BOSS). 프로젝트별로 저장되어 `/compact` 뒤에도, 다음 세션에서도 이어집니다.
