# GAME MODE · Earcons

8-bit sound cues, so you know what the session needs without watching it.

| Cue | Plays when | casual | hardcore |
|---|---|---|---|
| `ask` | a permission prompt is about to open, or Claude asks you a question | ✓ | ✓ |
| `done` | a turn finished | turns of 30 s or longer | every turn |
| `miss` | a turn ended in an API error | ✓ | ✓ + every failed tool call |
| `block` | a GAME MODE guard refused a call | ✓ | ✓ |
| `save` | `/save` made a save point | ✓ | ✓ |
| `hit` | a file changed | — | ✓ |

The same cue twice within 0.4 s plays once. The permission prompt itself cannot be changed by a mod; this is how the pack points at it.

The clips are the plugin's own WAV files in `sounds/` (square waves, a few kB each), written by [`scripts/make-earcons.py`](../../scripts/make-earcons.py). Claude Code plays them with `afplay` on **macOS**; a Linux or Windows terminal has no player and stays silent.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-earcons@bitgame-mods
```

## Settings and commands

| | |
|---|---|
| `intensity` (`casual`) | `off` · `casual` · `hardcore` (table above) |
| `volume` (`0.6`) | 0 to 1 |
| `minTurnSeconds` (`30`) | in casual, the shortest turn that plays `done` |
| `/earcons` | what plays when |
| `/earcons test` | play every cue, one after another |
| `/earcons off` · `on` | mute and unmute; remembered |

## 한국어

권한 확인·질문 대기(ask), 긴 작업 완료(done), 오류(miss), 가드 차단(block), 세이브(save)를 8비트 효과음으로 알려줍니다. macOS에서만 소리가 납니다. `/earcons test`로 미리 들어보세요.
