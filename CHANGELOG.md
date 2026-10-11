# Changelog

## 0.3.0 — 2026-10-10

One new mod, the 22nd: picking up where the last answer left off. The marketplace is 0.3.0; plugins not listed below stay at 0.2.0.

### P4 · continuity (new)
- **game-choice** 0.3.0: when an answer ends with a `[상태 요약]`, its item 4 resume prompt becomes the prompt box's suggestion (Tab) and item 3's decisions become buttons above the prompt (`다음 할 일 결정`, `Q1. …`). Each pick appends its sentence; once all are picked, a fork rewrites the prompt into one paragraph. Jev (typesafe.ai, `TYPESAFE_API_KEY`) ranks the options in the background, with an 8-second timeout and Claude's order as the fallback. **Shadow mode** (default) hides the odds and records what an auto-approver would have picked (≥ 90%, confidence ≥ 80%, no risky act); picks go to `~/.claude/game-choice/picks.json` for `scripts/analyze-picks.mjs`. Skill suggestions while typing (`적용` · `맞춤 다듬기`); `/choice` shows the last Jev call.

### Fixed
- **game-barrier** 0.2.1: the project folder is read again when the working folder changes (`classic.CwdChanged`: `cd`, entering a worktree). Before, the folder read at session start stayed "inside" for the whole session, and the new one counted as outside.
- **game-barrier** tests: the file system fakes read paths in POSIX form, so the suite also passes on a Windows host (the engine hands them `C:\…` there).

### Evidence
- `claude plugin validate --strict` ✓ ×22 + marketplace · `claude plugin test` 173/173 ✓ (`scripts/check.sh` on Windows 11, Claude Code 2.1.296)

## 0.2.0 — 2026-10-07

Every element of the four design boards (save screen, title screen, GAME MODE screen, MOD EQUIPMENT LIST) as a mod that does a job: the seven mods upgraded and fourteen new ones. Acceptance criteria per mod: [`docs/GOALS.md`](docs/GOALS.md). All 21 plugins and the marketplace are 0.2.0.

### P1 · the seven, upgraded
- **game-hud**: a framed window in two rows: `LV`, an `EXP` bar to the next level, `HP`, `MP`, `G` (₩ by default); a state tag (`READY`, `HP LOW!`, `REST`, `SAVED`, `LEVEL UP!`) with a message and the `휴식 /compact` · `세이브 /save` buttons. Another plugin's band stays above it.
- **game-battle-log**: `⚔ BATTLE LOG · TURN n` on each turn's first row; `COMBO ×n` from three clean calls and `COMBO ×n → BREAK` on the failure that ends one; `+added −removed` on edits; each guard's verdict (`TRAP!`, `BARRIER!`, `LOOP!`); `SUMMON` on the run-in-background pill. Calls are counted from the rows the session keeps, so a refusal by a guard seated above it still counts.
- **game-save-point**: the save screen as on the board (header with slot, day, LV/EXP and CTX bars; `CLEARED` with `+EXP`; `QUEST LOG` with `MAIN`/`SIDE`; `? 어떻게 하시겠습니까?`; `INVENTORY` tiles; a `PASSWORD` code with the resume prompt copied to the clipboard); `/load <password>` from any project; a title screen (`CONTINUE` · `NEW GAME` · `LOAD`, three slot cards, `PRESS START`) at the start of a session in a folder with saves, closed by a choice or the first prompt; `Tab 이어하기 · /load` on the hint line meanwhile.
- **game-earcons**: plays on Windows (PowerShell `SoundPlayer`, the WAV scaled to the volume and passed on stdin) and Linux (`paplay` at the volume, else `aplay`) as well as macOS.
- **game-trap-guard**, **game-barrier**, **game-loop-breaker**: unchanged behavior; their refusals are named in the battle log.

### P2 · keeping track (new)
- **game-stance**: the permission mode as a colored badge at the right of the footer (`기본`, `자동 승인`, `계획`, `자동 판정`, `우회`, `묻지 않음`), following shift+tab.
- **game-casting**: the spinner reads `CASTING · <running call> · 행동 n · G +<turn cost>`, the engine's time and tokens after it.
- **game-clear-time**: `✦ CLEAR m:ss · 행동 n · 이번 턴 ₩x · 평소보다 ±m:ss` against the median of the project's last 20 turns; `/clear-time`.
- **game-party**: `/party` pane of subagents (`ACTIVE`/`CLEAR`/`FAIL`, a bar of tool calls, the job); opens itself when the first subagent starts on a terminal 144 columns wide or more.
- **game-quest**: `/quest` pane of the task list (`✓` `▶` `·`, `BOSS`, `ALL CLEAR!`), kept for the project across `/compact` and sessions.
- **game-minimap**: `/minimap` pane of the project's files by folder: edited, read, unexplored, read counts from three, the most re-read file.
- **game-hint**: `▸ ESC 후퇴`, `▸ /compact 휴식`, `▸ 오류부터 읽기`, `▸ /save 세이브` on the hint line.
- **game-map**: `MAP <branch> · 플레이 h:mm` status line, `⚠ 보호` on protected branches; `/map`.

### P3 · habits (new)
- **game-spell-check**: vague words underlined while typing and secrets in red, with `⚠ '적당히' — 무엇이 되면 끝인지 적어라` on the hint line; a vague prompt with no done condition carries a note asking Claude to state one first; your messages draw as `P1 · <name>` with `⚑ 완료 조건`.
- **game-answer-memory**: `★ 지난번 선택` on the option chosen last time when Claude asks the same question in the project.
- **game-hedge-mark**: replies in a `CLAUDE` window, guessing sentences marked `[?]`, footer `? 추정 n곳 · 확인되기 전까지는 가설`.
- **game-item-get**: `✦ ITEM GET! <path> · 새 파일 n줄` on the row of a file Claude created; `/inventory`.
- **game-equip**: `EQUIP 모델 <model> 장착 · 교체는 /model` at the start, on the engine's model notice, and whenever the model changes.
- **game-achievement**: first save, 10 safe commits, comeback, 10-call combo, a rest before HP 10%; toasts and `/achievements`.

