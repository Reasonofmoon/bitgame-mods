# GAME MODE · HUD

An 8-bit window above the prompt, drawn from figures Claude Code already keeps:

```
╔═════════════════════════════════════════════════════════════════════════════╗
║ LV 03  EXP █░░░░░░░░░ 10%  HP ██████████ 96%  MP ████████░░ 77% 5h  G ₩263   ║
║ READY 다음 레벨까지 성공 행동 2                     [ 휴식 /compact ] [ 세이브 /save ] ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

| Shows | Means | Source |
|---|---|---|
| **LV** · **EXP** | successful tool calls as levels, and the way to the next one | `tool.call` |
| **HP** | context window **left** | `session.measure` → `context.percent` |
| **MP** | plan usage **left** in the 5-hour window (7-day or spend limit when that is all there is) | `session.measure` → `rateLimits` |
| **G** | what this session cost, ₩ by default | `session.measure` → `cost.usd` |

The second row says what needs you or what just happened, with a message:

| Tag | When |
|---|---|
| `HP LOW!` | context left at `lowHp` (25%) or less; a toast once per dip; `휴식` is the primary button |
| `SAVED` | a save point was just made |
| `REST` | the conversation was just compacted |
| `LEVEL UP!` | a new level, until your next prompt |
| `READY` | otherwise: the successful calls to the next level |

`휴식` runs `/compact` and `세이브` runs `/save` (shown only when [game-save-point](../game-save-point) is installed), both as if typed. Focus the band with a click or `ctrl+x tab`, then `r` or `s`. Another plugin's band (the save point's title screen) is drawn above the window, never replaced.

Part of the [GAME MODE pack](../../README.md). Requires Claude Code 2.1.287+; built and tested on 2.1.291.

## Install

```bash
claude plugin marketplace add Reasonofmoon/bitgame-mods
claude plugin install game-hud@bitgame-mods
```

## Settings (`/plugin configure game-hud@bitgame-mods`)

| Field | Default | |
|---|---|---|
| `intensity` | `casual` | `off` hides the band · `casual` the window · `hardcore` adds the turn count |
| `palette` | `nes` | `nes` · `gameboy` · `amber` for dark terminals · `theme` follows your theme (use it on a light background) |
| `lowHp` | `25` | percent of context left that shows `HP LOW!` |
| `currency` | `krw` | `usd` shows the ledger as kept |
| `krwPerUsd` | `1400` | rate for `krw` |

## Commands

| Command | |
|---|---|
| `/hud` | LV/EXP/HP/MP/G as text |
| `/hud hide` · `/hud show` | hide the band (screen sharing) and bring it back; remembered across sessions |

## Known limits

- HP reads `--` until the first response of a session (or right after a compaction).
- MP needs a plan with usage readings; with an API key the MP gauge is left out.
- G is the session's own ledger; `krw` is a fixed-rate conversion.

## 한국어

프롬프트 위 창에 LV·EXP(성공한 행동), HP(남은 컨텍스트), MP(요금제 한도 남은 양), G(세션 비용, 기본 ₩)를 보여줍니다. 둘째 줄은 상태(READY·HP LOW!·SAVED·REST·LEVEL UP!)와 메시지, `휴식 /compact`·`세이브 /save` 버튼입니다. `/hud hide`로 숨길 수 있습니다.
