# GAME MODE · Answer Memory

When Claude asks a question it asked before in this project, the option you chose last time is marked in the dialog:

```
 ☐ 형식
문서 형식을 어떻게 할까요?
❯ 1. 마크다운 표
     표로 정리
  2. 목록
     ★ 지난번 선택 · 글머리표로 정리
```

Only the dialog's drawing changes: the options, their order and the answer stay as asked. Questions match through spacing, case and a trailing question mark. Answers are kept per project (the last 200 questions); a multi-select answer marks each choice.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-answer-memory@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (says when: `★ 지난번 선택 (3시간 전)`) |

## Known limits

- The mark sits in the option's description; the dialog is the engine's own and cannot be redrawn.
- The test kit cannot stand in for the dialog, so the marking is tested as a function; the dialog was checked in a live session.

## 한국어

Claude가 같은 질문을 다시 하면, 지난번에 고른 선택지에 `★ 지난번 선택`을 표시합니다. 프로젝트별로 최근 200개 질문을 기억합니다.
