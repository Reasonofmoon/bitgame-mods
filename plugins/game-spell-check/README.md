# GAME MODE · Spell Check

While you type, words that leave the finish line open (`적당히`, `알아서`, `대충`, `깔끔하게`, `properly`, `somehow` …) are underlined in the warning color, values that look like secrets in the error color, and the hint line says what to add:

```
❯ 로그인 버그 적당히 고쳐줘
  ⏸ manual mode on · ⚠ '적당히' — 무엇이 되면 끝인지 적어라
```

A prompt sent with such a word and no done condition (`완료 조건: …`, `… 통과하면 끝`, `done when …`) carries a note only Claude reads, asking it to state the done condition in one line before it starts, and to check it at the end. Your messages draw in a window:

```
╭──────────────────────────────────────╮
│ P1 · moon                              │
│ 로그인 버그 적당히 고쳐줘                 │
│ ⚑ 완료 조건 · Claude에게 먼저 정하라고 함   │
╰──────────────────────────────────────╯
```

A done condition you wrote shows as `⚑ 완료 조건 · <it>`. Only prompts typed in the prompt box are touched.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-spell-check@bitgame-mods
```

## Settings

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (also asks for a done condition on any prompt over 200 characters without one) |
| `palette` (`nes`) | `nes` · `gameboy` · `amber` · `theme` |
| `player` (your login name) | the name in `P1 · <name>` |

## Known limits

- The secret check marks shapes (`sk-…`, `AKIA…`, `ghp_…`, `password=…`); it warns and does not stop the prompt. The [trap guard](../game-trap-guard) stops secrets in tool calls.

## 한국어

입력 중 모호한 말(적당히·알아서·대충…)에 밑줄, 비밀값에 빨간 표시를 하고 힌트 줄에 `무엇이 되면 끝인지 적어라`를 띄웁니다. 완료 조건 없이 보내면 Claude에게만 보이는 메모로 완료 조건부터 정하게 합니다. 내 메시지는 `P1 · 이름` 창으로 그립니다.