### Shared
- `hooks/palette.ts` in every plugin that draws (palettes, bars, windows, clock, money); `scripts/check.sh` fails when the copies differ.

### Evidence
- `claude plugin validate --strict` ✓ ×21 + marketplace · `claude plugin test` 152/152 ✓ · `tsc --strict` clean ×21
- One recorded interactive session with all 21 (`docs/assets/game-mode-0.2.0.mp4`); each element was also checked live while it was built.

## 0.1.1 — 2026-10-06

Fixes for five bugs found in a recorded interactive session with all seven mods, and Windows paths for the guards (game-hud stays 0.1.0).

- **game-save-point**: `/save` drew as plain text on its first run, because the engine starts a command's output row with the names of the plugins that answered it. The save screen is now found after those names.
- **game-earcons**: `block` and `save` now come from the rows the session stores (`session.append`). Earcons no longer wraps `/save`, which had added its own name to the save row.
- **game-battle-log**: `MISS` shows up to three lines that say what failed (`FAIL`, `not ok`, `error`, `expected`, …). Exit codes, `TAP version` and runtime warnings are skipped.
- **game-trap-guard**, **game-barrier**, **game-loop-breaker**: the log line no longer repeats the plugin's name (`game-barrier: BARRIER! blocked …`).
- **game-loop-breaker**: the `LOOP n/3` status line is cleared at session start and by your next message even when no streak is held. Before, it stayed after a reload.
- **game-barrier** on Windows: paths (`C:\…`, `c:/…`, Git Bash `/c/…`) are compared without regard to case or slash direction, and `HOME`/`TEMP` fall back to `USERPROFILE` and `TEMP`/`TMP`. Before, every edit in a Windows project counted as outside the project and was refused. `rm -r` on a drive root (`C:\`, `/c/`) is refused. If the project folder cannot be read, the outside-project check is off for that session instead of refusing every edit.
- **game-battle-log**, **game-loop-breaker**, **game-trap-guard**: Windows paths are shown relative to the project and named by file name.

### Evidence
- `claude plugin validate --strict` ✓ ×7 · `claude plugin test` 69/69 ✓ (Windows paths included) · `tsc` clean ×7
- Real interactive run of the fixed mods: [`examples/RUN-2026-10-06.md`](examples/RUN-2026-10-06.md) section 3. The barrier refused `git push --force origin master`. The loop breaker refused the 4th identical `ls`, and the next message cleared its status line. `/save` drew the save screen on its first run. A probe mod confirmed the rows earcons listens to.

## 0.1.0 — 2026-10-06

### GAME MODE, P1 (seven mods, each 0.1.0)
- **game-hud**: `AbovePrompt` band of LV · HP (context left) · MP (plan usage left) · G (session cost) from `session.measure`; at `lowHp` (25%) a toast once per dip and `휴식 /compact` / `세이브 /save` buttons; `/hud [hide|show]`
- **game-battle-log**: `ToolUse` rows as `HIT` · `CRIT` · `MISS` (first three error lines) · `BLOCK` · `ESC`; the errored `ToolResult` steps aside; a `ToolGroup` with a failure unfolds itself; one-line tools only; `/battle-log [on|off]`
- **game-trap-guard**: refuses secrets in commands, URLs and source files, printing secret files or variables, and reading key files; `.env` files may hold keys; secrets never repeated in messages
- **game-barrier**: refuses force-push/delete of protected branches (current branch read from `.git/HEAD`, `HEAD`/`@` resolved), `reset --hard`, `clean -f`, whole-tree discards, `rm -r` outside the project, publishing, infrastructure teardown, `DROP/TRUNCATE` through a database client, disk overwrites, and edits outside the project (links resolved)
- **game-loop-breaker**: identical-failure streaks per command / file / URL (timings and temp paths ignored, counts kept); `LOOP 2/3` note, seal at 3, the 4th identical run refused; eased by an edit or a re-read, cleared by your next message
- **game-save-point**: `/save` writes the five-part status summary as an RPG save screen through `$.model.fork` (a resumed session with nothing to fork summarizes its stored transcript); five saves per project; next session offers the resume prompt on Tab; `/load [n]`, `/save show|list`
- **game-earcons**: `ask` · `done` · `miss` · `block` · `save` · `hit` WAV cues (`scripts/make-earcons.py`), macOS `afplay`
- Guards default to `block`, with `warn`, `off` and a ten-minute one-time `pass` that only a typed command can grant
- Shared look: palettes `nes` (default) · `gameboy` · `amber` · `theme`; intensity `off` · `casual` (default) · `hardcore`

### Evidence
- Built against Claude Code 2.1.291 declarations; `tsc --strict` clean for all seven
- `claude plugin validate --strict` ✓ ×7 · `claude plugin test` 60/60 ✓ (UI mounted on `terminal` and `desktop`)
- Installed from a local marketplace with `claude plugin install` ✓ ×7; all seven loaded together in a headless session ✓
- Real run: trap guard, barrier and loop breaker refused `cat .env`, `git reset --hard` and the 4th identical failure; `/save` in a resumed session: [`examples/RUN-2026-10-06.md`](examples/RUN-2026-10-06.md)
