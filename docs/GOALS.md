# GAME MODE 0.2.0 — goals

> 한국어 요약: Design 보드 4장(세이브 화면, 타이틀·이어하기, GAME MODE 전체 화면, MOD 배치표 21종)에 있는 요소를 모두 실제 mod로 만든다. 모든 게임 요소는 실제로 하는 일이 있어야 한다. mod로 바꿀 수 없는 것(글꼴, CRT 주사선, 권한 확인 창)만 빼고, 각 요소는 아래 완료 기준을 실제 Claude Code 세션에서 만족해야 끝난 것으로 본다.

## Goal

Every element of the four design boards works in a real Claude Code session (2.1.287 or later, terminal), and each one does a job: it shows a real figure, stops a real harm, or saves real time.

The boards: the save screen (turn end), the title and continue screen (session start), the GAME MODE full screen, and the MOD EQUIPMENT LIST of 21 mods.

## What a mod cannot do (and what stands in)

| Board element | Why not | Instead |
|---|---|---|
| Pixel fonts (Press Start 2P, Galmuri) | The terminal program draws the font | README: set Windows Terminal / iTerm font to Galmuri Mono |
| CRT scanlines | No pixel drawing in a terminal | None |
| The permission prompt | Mods cannot redraw it | Earcons plays `ask` when it opens |
| Pixel-art avatars | No images in most terminals | Header glyphs in the palette's colors |

## Done means

For every element: `claude plugin validate --strict` passes, its tests pass (`claude plugin test`), `tsc` is clean, it is seen working in a real interactive session (tmux recording), its README row exists, and it is listed in the marketplace. Paths work on Windows (`C:\…`, `/c/…`).

## Acceptance criteria

### P1 · upgrades of the seven mods

| # | Mod | Done when |
|---|---|---|
| 01 | **HUD** (`AbovePrompt`) | A framed band in two rows. Row 1: `LV`, an `EXP` bar to the next level, `HP` (context left), `MP` (plan usage left), `G` (session cost, ₩ by default). Row 2: a state tag (`READY`, `HP LOW!`, `REST`, `SAVED`, `LEVEL UP!`), a message, and `휴식 /compact` and `세이브 /save` buttons. It stacks with any other plugin's band instead of replacing it. |
| 02 | **Battle Log** (`ToolUse` · `ToolResult` · `ToolGroup` · `ToolProgress`) | The first row of each turn carries `⚔ BATTLE LOG · TURN n`. A run of 3+ clean calls shows `COMBO ×n`; the failure that ends it shows `COMBO ×n → BREAK`. Edits show `+added −removed`. A guard's refusal shows the guard's own verdict (`TRAP!`, `BARRIER!`, `LOOP!`). The background pill reads `ctrl+b ▸ 소환수에게 맡기기 (백그라운드)` (SUMMON). |
| 03–05 | **Trap Guard · Barrier · Loop Breaker** | Unchanged behavior; their refusals are named in the battle log. |
| 06 | **Save Point** (`CommandOutput` · `AbovePrompt` · `prompt.suggest`) | **Save screen** as on the board: header (slot, day, time, LV with EXP bar, CTX bar); `CLEARED` with `+EXP`, `QUEST LOG` with MAIN/SIDE marks; `? 어떻게 하시겠습니까?` with the decisions; an `INVENTORY` of the files touched; a `PASSWORD` code (`SP07-KTX9-MOON` style) with the resume prompt copied to the clipboard (`COPIED!`); `/load <code>` restores that save. **Title screen** at the start of a session in a folder with saves: `SAVE POINT`, `CONTINUE` / `NEW GAME` / `LOAD`, up to three slot cards, `PRESS START`; `CONTINUE` puts the resume prompt in the prompt box; it leaves when a choice is made or the first prompt is sent. |
| 07 | **Earcons** | Sounds play on Windows (PowerShell `SoundPlayer`) and Linux (`paplay`/`aplay`) as well as macOS (`afplay`). |

### P2 · keeping track (new)

