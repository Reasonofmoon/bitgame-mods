# Changelog

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
