# Changelog

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
