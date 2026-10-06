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

The clips are the plugin's own WAV files in `sounds/` (square waves, a few kB each), written by [`scripts/make-earcons.py`](../../scripts/make-earcons.py). How they play:

| System | Player | Volume |
|---|---|---|
| macOS | Claude Code's own (`afplay`) | ✓ |
| Windows | PowerShell's `SoundPlayer`; the clip goes in on stdin, its samples scaled to the volume first, no file written | ✓ |
| Linux | `paplay` (PulseAudio, PipeWire), else `aplay` (ALSA) | `paplay` only |

The system is found on the first cue (`OS=Windows_NT`, else `uname -s`).

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
| `/earcons test` | play every cue, one after another, and say which player is used |
| `/earcons off` · `on` | mute and unmute; remembered |

## Known limits

- Windows: the first cue of a session starts about a second late while PowerShell starts.
- A remote surface (desktop app) uses the engine's player only.

## 한국어

권한 확인·질문 대기(ask), 긴 작업 완료(done), 오류(miss), 가드 차단(block), 세이브(save)를 8비트 효과음으로 알려줍니다. macOS·Windows(PowerShell)·Linux(paplay/aplay)에서 소리가 납니다. `/earcons test`로 미리 들어보세요.