| # | Mod | Done when |
|---|---|---|
| 08 | **Stance** (`SessionMode`) | A badge at the right of the prompt footer names the permission mode in its color: `기본`, `자동 승인` (yellow), `계획` (blue), `우회` (red), `자동 판정`, `묻지 않음`. It follows shift+tab. |
| 09 | **Casting** (`Spinner`) | While a turn runs the spinner reads `CASTING · <what runs now>` and `· 행동 n · G +x`; the engine's own time and tokens stay after it. |
| 10 | **Clear Time** (`TurnDuration`) | A turn ends with `CLEAR m:ss · 행동 n · 이번 턴 ₩x · 평소보다 ±m:ss` (against the median of the project's last 20 turns). |
| 11 | **Party** (`Pane` · `agent.spawn`) | `/party` shows each subagent of the session: name, `ACTIVE` / `CLEAR` / `FAIL`, a bar of its tool calls, its job. It opens by itself when a subagent starts and the terminal is wide enough. |
| 12 | **Quest** (`Pane` · todo and task tools) | `/quest` shows the task list as quests: `✓` done, `▶` in progress, `·` to do, the last one marked `BOSS`. It is kept across `/compact` and in the next session in the same project. |
| 13 | **Minimap** (`Pane`) | `/minimap` shows a grid of the project's files: edited, read, unexplored, and the read count on files read 3+ times, with a legend and the most re-read file named. |
| 14 | **Hint** (`PromptHint`) | The hint line adds what to press now: `ESC 후퇴` while working, `/compact 휴식` at low HP, `오류부터 읽기` after a repeated failure, `Tab 이어하기` / `/save` at an empty prompt. |
| 15 | **Map** (status line) | `MAP <branch> · 플레이 h:mm`; a protected branch (`main`, `master`, …) is marked `⚠`. |

### P3 · habits (new)

| # | Mod | Done when |
|---|---|---|
| 16 | **Spell Check** (`prompt.edit` · `prompt.submit` · `UserMessage`) | While you type, vague words (`적당히`, `알아서`, `대충`, `깔끔하게` …) are underlined in the warning color and secrets in the error color, and the hint line says `⚠ '적당히' — 무엇이 되면 끝인지 적어라`. A prompt sent with a vague word and no done condition asks Claude, in a note only Claude reads, to state the done condition first. Your messages draw in a window headed `P1 · <player>` with a `⚑ 완료 조건` line when one was attached. |
| 17 | **Answer Memory** (`AskUserQuestion`) | When Claude asks the same question again, the option you chose last time is marked `★ 지난번 선택`. |
| 18 | **Hedge Mark** (`AssistantMessage`) | Claude's replies draw in a window headed `CLAUDE`; sentences that guess (`아마`, `추정`, `probably`, `might` …) are marked `?`, with a footer `? 추정 n곳 · 확인되기 전까지는 가설`. |
| 19 | **Item Get** (`tool.call` · `CommandOutput`) | A file Claude creates shows `ITEM GET! <path>`; `/inventory` lists the files created and changed this session as items. |
| 20 | **Equip** (`InfoNotice`) | The startup model notice reads `EQUIP 모델 <model> 장착 · 교체는 /model`. |
| 21 | **Achievement** (toast) | Milestones raise `★ ACHIEVEMENT <name>`: first save, 10 commits with no guard refusal in their turn, a comeback (a failed command passing after a change), a 10-call combo, a rest before HP 10%. `/achievements` lists them. |

## Order of work

1. P1 upgrades (HUD, save point and title screen, battle log, earcons)
2. P2 (stance, casting, clear time, hint, map, then the quest, party and minimap panes)
3. P3 (spell check, hedge mark, answer memory, item get, equip, achievement)
4. One recorded session with all 21; fixes
5. Docs, versions (0.2.0), marketplace, PR

## Status (2026-10-07)

All 21 met. Evidence: `bash scripts/check.sh` (strict validate of the marketplace and 21 plugins, palette copies equal, 152 tests) and `tsc --strict` clean for each plugin; a recorded session with all 21 enabled ([`assets/game-mode-0.2.0.mp4`](assets/game-mode-0.2.0.mp4), stills in the README), and each element checked live while it was built. Not reachable in the recording, covered by tests: `HP LOW!` and `/compact 휴식` (needs 25% context left), `제때 휴식`, `안전 운전`, Windows and Linux sound (the Linux path was run in a session with a logging `paplay`; the PowerShell script was run on PowerShell 7 up to the player, which only Windows has).
