# GAME MODE · Equip

The model is the session's equipment. At the start, and whenever it changes (`/model`, a fallback), the transcript says which one is on:

```
● game-equip: EQUIP 모델 Sonnet 5.5 장착 · 교체는 /model
● game-equip: EQUIP 모델 Opus 5.5 장착 · Sonnet 5.5에서 교체
```

Where the engine shows a model notice under the logo, that notice reads the same.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-equip@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (a toast on each change) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |

## Known limits

- In a session with an API key the engine draws no model notice, so the equip line is a transcript row of its own.

## 한국어

세션을 시작할 때와 모델이 바뀔 때 `EQUIP 모델 … 장착 · 교체는 /model` 줄로 지금 모델을 알려줍니다.
