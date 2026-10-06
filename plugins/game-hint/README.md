# GAME MODE · Hint

The dim line under the prompt adds what to press now, after the engine's own words:

| When | Adds |
|---|---|
| Claude is working | `▸ ESC 후퇴` |
| context left at `lowHp` or less | `▸ /compact 휴식` |
| two or more failed calls in a row | `▸ 오류부터 읽기` |
| `saveEvery` turns without a save (with [game-save-point](../game-save-point)) | `▸ /save 세이브` |

Two at most, most urgent first. Other plugins' additions to the line stay before these.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-hint@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (counts the failures) |
| `lowHp` (`25`) | percent of context left that suggests a rest |
| `saveEvery` (`5`) | turns without a save that suggest `/save` |

## 한국어

프롬프트 아래 힌트 줄에 지금 누를 것을 덧붙입니다: 작업 중 `ESC 후퇴`, 컨텍스트가 적으면 `/compact 휴식`, 연속 실패면 `오류부터 읽기`, 한동안 저장하지 않았으면 `/save 세이브`.
