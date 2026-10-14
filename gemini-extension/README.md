# 🎮 `bitgame-mods` for Gemini CLI (`gemini-extension`)

> **Every game element does a job.**
> Ports the core 8-bit GAME MODE experience of `bitgame-mods` to **Gemini CLI (`v0.40+`)** using native Themes, Tier-2 Policy Engine rules, Lifecycle Hooks, Custom Slash Commands, and Jev (`typesafe.ai`) Choice ranking.

## Quick Start

```bash
# Validate and link the extension to your local Gemini CLI
bash scripts/check-gemini.sh
gemini extensions link ./gemini-extension
```

## Included Features

1. **3 Retro Color Themes (`/theme`)**:
   - `game-mode-nes`
   - `game-mode-gameboy`
   - `game-mode-amber`
2. **Dual-Layer Security Guards (`policies/bitgame.toml` + `BeforeTool` Hook)**:
   - **Trap Guard (`TRAP!`)**: Blocks reading `.env` / SSH keys / credentials and refuses commands or edits that expose literal API keys.
   - **Barrier (`BARRIER!`)**: Blocks irreversible actions (`git reset --hard`, `git clean -f`, force-pushing `main`/`master`, `rm -rf ~/`, `npm publish`, `DROP TABLE`).
   - **Loop Breaker (`LOOP!`)**: Tracks normalized error signatures across tool runs and blocks the 4th identical failing call until files or arguments change.
3. **Prompt & Response Habits (`BeforeAgent` & `AfterAgent` Hooks)**:
   - **Spell Check**: Blocks accidental secret paste in user prompts and injects a Done-Condition request when vague words (`적당히`, `알아서`, `깔끔하게`, `properly`) are used without a finish line.
   - **Hedge Mark (`[?]`)**: Counts guessing sentences in responses and warns when hypotheses are unverified.
4. **8-Bit ANSI HUD, Save Point & Jev Choice (`/game:*` Commands)**:
   - `/game:hud` — Displays `LV`, `EXP`, `HP` (context remaining), `COMBO`, `MAP` (git branch protection), `INVENTORY`, and `ACHIEVEMENTS`.
   - `/quest` (or `/game:quest [clear | add <text> | done [n]]`) — Displays the task list as a quest log (`✓`, `▶`, `·`, with the final task marked `BOSS` and `★ ALL CLEAR! ★`), automatically synced with `[상태 요약]` and `TodoWrite`.
   - `/minimap` (or `/game:minimap [reset]`) — Draws the project's files as a map (`█` edited, `▓` read, `░` unexplored, `3+` re-read count) and highlights the most re-read hotspot file.
   - `/game:dual [on|off|open]` — **Dual-Screen (`tmux` Side-Pane) Mode**: when running inside `tmux`, automatically opens and updates a right-hand `tmux` split pane that renders the 8-Bit HUD, `/quest`, and `/minimap` in real time on every tool call and turn completion.
   - `/game:pick [1a]` — Composes the resume prompt from `[상태 요약]` with your chosen decision option (ranked via Jev when `TYPESAFE_API_KEY` is set).
   - `/game:save [note]` — Generates a `SPxx-XXXX-USER` password, copies the resume prompt to the clipboard, and plays the 8-bit `save.wav` cue.
   - `/game:load [password]` — Restores a saved session state and resumes work.
   - `/game:pass [block|warn|off|reset]` — Grants a 10-minute one-time pass for the next refused guard call.
   - `/game:earcons [on|off|test]` — Toggles macOS 8-bit WAV sound effects (`afplay`).
