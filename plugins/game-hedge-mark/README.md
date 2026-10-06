# GAME MODE · Hedge Mark

Claude's replies draw in a window headed `CLAUDE`, and a sentence that guesses (`아마`, `추정`, `~것 같다`, `~로 보입니다`, `probably`, `might`, `I think` …) is marked `[?]`, so what was checked and what is a guess read apart:

```
╭───────────────────────────────────────────────╮
│ CLAUDE                                          │
│ 테스트 3개 중 2개가 실패합니다.                     │
│ [?] 아마 issuedAt 단위가 원인일 것입니다.          │
│ ? 추정 1곳 · 확인되기 전까지는 가설                │
╰───────────────────────────────────────────────╯
```

Markdown is kept (the reply is drawn with the engine's Markdown element); code blocks and inline code are not marked. The stored reply is unchanged (ctrl+o shows it as written).

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-hedge-mark@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` (the window and the marks) · `hardcore` (the marks alone, in the engine's own drawing) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## Known limits

- Words decide, not meaning: `다음과 같습니다` is left alone, `원인으로 보입니다` is marked.

## 한국어

Claude의 답을 `CLAUDE` 창으로 그리고, 추측하는 문장(아마·추정·~것 같다·probably…)에 `[?]`를 붙여 확인된 사실과 가설을 구분합니다. 아래에 추정 개수를 셉니다.
