# GAME MODE · HUD

An 8-bit status band above the prompt, drawn from figures Claude Code already keeps:

```
LV 3   HP █████░░░ 62%   MP ████░░░░ 48% 5h   G $1.24
```

| Shows | Means | Source |
|---|---|---|
| **HP** | context window **left** | `session.measure` → `context.percent` |
| **MP** | plan usage **left** in the 5-hour window (7-day or spend limit when that is all there is) | `session.measure` → `rateLimits` |
| **G** | what this session cost | `session.measure` → `cost.usd` |
| **LV** | successful tool calls, as levels (flavor) | `tool.call` |

When HP drops to **25%** (setting `lowHp`) a second row appears and a toast fires once per dip:

```
HP LOW!  컨텍스트 18% 남음 · 휴식하면 지금까지를 요약하고 이어간다  [ 휴식 /compact ] [ 세이브 /save ]
```

`휴식` runs `/compact` and `세이브` runs `/save` (shown only when [game-save-point](../game-save-point) is installed), both as if typed, queued until the session is idle. Focus the band with a click or `ctrl+x tab`, then `r` or `s`.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-hud@bitgame-mods
```

## Settings (`/plugin configure game-hud@bitgame-mods`)

| Field | Default | |
|---|---|---|
| `intensity` | `casual` | `off` hides the band · `casual` LV/HP/MP/G + low-HP row · `hardcore` adds EXP and the turn count |
| `palette` | `nes` | `nes` · `gameboy` · `amber` for dark terminals · `theme` follows your theme (use it on a light background) |
| `lowHp` | `25` | percent of context left that shows the rest/save row |
| `currency` | `usd` | `krw` converts the ledger with `krwPerUsd` |
| `krwPerUsd` | `1400` | rate for `krw` |

## Commands

| Command | |
|---|---|
| `/hud` | HP/MP/G/LV as text |
| `/hud hide` · `/hud show` | hide the band (screen sharing) and bring it back; remembered across sessions |

## Known limits

- HP reads `--` until the first response of a session (or right after a compaction).
- MP needs a plan with usage readings; with an API key the MP gauge is left out.
- G is the session's own ledger in US dollars; `krw` is a fixed-rate conversion.

## 한국어

프롬프트 위에 HP(남은 컨텍스트), MP(요금제 한도 남은 양), G(세션 비용)를 8비트 게이지로 보여줍니다. HP가 25% 아래로 내려가면 `휴식 /compact`, `세이브 /save` 버튼이 나타납니다. `/hud hide`로 숨길 수 있습니다.
